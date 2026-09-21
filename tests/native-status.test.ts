import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { AgenticID } from "@0gfoundation/0g-agenticid-sdk";
import { expect, it, vi } from "vitest";
import * as deployments from "../src/deployments.js";
import { nativeObservation } from "../src/minimal-cli.js";
import * as proofs from "../src/proof.js";

it("native diagnostics use public reads only and retain no secret log text", async () => {
	const directory = await mkdtemp(join(tmpdir(), "native-status-"));
	const record: deployments.DeploymentRecord = {
		version: 1,
		profile: "minimal",
		environment: { chainId: 16661, registry: `0x${"11".repeat(20)}` },
		owner: `0x${"22".repeat(20)}`,
		agentId: "42",
		sealId: `0x${"33".repeat(32)}`,
		agentSealAddr: `0x${"44".repeat(20)}`,
		checksum: "a".repeat(64),
		idempotencyKey: "intent",
	};
	vi.spyOn(deployments, "requireDeployment").mockResolvedValue(record);
	vi.spyOn(proofs, "createProofVerifier").mockResolvedValue(async () => true);
	const forbidden = vi.fn(async () => {
		throw new Error("MUTATION_FORBIDDEN");
	});
	const paths: string[] = [];
	const client = {
		base: "https://native.example",
		chat: forbidden,
		fetchWithProof: async (path: string) => {
			paths.push(path);
			const body = JSON.stringify({
				agent: record.agentSealAddr,
				owner: record.owner,
			});
			const now = BigInt(Math.floor(Date.now() / 1000));
			return {
				response: new Response(body),
				proof: {
					agentId: 42n,
					timestamp: now,
					deadline: now + 60n,
					signature: `0x${"12".repeat(65)}`,
					dataHashes: [`0x${"55".repeat(32)}`],
					frameworkHash: `0x${"66".repeat(32)}`,
					submitter: `0x${"00".repeat(20)}`,
					taskHash: proofs.taskHash(
						"GET",
						path,
						new Uint8Array(),
						Buffer.from(body),
						200,
					),
				},
			};
		},
		fetch: async (path: string) => {
			paths.push(path);
			return new Response(
				"storage upload success\nuploader.Apply: chain.Update: send tx: exceeds block gas limit\napiKey=secret",
			);
		},
	};
	const ag = {
		agent: {
			client: async () => client,
			intelligentDatasOf: async () => [
				{
					dataHash: `0x${"55".repeat(32)}`,
					dataDescription: '{"role":"workspace/"}',
				},
			],
			reset: forbidden,
			stop: forbidden,
			topUpAgentSeal: forbidden,
		},
		deposit: forbidden,
	} as unknown as AgenticID;
	try {
		const result = await nativeObservation(
			{
				profile: "minimal",
				model: "glm-5.3",
				attestorUrl: "https://attestor.example",
				credentials: {},
			},
			ag,
			record,
			directory,
		);
		expect(result.proofVerified).toBe(true);
		expect(result.diagnostics.failure).toBe("BLOCK_GAS_LIMIT");
		expect(paths).toEqual(["/hello", "/log"]);
		expect(forbidden).not.toHaveBeenCalled();
		expect(
			await readFile(join(directory, "latest-diagnostics.json"), "utf8"),
		).not.toContain("apiKey");
	} finally {
		vi.restoreAllMocks();
		await rm(directory, { recursive: true, force: true });
	}
});
