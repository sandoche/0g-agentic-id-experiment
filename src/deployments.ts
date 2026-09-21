import { mkdir, open, readFile, unlink } from "node:fs/promises";
import { hostname } from "node:os";
import { join } from "node:path";
import type { AgenticID } from "@0gfoundation/0g-agenticid-sdk";
import { createPublicClient, http } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { requestJson } from "./market.js";
import { atomicWrite } from "./state.js";
import type { Address, AgentProfile, ConnectionConfig } from "./types.js";

export type EnvironmentIdentity = { chainId: number; registry: Address };
export type DeploymentRecord = {
	version: 1;
	profile: AgentProfile;
	environment: EnvironmentIdentity;
	owner: Address;
	checksum: string;
	payloadChecksum?: string;
	idempotencyKey: string;
	sealId?: Address;
	agentSealAddr?: Address;
	agentId?: string;
	url?: string;
};
export async function resolveEnvironment(config: ConnectionConfig) {
	const remote = await requestJson<{
		chain_id: number;
		chain_rpc: string;
		agentic_id_addr: Address;
		frameworks?: { name: string; image: string }[];
	}>(new URL(`${config.attestorUrl}/config`));
	if (
		![16602, 16661].includes(remote.chain_id) ||
		!/^0x[\da-f]{40}$/i.test(remote.agentic_id_addr) ||
		!/^https:\/\//.test(remote.chain_rpc)
	)
		throw new Error("UNSUPPORTED_SEALED_ENVIRONMENT");
	const rpc = createPublicClient({
		transport: http(remote.chain_rpc, { retryCount: 0, timeout: 10000 }),
	});
	if ((await rpc.getChainId()) !== remote.chain_id)
		throw new Error("ENVIRONMENT_CHAIN_MISMATCH");
	return {
		chainId: remote.chain_id,
		registry: remote.agentic_id_addr.toLowerCase() as Address,
		openclawSupported: !!remote.frameworks?.some(
			(f) => f.name === "openclaw" && f.image,
		),
	};
}
export function deploymentDirectory(
	profile: AgentProfile,
	env: EnvironmentIdentity,
	root = ".local",
) {
	if (
		!["minimal", "portfolio-manager"].includes(profile) ||
		![16602, 16661].includes(env.chainId) ||
		!/^0x[\da-f]{40}$/i.test(env.registry)
	)
		throw new Error("INVALID_DEPLOYMENT_NAMESPACE");
	return join(
		root,
		"deployments",
		profile,
		`${env.chainId}-${env.registry.toLowerCase()}`,
	);
}
export function evidenceDirectory(
	profile: AgentProfile,
	env: EnvironmentIdentity,
	agentId: string,
	root = ".local",
) {
	if (!/^\d+$/.test(agentId)) throw new Error("AGENT_ID_REQUIRED");
	return join(deploymentDirectory(profile, env, root), "agents", agentId);
}
export function validateRecord(
	value: unknown,
	profile: AgentProfile,
	env: EnvironmentIdentity,
	agentId?: string,
): asserts value is DeploymentRecord {
	const r = value as DeploymentRecord | undefined;
	if (
		!r ||
		r.version !== 1 ||
		typeof r.idempotencyKey !== "string" ||
		!r.idempotencyKey ||
		!/^[a-f\d]{64}$/.test(r.checksum) ||
		!/^0x[\da-f]{40}$/i.test(r.owner)
	)
		throw new Error("DEPLOYMENT_STATE_CORRUPT");
	if (r.profile !== profile) throw new Error("DEPLOYMENT_PROFILE_MISMATCH");
	if (
		r.environment?.chainId !== env.chainId ||
		r.environment.registry.toLowerCase() !== env.registry.toLowerCase()
	)
		throw new Error("DEPLOYMENT_ENVIRONMENT_MISMATCH");
	if (agentId !== undefined && r.agentId !== agentId)
		throw new Error("DEPLOYMENT_IDENTITY_MISMATCH");
	if (
		(r.sealId && !/^0x[\da-f]{64}$/i.test(r.sealId)) ||
		(r.agentSealAddr && !/^0x[\da-f]{40}$/i.test(r.agentSealAddr)) ||
		(r.agentId && !/^\d+$/.test(r.agentId))
	)
		throw new Error("DEPLOYMENT_STATE_CORRUPT");
}
async function readJson(path: string): Promise<unknown | undefined> {
	try {
		return JSON.parse(await readFile(path, "utf8"));
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
		throw new Error("DEPLOYMENT_STATE_CORRUPT");
	}
}
export async function readRecord(
	profile: AgentProfile,
	env: EnvironmentIdentity,
	root = ".local",
) {
	const value = await readJson(
		join(deploymentDirectory(profile, env, root), "deployment.json"),
	);
	if (value !== undefined) {
		validateRecord(value, profile, env);
		return value;
	}
	if (
		profile === "portfolio-manager" &&
		(await readJson(join(root, "deployment.json"))) !== undefined
	)
		throw new Error("LEGACY_DEPLOYMENT_REQUIRES_VERIFIED_MIGRATION");
	return undefined;
}
export async function withOperationLock<T>(
	directory: string,
	action: () => Promise<T>,
): Promise<T> {
	await mkdir(directory, { recursive: true, mode: 0o700 });
	const path = join(directory, "operation.lock");
	let guard: Awaited<ReturnType<typeof open>>;
	try {
		guard = await open(`${path}.guard`, "wx", 0o600);
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code === "EEXIST")
			throw new Error("OPERATION_LOCKED");
		throw error;
	}
	try {
		try {
			const prior = JSON.parse(await readFile(path, "utf8"));
			if (
				prior.host !== hostname() ||
				!Number.isSafeInteger(prior.pid) ||
				prior.pid <= 0
			)
				throw new Error("OPERATION_LOCKED");
			let dead = false;
			try {
				process.kill(prior.pid, 0);
			} catch (error) {
				dead = (error as NodeJS.ErrnoException).code === "ESRCH";
			}
			if (!dead) throw new Error("OPERATION_LOCKED");
			await unlink(path);
		} catch (error) {
			if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
		}
		const handle = await open(path, "wx", 0o600);
		try {
			await handle.writeFile(
				JSON.stringify({
					pid: process.pid,
					host: hostname(),
					startedAt: new Date().toISOString(),
				}),
			);
			await handle.sync();
		} finally {
			await handle.close();
		}
	} finally {
		await guard.close();
		await unlink(`${path}.guard`);
	}
	try {
		return await action();
	} finally {
		await unlink(path);
	}
}
export async function requireDeployment(
	config: ConnectionConfig,
	profile: AgentProfile,
	ag: AgenticID,
	env: EnvironmentIdentity,
	agentId: bigint,
	owner = false,
	root = ".local",
) {
	const record = await readRecord(profile, env, root);
	if (!record) throw new Error("MATCHING_DEPLOYMENT_RECORD_REQUIRED");
	validateRecord(record, profile, env, String(agentId));
	const [sealId, wallet, currentOwner] = await Promise.all([
		ag.agent.getSealId(agentId),
		ag.agent.getAgentSeal(agentId),
		ag.agent.ownerOf(agentId),
	]);
	if (
		!record.sealId ||
		!record.agentSealAddr ||
		sealId.toLowerCase() !== record.sealId.toLowerCase() ||
		wallet.toLowerCase() !== record.agentSealAddr.toLowerCase() ||
		currentOwner.toLowerCase() !== record.owner.toLowerCase()
	)
		throw new Error("DEPLOYMENT_IDENTITY_MISMATCH");
	if (
		owner &&
		(!config.credentials.ownerKey ||
			privateKeyToAccount(config.credentials.ownerKey).address.toLowerCase() !==
				currentOwner.toLowerCase())
	)
		throw new Error("OWNER_IDENTITY_MISMATCH");
	return record;
}
export async function migrateLegacy(
	config: ConnectionConfig,
	ag: AgenticID,
	environment: EnvironmentIdentity,
	agentId: bigint,
	root = ".local",
) {
	if (!config.credentials.ownerKey) throw new Error("OWNER_KEY_REQUIRED");
	const owner = privateKeyToAccount(config.credentials.ownerKey).address;
	return withOperationLock(
		deploymentDirectory("portfolio-manager", environment, root),
		async () => {
			const target = join(
				deploymentDirectory("portfolio-manager", environment, root),
				"deployment.json",
			);
			if (await readJson(target))
				throw new Error("DEPLOYMENT_RECORD_ALREADY_EXISTS");
			const legacy = (await readJson(join(root, "deployment.json"))) as
				| Partial<DeploymentRecord>
				| undefined;
			if (
				!legacy ||
				legacy.agentId !== String(agentId) ||
				!legacy.sealId ||
				!legacy.agentSealAddr ||
				(legacy.profile && legacy.profile !== "portfolio-manager")
			)
				throw new Error("LEGACY_IDENTITY_MISMATCH");
			const [sealId, wallet, onChainOwner] = await Promise.all([
				ag.agent.getSealId(agentId),
				ag.agent.getAgentSeal(agentId),
				ag.agent.ownerOf(agentId),
			]);
			if (
				sealId.toLowerCase() !== legacy.sealId.toLowerCase() ||
				wallet.toLowerCase() !== legacy.agentSealAddr.toLowerCase() ||
				owner.toLowerCase() !== onChainOwner.toLowerCase()
			)
				throw new Error("LEGACY_IDENTITY_MISMATCH");
			if (
				legacy.environment &&
				(legacy.environment.chainId !== environment.chainId ||
					legacy.environment.registry.toLowerCase() !==
						environment.registry.toLowerCase())
			)
				throw new Error("LEGACY_IDENTITY_MISMATCH");
			const record = {
				...legacy,
				version: 1,
				profile: "portfolio-manager",
				environment: {
					chainId: environment.chainId,
					registry: environment.registry,
				},
				owner,
			};
			validateRecord(record, "portfolio-manager", environment, String(agentId));
			await atomicWrite(target, JSON.stringify(record));
			return record;
		},
	);
}
