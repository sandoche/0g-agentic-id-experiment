import { randomUUID } from "node:crypto";
import { mkdir, open, readFile } from "node:fs/promises";
import { join } from "node:path";
import type {
	AgentClient,
	AgenticID,
	ServeProof,
} from "@0gfoundation/0g-agenticid-sdk";
import {
	type Address,
	concatHex,
	createPublicClient,
	http,
	keccak256,
	parseAbi,
	stringToHex,
} from "viem";
import { requestJson } from "./market.js";
import { atomicWrite, stringify } from "./state.js";
import type { ConnectionConfig } from "./types.js";
export type ProofVerifier = (proof: ServeProof) => Promise<boolean>;
const zero = "0x0000000000000000000000000000000000000000";
const digest = /^0x[\da-f]{64}$/i;
export function validBindings(
	proof: ServeProof,
	expected: {
		dataHashes: string[];
		frameworkHash?: string;
		submitter: string;
		frameworkAllowed: boolean;
	},
): boolean {
	const hashes = proof.dataHashes.map((h) => h.toLowerCase()),
		current = [
			...new Set(expected.dataHashes.map((h) => h.toLowerCase())),
		].sort();
	return (
		current.length > 0 &&
		hashes.length === current.length &&
		new Set(hashes).size === hashes.length &&
		hashes.every((h) => digest.test(h)) &&
		[...hashes].sort().every((h, i) => h === current[i]) &&
		digest.test(proof.frameworkHash) &&
		!/^0x0+$/.test(proof.frameworkHash) &&
		expected.frameworkAllowed &&
		(!expected.frameworkHash ||
			proof.frameworkHash.toLowerCase() ===
				expected.frameworkHash.toLowerCase()) &&
		proof.submitter.toLowerCase() === expected.submitter.toLowerCase()
	);
}
export async function createProofVerifier(
	config: ConnectionConfig,
	ag: AgenticID,
	agentId: bigint,
	submitter: Address = zero,
	directory = ".local/proof-bindings",
): Promise<ProofVerifier> {
	const remote = await requestJson<{
		chain_id: number;
		chain_rpc: string;
		agentic_id_addr: Address;
	}>(new URL(`${config.attestorUrl}/config`));
	if (
		![16602, 16661].includes(remote.chain_id) ||
		!/^0x[\da-f]{40}$/i.test(remote.agentic_id_addr) ||
		new URL(remote.chain_rpc).protocol !== "https:"
	)
		throw new Error("UNSUPPORTED_PROOF_ENVIRONMENT");
	const rpc = createPublicClient({
		transport: http(remote.chain_rpc, { retryCount: 0, timeout: 10000 }),
	});
	const path = join(
		directory,
		`${remote.chain_id}-${remote.agentic_id_addr.toLowerCase()}-${agentId}.json`,
	);
	return async (proof) => {
		if (
			proof.agentId !== agentId ||
			!(await ag.reputation.verifyProof(proof)).ok ||
			(await rpc.getChainId()) !== remote.chain_id
		)
			return false;
		let pinned: string | undefined;
		try {
			pinned = JSON.parse(await readFile(path, "utf8")).frameworkHash;
			if (!pinned || !digest.test(pinned))
				throw new Error("INVALID_FRAMEWORK_PIN");
		} catch (e) {
			if ((e as NodeJS.ErrnoException).code !== "ENOENT") throw e;
		}
		const current = await ag.agent.intelligentDatasOf(agentId);
		const approved =
			digest.test(proof.frameworkHash) &&
			(await rpc.readContract({
				address: remote.agentic_id_addr,
				abi: parseAbi([
					"function isValidFrameworkHash(bytes32 frameworkHash) view returns (bool)",
				]),
				functionName: "isValidFrameworkHash",
				args: [proof.frameworkHash],
			}));
		if (
			!validBindings(proof, {
				dataHashes: current.map((d) => d.dataHash),
				frameworkHash: pinned,
				submitter,
				frameworkAllowed: approved,
			})
		)
			return false;
		// The protocol has a framework allowlist, not a per-agent image getter. Pin the
		// first signed, registry-approved measurement and reject later changes.
		if (!pinned) {
			await mkdir(directory, { recursive: true, mode: 0o700 });
			try {
				const handle = await open(path, "wx", 0o600);
				try {
					await handle.writeFile(
						JSON.stringify({
							agentId: String(agentId),
							frameworkHash: proof.frameworkHash,
						}),
					);
					await handle.sync();
				} finally {
					await handle.close();
				}
			} catch (error) {
				if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
				const concurrent = JSON.parse(await readFile(path, "utf8"));
				if (
					concurrent.frameworkHash?.toLowerCase() !==
					proof.frameworkHash.toLowerCase()
				)
					return false;
			}
		}
		return true;
	};
}
export const taskHash = (
	method: string,
	path: string,
	request: Uint8Array,
	response: Uint8Array,
	status: number,
) =>
	keccak256(
		concatHex([
			stringToHex(method),
			stringToHex(path),
			keccak256(request),
			keccak256(response),
			stringToHex(String(status)),
		]),
	);
export async function verifyTranscript(
	proof: ServeProof | null,
	agentId: bigint,
	path: string,
	response: Uint8Array,
	status: number,
	verify: (p: ServeProof) => Promise<boolean>,
) {
	const now = BigInt(Math.floor(Date.now() / 1000));
	if (
		!proof ||
		!Array.isArray(proof.dataHashes) ||
		proof.dataHashes.length === 0 ||
		proof.dataHashes.some(
			(hash) => !digest.test(hash) || /^0x0+$/.test(hash),
		) ||
		!/^0x[\da-f]{130}$/i.test(proof.signature) ||
		/^0x0+$/.test(proof.signature) ||
		!digest.test(proof.frameworkHash) ||
		/^0x0+$/.test(proof.frameworkHash) ||
		proof.agentId !== agentId ||
		proof.timestamp > now + 30n ||
		proof.timestamp < now - 300n ||
		proof.deadline < now ||
		proof.taskHash !==
			taskHash("GET", path, new Uint8Array(), response, status) ||
		!(await verify(proof))
	)
		throw new Error("PROOF_INVALID");
}
export async function readProven<T>(
	_ag: AgenticID,
	client: AgentClient,
	agentId: bigint,
	path: string,
	verify: ProofVerifier,
	directory?: string,
): Promise<T> {
	if (
		new URL(client.base).protocol !== "https:" ||
		!(
			path === "/hello" ||
			/^\/api\/(status|challenge|events(?:\?after=\d+)?)$/.test(path)
		)
	)
		throw new Error("UNSAFE_PROOF_REQUEST");
	const { response, proof } = await client.fetchWithProof(path, {
		signal: AbortSignal.timeout(15000),
		redirect: "error",
	});
	const bytes = new Uint8Array(await response.arrayBuffer());
	if (bytes.length > 1024 * 1024 || response.status !== 200)
		throw new Error("AGENT_NOT_READY");
	await verifyTranscript(proof, agentId, path, bytes, response.status, verify);
	const parsed = JSON.parse(new TextDecoder().decode(bytes)) as T;
	if (directory) {
		await mkdir(directory, { recursive: true, mode: 0o700 });
		await atomicWrite(
			join(directory, `${Date.now()}-${randomUUID()}.json`),
			stringify({
				method: "GET",
				path,
				status: response.status,
				requestBody: "",
				responseBase64: Buffer.from(bytes).toString("base64"),
				parsedResponse: parsed,
				proof,
				verification: { ok: true, currentBindings: true },
				verifiedAt: new Date().toISOString(),
			}),
		);
	}
	return parsed;
}
