import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it } from "vitest";
import {
	type ProbeObservation,
	type ProbeTransport,
	runPersistence,
} from "../src/persistence.js";

const observation: ProbeObservation = {
	at: 0,
	identity: {
		agentId: "42",
		sealId: `0x${"11".repeat(32)}`,
		wallet: `0x${"22".repeat(20)}`,
		owner: `0x${"33".repeat(20)}`,
	},
	runtimeAvailable: true,
	proofVerified: true,
	roles: { framework: "0x11", "workspace/": "0x22" },
	diagnostics: {
		updateTransactions: [],
		verification: "UNVERIFIED",
		digest: "a",
		failure: undefined,
		stableTickObserved: true,
		uploadObserved: false,
		frameworkDriftObserved: false,
		applicationDriftObserved: false,
	},
};
it("persists one write intent before an ambiguous chat and never replays it", async () => {
	const dir = await mkdtemp(join(tmpdir(), "probe-"));
	let time = 0,
		writes = 0;
	const transport: ProbeTransport = {
		observe: async () => ({
			...observation,
			at: time,
			diagnostics: { ...observation.diagnostics, digest: String(time) },
		}),
		now: () => time,
		sleep: async (ms) => {
			time += ms;
		},
		write: async (content) => {
			writes++;
			expect(content).toContain("counter: 1");
			const saved = JSON.parse(
				await readFile(join(dir, "persistence.json"), "utf8"),
			);
			expect(saved.expected).toBe(content);
			expect(saved.mutationRequested).toBe(true);
			throw new Error("ambiguous timeout secret=not-public");
		},
	};
	try {
		expect(
			(await runPersistence(dir, "baseline", false, transport, 120000)).status,
		).toBe("BASELINE_OBSERVED");
		expect((await runPersistence(dir, "write", false, transport)).status).toBe(
			"EXECUTE_REQUIRED",
		);
		expect(writes).toBe(0);
		const first = await runPersistence(dir, "write", true, transport);
		expect(first.status).toBe("INCONCLUSIVE");
		expect(JSON.stringify(first)).not.toContain("not-public");
		await runPersistence(dir, "write", true, transport);
		expect(writes).toBe(1);
		const confirm = await runPersistence(
			dir,
			"confirm",
			false,
			transport,
			30000,
		);
		expect(confirm.status).toBe("INCONCLUSIVE");
		expect(
			(await runPersistence(dir, "recreate", true, transport)).status,
		).toBe("BLOCKED");
		expect(
			(await runPersistence(dir, "restore", true, transport))
				.restorationVerified,
		).toBe(false);
	} finally {
		await rm(dir, { recursive: true, force: true });
	}
});
it("halts on deterministic update failure even after an upload, with no writes", async () => {
	const dir = await mkdtemp(join(tmpdir(), "probe-failure-"));
	let writes = 0;
	const transport: ProbeTransport = {
		observe: async () => ({
			...observation,
			diagnostics: {
				...observation.diagnostics,
				uploadObserved: true,
				failure: "BLOCK_GAS_LIMIT",
			},
		}),
		write: async () => {
			writes++;
		},
		now: () => 0,
		sleep: async () => {},
	};
	try {
		expect(
			(await runPersistence(dir, "baseline", false, transport)).status,
		).toBe("FAILED");
		expect((await runPersistence(dir, "write", true, transport)).status).toBe(
			"FAILED",
		);
		expect(writes).toBe(0);
	} finally {
		await rm(dir, { recursive: true, force: true });
	}
});
it("blocks a timed-out or unverifiable baseline without issuing a mutation", async () => {
	const dir = await mkdtemp(join(tmpdir(), "probe-timeout-"));
	let time = 0,
		writes = 0;
	const transport: ProbeTransport = {
		now: () => time,
		sleep: async (ms) => {
			time += ms;
		},
		observe: async () => ({ ...observation, at: time, proofVerified: false }),
		write: async () => {
			writes++;
		},
	};
	try {
		expect(
			(await runPersistence(dir, "baseline", false, transport, 30000)).status,
		).toBe("BLOCKED");
		expect(time).toBeLessThanOrEqual(30000);
		expect((await runPersistence(dir, "write", true, transport)).status).toBe(
			"BLOCKED",
		);
		expect(writes).toBe(0);
	} finally {
		await rm(dir, { recursive: true, force: true });
	}
});
