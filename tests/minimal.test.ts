import { expect, it } from "vitest";
import * as minimal from "../src/minimal.js";

it("builds a tiny native persona without portfolio code or initialization writes", () => {
	const payload = minimal.minimalCapability();
	expect(payload.bytes).toBeLessThan(1024);
	expect(payload.systemPrompt).not.toMatch(
		/PORTFOLIO_PAYLOAD|npm ci|node_modules|1inch|start\.cjs/,
	);
	expect(payload.sha256).toMatch(/^[a-f0-9]{64}$/);
});
it("keeps upload and unrelated framework updates distinct from file commitment", () => {
	const evidence = minimal.classifyDiagnostics(
		"storage upload success\nuploader.Apply: chain.Update: send tx: exceeds block gas limit\nsecret=do-not-store",
	);
	expect(evidence.failure).toBe("BLOCK_GAS_LIMIT");
	expect(JSON.stringify(evidence)).not.toContain("do-not-store");
	expect(
		minimal.commitmentVerdict({
			workspaceChanged: false,
			uploadObserved: true,
			proofVerified: true,
		}),
	).toMatchObject({ status: "INCONCLUSIVE" });
	expect(
		minimal.commitmentVerdict({
			workspaceChanged: true,
			uploadObserved: true,
			proofVerified: true,
		}),
	).toMatchObject({ status: "INCONCLUSIVE" });
});
it("does not accept an old stable tick after current drift", () => {
	expect(
		minimal.classifyDiagnostics(
			"watcher: tick -- stable: workspace/=12345678/4B\nwatcher: tick -- 1 drifted: !workspace/=aaaaaaaa/9B",
		).stableTickObserved,
	).toBe(false);
});
