import { randomUUID } from "node:crypto";
import { mkdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { AgenticID } from "@0gfoundation/0g-agenticid-sdk";
import { privateKeyToAccount } from "viem/accounts";
import { authMessage, type Challenge } from "./auth.js";
import { buildCapability } from "./bootstrap.js";
import { requestJson } from "./market.js";
import { createProofVerifier, readProven } from "./proof.js";
import { atomicWrite } from "./state.js";
import type { Config } from "./types.js";
export function openclawConfig(model: string) {
	return {
		agents: { defaults: { model: { primary: `openai/${model}` } } },
		models: {
			providers: {
				openai: {
					baseUrl: "https://router-api.0g.ai/v1",
					api: "openai-completions",
					apiKey: { source: "env", provider: "default", id: "OPENAI_API_KEY" },
					headers: { "X-0G-Provider-Trust-Mode": "private" },
					models: [
						{
							id: model,
							name: model,
							reasoning: true,
							input: ["text"],
							contextWindow: 1179648,
							maxTokens: 32768,
							compat: {
								requiresStringContent: true,
								supportsStore: false,
								supportsDeveloperRole: false,
								supportsReasoningEffort: false,
								supportsUsageInStreaming: false,
								supportsStrictMode: false,
								maxTokensField: "max_tokens",
							},
						},
					],
				},
			},
		},
	};
}
export async function checkModel(
	model: string,
	promptBytes: number,
	fetcher: typeof fetch = fetch,
): Promise<number> {
	const catalog = await requestJson<{
		data: {
			id: string;
			verifiability: string;
			tee_attested: boolean;
			context_length: number;
			supported_parameters: string[];
		}[];
	}>(new URL("https://router-api.0g.ai/v1/models"), {}, fetcher);
	const m = catalog.data.find((m) => m.id === model);
	// Byte count is a conservative token upper bound, leaving room for tools/output.
	if (
		m?.verifiability !== "TeeML" ||
		m.tee_attested !== true ||
		!m.supported_parameters.includes("tools") ||
		m.context_length < promptBytes + 65536
	)
		throw new Error("ENCLAVE_MODEL_UNAVAILABLE");
	return m.context_length;
}
export async function probeInference(
	key: string,
	model: string,
	fetcher: typeof fetch = fetch,
): Promise<void> {
	const r = await requestJson<{ model: string; choices: unknown[] }>(
		new URL("https://router-api.0g.ai/v1/chat/completions"),
		{
			method: "POST",
			headers: {
				Authorization: `Bearer ${key}`,
				"Content-Type": "application/json",
				"X-0G-Provider-Trust-Mode": "private",
			},
			body: JSON.stringify({
				model,
				messages: [{ role: "user", content: "Reply with OK." }],
				max_tokens: 64,
				stream: false,
			}),
		},
		fetcher,
	);
	if (r.model !== model || !Array.isArray(r.choices))
		throw new Error("PRIVATE_INFERENCE_FAILED");
}
export async function deployOnce(
	previous: Record<string, unknown> | undefined,
	persist: (state: Record<string, unknown>) => Promise<void>,
	deploy: (key: string) => Promise<{ sealId: string; agentSealAddr: string }>,
) {
	const state = previous ?? { idempotencyKey: randomUUID() };
	if (typeof state.idempotencyKey !== "string")
		throw new Error("DEPLOYMENT_STATE_CORRUPT");
	if (state.sealId) return state;
	await persist(state);
	const accepted = await deploy(state.idempotencyKey);
	Object.assign(state, accepted);
	await persist(state);
	return state;
}
export async function loadDeployment(
	directory = ".local",
): Promise<Record<string, unknown> | undefined> {
	try {
		return JSON.parse(
			await readFile(join(directory, "deployment.json"), "utf8"),
		);
	} catch (e) {
		if ((e as NodeJS.ErrnoException).code === "ENOENT") return undefined;
		throw new Error("DEPLOYMENT_STATE_CORRUPT");
	}
}
export async function deploymentPreflight(config: Config) {
	if (!config.credentials.ownerKey) throw new Error("OWNER_KEY_REQUIRED");
	if (!config.credentials.inference) throw new Error("INFERENCE_KEY_REQUIRED");
	const environment = await requestJson<{
		chain_id: number;
		frameworks: { name: string; image: string }[];
	}>(new URL(`${config.attestorUrl}/config`));
	if (
		![16602, 16661].includes(environment.chain_id) ||
		!environment.frameworks.some((f) => f.name === "openclaw" && f.image)
	)
		throw new Error("UNSUPPORTED_SEALED_ENVIRONMENT");
	const ag = await AgenticID.fromAttestor(config.attestorUrl, {
		account: config.credentials.ownerKey,
	});
	const costs = await ag.agent.estimateCosts(),
		balance = await ag.getEffectiveBalance(),
		native = await ag.nativeBalance(),
		acknowledgments = await ag.ackStatus();
	const required = costs.pricing.createFee + costs.costPerMinWei * 30n;
	return {
		ag,
		costs,
		available: balance.availableWei,
		required,
		native,
		acknowledgments,
	};
}
export async function mintOrResume(
	config: Config,
	directory = ".local",
	log: (message: string) => void = console.log,
) {
	const files: Record<string, string> = {};
	for (const name of ["worker.mjs", "package.json", "package-lock.json"])
		files[name] = await readFile(join("dist", name), "utf8");
	const capability = buildCapability(config.strategy, files, config);
	await checkModel(config.model, capability.bytes);
	const { ag, available, required, native, acknowledgments } =
		await deploymentPreflight(config);
	if (available < required)
		throw new Error(`SANDBOX_FUNDING_REQUIRED:${required - available}`);
	if (native === 0n) throw new Error("OWNER_0G_GAS_REQUIRED");
	await mkdir(directory, { recursive: true, mode: 0o700 });
	const previous = await loadDeployment(directory);
	if (previous?.checksum && previous.checksum !== capability.sha256)
		throw new Error("DEPLOYMENT_PAYLOAD_CHANGED");
	const persist = (s: Record<string, unknown>) =>
		atomicWrite(
			join(directory, "deployment.json"),
			JSON.stringify({ ...s, checksum: capability.sha256 }),
		);
	if (!acknowledgments.allAcked) {
		const hash = await ag.ack();
		if (hash) await ag.waitForTransaction(hash);
	}
	const state = await deployOnce(previous, persist, (key) =>
		ag.agent.deploy({
			name: "Portfolio experiment",
			description: "Sealed multi-chain portfolio worker",
			framework: "openclaw",
			idempotencyKey: key,
			iData: [
				{
					role: "framework",
					plaintext: { name: "openclaw", schema_version: 1 },
					extra: {},
				},
				{
					role: "openclaw.json",
					plaintext: openclawConfig(config.model),
					extra: {},
				},
				{
					role: "persona",
					plaintext: {
						system_prompt: capability.systemPrompt,
						inference: { provider: "openai", model: config.model },
					},
					extra: {},
				},
			],
			sandbox: { apiKey: config.credentials.inference! },
		}),
	);
	const sealId = state.sealId as `0x${string}`;
	log(`Deployment accepted: ${sealId}`);
	const agentId = await ag.agent.waitForMint(sealId, {
		timeoutMs: 300000,
		pollIntervalMs: 5000,
	});
	state.agentId = agentId.toString();
	await persist(state);
	log(`Agent minted: ${agentId}`);
	const running = await ag.agent.waitForRunning(sealId, {
		timeoutMs: 300000,
		pollIntervalMs: 5000,
	});
	if (new URL(running.url).protocol !== "https:")
		throw new Error("HTTPS_REQUIRED");
	state.url = running.url;
	await persist(state);
	log("Container running; worker activation still required.");
	return {
		agentId,
		sealId,
		url: running.url,
		checksum: capability.sha256,
		wallet: state.agentSealAddr as `0x${string}`,
	};
}
export async function activate(
	config: Config,
	agentId: bigint,
	checksum?: string,
) {
	if (!config.credentials.ownerKey || !config.credentials.oneinch)
		throw new Error("ACTIVATION_CREDENTIALS_REQUIRED");
	const ag = await AgenticID.fromAttestor(config.attestorUrl, {
		account: config.credentials.ownerKey,
	});
	const client = await ag.agent.client(agentId);
	if (new URL(client.base).protocol !== "https:")
		throw new Error("HTTPS_REQUIRED");
	const wallet = await ag.agent.getAgentSeal(agentId);
	const verify = await createProofVerifier(
		config,
		ag,
		agentId,
		privateKeyToAccount(config.credentials.ownerKey).address,
	);
	type Status = {
		agentId: string;
		wallet: string;
		checksum: string;
		state: string;
		instance: string;
	};
	const status = async () => {
		const s = await readProven<Status>(
			ag,
			client,
			agentId,
			"/api/status",
			verify,
			".local/proofs",
		);
		if (
			s.agentId !== String(agentId) ||
			s.wallet.toLowerCase() !== wallet.toLowerCase() ||
			(checksum && s.checksum !== checksum)
		)
			throw new Error("WORKER_IDENTITY_MISMATCH");
		return s;
	};
	let ready: Status | undefined;
	try {
		ready = await status();
	} catch {
		/* First activation may not have a service yet. */
	}
	if (!ready) {
		if (!client.chat) throw new Error("OWNER_CHAT_UNAVAILABLE");
		await client.chat(
			[
				{
					role: "user",
					content: `Activate the encrypted portfolio capability for AGENT_ID ${agentId}. From your workspace run node skills/portfolio/start.cjs ${agentId} if installed; otherwise execute the exact bootstrap command in SOUL.md with ${agentId}. Do not print the payload, strategy, credentials or private files. Do not trade directly. Report only worker startup status.`,
				},
			],
			{ signal: AbortSignal.timeout(300000) },
		);
		for (let attempt = 0; attempt < 30 && !ready; attempt++) {
			try {
				ready = await status();
			} catch {
				await delay(2000);
			}
		}
		if (!ready) throw new Error("WORKER_NOT_READY");
	}
	const challenge = await readProven<Challenge>(
		ag,
		client,
		agentId,
		"/api/challenge",
		verify,
	);
	if (
		challenge.agentId !== String(agentId) ||
		challenge.wallet.toLowerCase() !== wallet.toLowerCase() ||
		challenge.instance !== ready.instance
	)
		throw new Error("CHALLENGE_IDENTITY_MISMATCH");
	const payload = JSON.stringify({
		oneinch: config.credentials.oneinch,
		mode: config.mode,
	});
	const signature = await privateKeyToAccount(
		config.credentials.ownerKey,
	).signMessage({ message: authMessage("configure", challenge, payload) });
	const response = await client.fetch("/api/configure", {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		redirect: "error",
		signal: AbortSignal.timeout(60000),
		body: JSON.stringify({ challenge, payload, signature }),
	});
	if (!response.ok) {
		await response.body?.cancel();
		throw new Error("OWNER_CONFIGURATION_FAILED");
	}
	await response.body?.cancel();
	const final = await status();
	if (final.state !== "ready") throw new Error("WORKER_NOT_READY");
	return final;
}
