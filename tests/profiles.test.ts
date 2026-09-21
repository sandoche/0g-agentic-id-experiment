import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, it, vi } from "vitest";
import { runCli } from "../src/cli.js";
import * as configuration from "../src/config.js";
import { loadEnvironment } from "../src/environment.js";

afterEach(() => vi.restoreAllMocks());
it("selects only the two profiles and defaults to portfolio", () => {
	expect(configuration.readProfile({})).toBe("portfolio-manager");
	for (const value of ["", "Minimal", "other", " minimal"])
		expect(() => configuration.readProfile({ AGENT_PROFILE: value })).toThrow(
			"INVALID_AGENT_PROFILE",
		);
});
it("minimal ignores irrelevant portfolio fields and needs no credentials offline", () => {
	const config = configuration.readApplicationConfig({
		AGENT_PROFILE: "minimal",
		PORTFOLIO_ALLOCATIONS: "invalid",
		STRATEGY_PROMPT: "private",
		BASE_RPC_URL: "invalid",
		ONEINCH_API_KEY: "secret",
		REBALANCE_INTERVAL_MS: "1",
	});
	expect(config.profile).toBe("minimal");
	expect(config).not.toHaveProperty("strategy");
	expect(config).not.toHaveProperty("rpcUrls");
	expect(config.credentials).not.toHaveProperty("oneinch");
	expect(JSON.stringify(config)).not.toContain("private");
});
it("loads profile using existing process-over-file precedence", async () => {
	const dir = await mkdtemp(join(tmpdir(), "profile-env-"));
	try {
		const path = join(dir, ".env");
		await writeFile(path, "AGENT_PROFILE=minimal\n");
		vi.stubEnv("AGENT_PROFILE", undefined);
		expect((await loadEnvironment(path, false)).AGENT_PROFILE).toBe("minimal");
		vi.stubEnv("AGENT_PROFILE", "portfolio-manager");
		expect((await loadEnvironment(path, false)).AGENT_PROFILE).toBe(
			"portfolio-manager",
		);
	} finally {
		vi.unstubAllEnvs();
		await rm(dir, { recursive: true, force: true });
	}
});
it("checks minimal offline and rejects trading flags without network calls", async () => {
	const fetcher = vi
		.spyOn(globalThis, "fetch")
		.mockRejectedValue(new Error("NETWORK_FORBIDDEN"));
	vi.spyOn(console, "log").mockImplementation(() => {});
	vi.spyOn(console, "error").mockImplementation(() => {});
	const env = { AGENT_PROFILE: "minimal" };
	expect(await runCli(["check"], env)).toBe(0);
	for (const args of [
		["simulate", "--once"],
		["fund", "--agent", "1"],
		["activate", "--live", "--agent", "1"],
	])
		expect(await runCli(args, env)).toBe(1);
	expect(fetcher).not.toHaveBeenCalled();
});
