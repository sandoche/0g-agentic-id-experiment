import { mkdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { AgenticID } from "@0gfoundation/0g-agenticid-sdk";
import { formatEther, parseEther } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { checkModel, deploymentPreflight, mintOrResume } from "./agent.js";
import {
	type DeploymentRecord,
	evidenceDirectory,
	requireDeployment,
	resolveEnvironment,
	withOperationLock,
} from "./deployments.js";
import {
	artifactPath,
	classifyDiagnostics,
	minimalCapability,
} from "./minimal.js";
import { readUpdateReceipts } from "./native-receipts.js";
import {
	type ProbeObservation,
	type ProbePhase,
	runPersistence,
} from "./persistence.js";
import { createProofVerifier, readProven } from "./proof.js";
import { atomicWrite } from "./state.js";
import type { MinimalConfig } from "./types.js";

type Options = {
	agent?: string;
	live?: boolean;
	online?: boolean;
	execute?: boolean;
	phase?: string;
	timeout?: string;
	amount?: string;
	once?: boolean;
};
const allowed = new Set([
	"check",
	"deploy",
	"preflight",
	"status",
	"diagnostics",
	"activate",
	"persistence-test",
	"stop-runtime",
	"topup-agent",
	"topup-sandbox",
]);
export async function runMinimal(
	command: string,
	values: Options,
	config: MinimalConfig,
): Promise<number> {
	if (!allowed.has(command) || values.live)
		throw new Error("UNSUPPORTED_MINIMAL_COMMAND");
	const capability = minimalCapability();
	if (command === "check") {
		console.log(
			JSON.stringify({
				profile: "minimal",
				framework: "openclaw",
				attestor: config.attestorUrl,
				environment: "unresolved-offline",
				payloadBytes: capability.bytes,
				valid: true,
			}),
		);
		if (values.online) {
			const environment = await resolveEnvironment(config);
			await checkModel(config.model, capability.bytes);
			console.log(JSON.stringify({ environment, inferenceProbe: "not-run" }));
		}
		return 0;
	}
	if (command === "preflight") {
		const p = await deploymentPreflight(config);
		await checkModel(config.model, capability.bytes);
		console.log(
			JSON.stringify({
				profile: "minimal",
				environment: p.environment,
				payloadBytes: capability.bytes,
				ownerGasOG: formatEther(p.native),
				sandboxAvailableOG: formatEther(p.available),
				sandboxMinimumOG: formatEther(p.required),
				inferenceCredentialPresent: !!config.credentials.inference,
				inferenceCredit: "unknown-no-paid-probe",
				evolutionGas: "agent-specific; inspect after mint",
				acknowledged: p.acknowledgments.allAcked,
			}),
		);
		return 0;
	}
	if (command === "deploy") {
		console.log(
			JSON.stringify(await mintOrResume(config), (_, v) =>
				typeof v === "bigint" ? String(v) : v,
			),
		);
		return 0;
	}
	const mutate =
		["stop-runtime", "topup-agent", "topup-sandbox"].includes(command) ||
		(command === "persistence-test" &&
			!!values.execute &&
			["write", "recreate", "restore"].includes(values.phase ?? ""));
	if (mutate && !config.credentials.ownerKey)
		throw new Error("OWNER_KEY_REQUIRED");
	const environment = await resolveEnvironment(config);
	console.log(
		JSON.stringify({
			profile: "minimal",
			environment: {
				chainId: environment.chainId,
				registry: environment.registry,
			},
		}),
	);
	const ag = await AgenticID.fromAttestor(
		config.attestorUrl,
		mutate ? { account: config.credentials.ownerKey } : {},
	);
	if (command === "topup-sandbox") {
		const amount = exactAmount(values.amount);
		const hash = await ag.deposit({ amountWei: amount });
		await ag.waitForTransaction(hash);
		console.log(`Sandbox deposit: ${hash}`);
		return 0;
	}
	if (!values.agent || !/^[1-9]\d*$/.test(values.agent))
		throw new Error("AGENT_ID_REQUIRED");
	const agentId = BigInt(values.agent);
	const record = await requireDeployment(
		config,
		"minimal",
		ag,
		environment,
		agentId,
		mutate,
	);
	const directory = evidenceDirectory("minimal", environment, values.agent);
	if (command === "topup-agent") {
		const hash = await ag.agent.topUpAgentSeal(
			record.agentSealAddr!,
			exactAmount(values.amount),
		);
		await ag.agent.waitForTransaction(hash);
		console.log(`Evolution-gas transfer: ${hash}`);
		return 0;
	}
	if (command === "stop-runtime") {
		if (!values.execute) throw new Error("EXECUTE_REQUIRED");
		return withOperationLock(join(directory, "containment"), async () => {
			const path = join(directory, "containment", "intent.json");
			const row = (await ag.agent.listMyDeployments()).find(
				(r) => r.sealId.toLowerCase() === record.sealId!.toLowerCase(),
			);
			if (
				!row?.sandboxId ||
				row.agentId !== agentId ||
				row.owner?.toLowerCase() !== record.owner.toLowerCase()
			)
				throw new Error("RUNTIME_IDENTITY_UNAVAILABLE");
			let requested = false;
			try {
				requested = JSON.parse(await readFile(path, "utf8")).requested === true;
			} catch (error) {
				if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
			}
			if (requested) {
				console.log(
					JSON.stringify({
						stopRequested: true,
						phase: row.phase,
						stopConfirmed: row.phase === "stopped",
						note: "No repeated stop sent. An ambiguous request needs owner reconciliation.",
					}),
				);
				return row.phase === "stopped" ? 0 : 2;
			}
			await atomicWrite(
				path,
				JSON.stringify({
					requested: true,
					agentId: String(agentId),
					sealId: record.sealId,
					sandboxId: row.sandboxId,
				}),
			);
			await ag.agent.stop(record.sealId!, row.sandboxId);
			const after = (await ag.agent.listMyDeployments()).find(
				(r) => r.sealId.toLowerCase() === record.sealId!.toLowerCase(),
			);
			const stopped = after?.phase === "stopped";
			console.log(
				JSON.stringify({
					stopAccepted: true,
					stopConfirmed: stopped,
					phase: after?.phase,
					note: "Runtime stop, not portfolio worker stop; acceptance alone does not prove containment.",
				}),
			);
			return stopped ? 0 : 2;
		});
	}
	const observe = () => nativeObservation(config, ag, record, directory);
	if (command === "persistence-test") {
		if (!values.phase) throw new Error("PERSISTENCE_PHASE_REQUIRED");
		const result = await runPersistence(
			directory,
			values.phase as ProbePhase,
			!!values.execute,
			{
				observe,
				now: Date.now,
				sleep: async (ms) => {
					await delay(ms);
				},
				write: async (content) => {
					// Verify current native proof before owner authentication or sending credentials.
					const current = await observe();
					if (!current.proofVerified || current.diagnostics.failure)
						throw new Error("NATIVE_PROOF_REQUIRED");
					const client = await ag.agent.client(agentId);
					if (!client.chat) throw new Error("OWNER_CHAT_UNAVAILABLE");
					await client.chat(
						[
							{
								role: "user",
								content: `Write exactly the following public content once to the top-level workspace file ${artifactPath}, using your native file tool. Do not edit any other file or initialize anything. If it already exists, do not overwrite it; report that fact.\n${content}`,
							},
						],
						{ signal: AbortSignal.timeout(60000) },
					);
				},
			},
			values.timeout === undefined ? 120000 : Number(values.timeout),
		);
		console.log(JSON.stringify(result));
		return ["BASELINE_OBSERVED", "MUTATION_REQUESTED"].includes(result.status)
			? 0
			: 2;
	}
	const result = await observe();
	console.log(JSON.stringify(result));
	if (command === "activate")
		console.log(
			"Native runtime needs no portfolio activation. No inference or application mutation sent.",
		);
	return result.proofVerified && !result.diagnostics.failure ? 0 : 2;
}
function exactAmount(amount?: string) {
	if (!amount || !/^\d+(\.\d{1,18})?$/.test(amount) || parseEther(amount) <= 0n)
		throw new Error("EXACT_AMOUNT_REQUIRED");
	return parseEther(amount);
}
export async function nativeObservation(
	config: MinimalConfig,
	ag: AgenticID,
	record: DeploymentRecord,
	directory: string,
): Promise<ProbeObservation> {
	const agentId = BigInt(record.agentId!);
	await requireDeployment(
		config,
		"minimal",
		ag,
		record.environment,
		agentId,
		!!config.credentials.ownerKey,
	);
	const entries = await ag.agent.intelligentDatasOf(agentId);
	const roles: Record<string, string> = {};
	for (const entry of entries) {
		const role: unknown = JSON.parse(entry.dataDescription).role;
		if (
			typeof role !== "string" ||
			![
				"framework",
				"openclaw.json",
				"persona",
				"workspace/",
				"workspace/skills/",
				"workspace/canvas/",
			].includes(role) ||
			roles[role]
		)
			throw new Error("INVALID_IDATA_ROLES");
		roles[role] = entry.dataHash;
	}
	const sorted = Object.fromEntries(
		Object.entries(roles).sort(([a], [b]) => a.localeCompare(b)),
	);
	const result: ProbeObservation = {
		at: Date.now(),
		identity: {
			agentId: String(agentId),
			sealId: record.sealId!,
			wallet: record.agentSealAddr!,
			owner: record.owner,
		},
		roles: sorted,
		iData: entries.map((entry) => ({
			dataHash: entry.dataHash,
			dataDescription: entry.dataDescription,
		})),
		runtimeAvailable: false,
		proofVerified: false,
		diagnostics: classifyDiagnostics(""),
	};
	await mkdir(directory, { recursive: true, mode: 0o700 });
	try {
		const client = await ag.agent.client(agentId);
		if (new URL(client.base).protocol !== "https:")
			throw new Error("HTTPS_REQUIRED");
		const verify = await createProofVerifier(
			config,
			ag,
			agentId,
			config.credentials.ownerKey
				? privateKeyToAccount(config.credentials.ownerKey).address
				: undefined,
		);
		try {
			const hello = await readProven<{ agent: string; owner: string }>(
				ag,
				client,
				agentId,
				"/hello",
				verify,
				join(directory, "proofs"),
			);
			result.runtimeAvailable = true;
			result.proofVerified =
				hello.agent.toLowerCase() === record.agentSealAddr!.toLowerCase() &&
				hello.owner.toLowerCase() === record.owner.toLowerCase();
		} catch {
			/* No failed response becomes authority. */
		}
		const log = await client.fetch("/log", {
			signal: AbortSignal.timeout(10000),
			redirect: "error",
		});
		if (log.ok) {
			const text = await log.text();
			if (text.length <= 1024 * 1024)
				result.diagnostics = classifyDiagnostics(text);
		} else await log.body?.cancel();
	} catch {
		/* Preserve chain evidence when runtime is unavailable. */
	}
	try {
		result.receipts = await readUpdateReceipts(
			config,
			record,
			sorted,
			result.diagnostics.updateTransactions
				.filter((tx) => tx.agentId === record.agentId)
				.map((tx) => tx.hash),
		);
	} catch {
		result.receipts = [];
	}
	await atomicWrite(
		join(directory, "latest-diagnostics.json"),
		JSON.stringify(result),
	);
	return result;
}
