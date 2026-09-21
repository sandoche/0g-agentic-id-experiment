import type { ServeProof } from "@0gfoundation/0g-agenticid-sdk";
import { expect, it } from "vitest";
import { taskHash, verifyTranscript } from "../src/proof.js";

it("rejects empty proofs even when a supplied verifier accepts them", async () => {
	const body = new TextEncoder().encode("{}");
	const now = BigInt(Math.floor(Date.now() / 1000));
	const proof: ServeProof = {
		agentId: 42n,
		timestamp: now,
		deadline: now + 60n,
		dataHashes: [],
		frameworkHash: `0x${"11".repeat(32)}`,
		signature: "0x",
		submitter: `0x${"00".repeat(20)}`,
		taskHash: taskHash("GET", "/hello", new Uint8Array(), body, 200),
	};
	for (const value of [
		null,
		proof,
		{ ...proof, dataHashes: [`0x${"22".repeat(32)}`] },
	])
		await expect(
			verifyTranscript(
				value as ServeProof | null,
				42n,
				"/hello",
				body,
				200,
				async () => true,
			),
		).rejects.toThrow("PROOF_INVALID");
});
