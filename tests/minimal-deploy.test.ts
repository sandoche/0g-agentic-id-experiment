import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { AgenticID } from "@0gfoundation/0g-agenticid-sdk";
import { privateKeyToAccount } from "viem/accounts";
import { expect, it, vi } from "vitest";
import { mintOrResume } from "../src/agent.js";
import { deploymentDirectory, readRecord } from "../src/deployments.js";
import type { MinimalConfig } from "../src/types.js";

it("resumes the same minimal deployment after ambiguity without funding or portfolio payload", async () => {
	const root = await mkdtemp(join(tmpdir(), "minimal-deploy-"));
	const key = `0x${"03".repeat(32)}` as const;
	const owner = privateKeyToAccount(key).address;
	const sealId = `0x${"44".repeat(32)}` as const;
	const wallet = `0x${"55".repeat(20)}` as const;
	const environment = {
		chainId: 16661,
		registry: `0x${"66".repeat(20)}` as const,
	};
	const config: MinimalConfig = {
		profile: "minimal",
		model: "glm-5.3",
		attestorUrl: "https://attestor.example",
		credentials: { ownerKey: key, inference: "private-key" },
	};
	let attempts = 0;
	const keys: string[] = [];
	const forbidden = vi.fn(async () => {
		throw new Error("UNAUTHORIZED_SPENDING");
	});
	const sdk = {
		agent: {
			estimateCosts: async () => ({
				pricing: { createFee: 1n },
				costPerMinWei: 1n,
			}),
			deploy: async (payload: {
				idempotencyKey: string;
				iData: unknown[];
				name: string;
			}) => {
				keys.push(payload.idempotencyKey);
				const saved = JSON.parse(
					await readFile(
						join(
							deploymentDirectory("minimal", environment, root),
							"deployment.json",
						),
						"utf8",
					),
				);
				expect(saved.idempotencyKey).toBe(payload.idempotencyKey);
				expect(payload.name).toBe("AgenticID minimal persistence probe");
				expect(JSON.stringify(payload.iData)).not.toMatch(
					/PORTFOLIO_PAYLOAD|npm ci|1inch|allocations|worker\.mjs/,
				);
				if (++attempts === 1) throw new Error("ambiguous timeout");
				return { sealId, agentSealAddr: wallet };
			},
			waitForMint: async () => 42n,
			waitForRunning: async () => ({ url: "https://agent.example" }),
			getSealId: async () => sealId,
			getAgentSeal: async () => wallet,
			ownerOf: async () => owner,
			topUpAgentSeal: forbidden,
		},
		getEffectiveBalance: async () => ({ availableWei: 100n }),
		nativeBalance: async () => 1n,
		ackStatus: async () => ({ allAcked: true }),
		deposit: forbidden,
		ack: forbidden,
	} as unknown as AgenticID;
	vi.spyOn(AgenticID, "fromAttestor").mockResolvedValue(sdk);
	vi.spyOn(globalThis, "fetch").mockImplementation(async (url, init) => {
		if (String(url).endsWith("/models"))
			return Response.json({
				data: [
					{
						id: "glm-5.3",
						verifiability: "TeeML",
						tee_attested: true,
						context_length: 1000000,
						supported_parameters: ["tools"],
					},
				],
			});
		if (String(url).endsWith("/config"))
			return Response.json({
				chain_id: 16661,
				chain_rpc: "https://rpc.example",
				agentic_id_addr: environment.registry,
				frameworks: [{ name: "openclaw", image: "supported" }],
			});
		const rpc = JSON.parse(String(init?.body));
		if (rpc.method !== "eth_chainId") throw new Error("UNEXPECTED_RPC");
		return Response.json({ jsonrpc: "2.0", id: rpc.id, result: "0x4115" });
	});
	try {
		await expect(mintOrResume(config, root, () => {})).rejects.toThrow(
			"ambiguous timeout",
		);
		expect((await mintOrResume(config, root, () => {})).agentId).toBe(42n);
		await mintOrResume(config, root, () => {});
		await mintOrResume(
			{ ...config, credentials: { ownerKey: key } },
			root,
			() => {},
		);
		await expect(
			mintOrResume({ ...config, model: "another-model" }, root, () => {}),
		).rejects.toThrow();
		expect(attempts).toBe(2);
		expect(keys[0]).toBe(keys[1]);
		expect((await readRecord("minimal", environment, root))?.agentId).toBe(
			"42",
		);
		expect(forbidden).not.toHaveBeenCalled();
	} finally {
		vi.restoreAllMocks();
		await rm(root, { recursive: true, force: true });
	}
});
