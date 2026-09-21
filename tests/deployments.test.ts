import { execFileSync } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { hostname, tmpdir } from "node:os";
import { join } from "node:path";
import type { AgenticID } from "@0gfoundation/0g-agenticid-sdk";
import { privateKeyToAccount } from "viem/accounts";
import { expect, it } from "vitest";
import * as records from "../src/deployments.js";

const environment = {
	chainId: 16661,
	registry: `0x${"11".repeat(20)}` as const,
};
it("isolates profiles, chains and registries and rejects explicit mismatches", () => {
	const a = records.deploymentDirectory("minimal", environment);
	expect(
		records.deploymentDirectory("portfolio-manager", environment),
	).not.toBe(a);
	expect(
		records.deploymentDirectory("minimal", { ...environment, chainId: 16602 }),
	).not.toBe(a);
	expect(
		records.deploymentDirectory("minimal", {
			...environment,
			registry: `0x${"22".repeat(20)}`,
		}),
	).not.toBe(a);
	const record = {
		version: 1,
		profile: "minimal",
		environment,
		idempotencyKey: "intent",
		checksum: "a".repeat(64),
		owner: `0x${"33".repeat(20)}`,
		agentId: "42",
	};
	expect(() =>
		records.validateRecord(record, "minimal", environment, "43"),
	).toThrow("DEPLOYMENT_IDENTITY_MISMATCH");
	expect(() =>
		records.validateRecord(record, "portfolio-manager", environment),
	).toThrow("DEPLOYMENT_PROFILE_MISMATCH");
	expect(() =>
		records.validateRecord(record, "minimal", {
			...environment,
			chainId: 16602,
		}),
	).toThrow("DEPLOYMENT_ENVIRONMENT_MISMATCH");
});
it("fails closed for ambiguous legacy records and preserves their bytes", async () => {
	const root = await mkdtemp(join(tmpdir(), "deployment-"));
	try {
		const legacy = '{"idempotencyKey":"old-intent","agentId":"3670626"}';
		await writeFile(join(root, "deployment.json"), legacy);
		expect(
			await records.readRecord("minimal", environment, root),
		).toBeUndefined();
		await expect(
			records.readRecord("portfolio-manager", environment, root),
		).rejects.toThrow("LEGACY_DEPLOYMENT_REQUIRES_VERIFIED_MIGRATION");
		expect(await readFile(join(root, "deployment.json"), "utf8")).toBe(legacy);
	} finally {
		await rm(root, { recursive: true, force: true });
	}
});
it("excludes concurrent operations and releases locks after errors", async () => {
	const dir = await mkdtemp(join(tmpdir(), "deployment-lock-"));
	try {
		await expect(
			records.withOperationLock(dir, async () => {
				await expect(
					records.withOperationLock(dir, async () => "bad"),
				).rejects.toThrow("OPERATION_LOCKED");
				throw new Error("interrupted");
			}),
		).rejects.toThrow("interrupted");
		expect(await records.withOperationLock(dir, async () => "resumed")).toBe(
			"resumed",
		);
	} finally {
		await rm(dir, { recursive: true, force: true });
	}
});
it("recovers only a dead same-host lock and preserves foreign locks", async () => {
	const dir = await mkdtemp(join(tmpdir(), "dead-deploy-"));
	try {
		const pid = Number(
			execFileSync(
				process.execPath,
				["-e", "process.stdout.write(String(process.pid))"],
				{ windowsHide: true },
			),
		);
		await writeFile(
			join(dir, "operation.lock"),
			JSON.stringify({ host: hostname(), pid }),
		);
		expect(await records.withOperationLock(dir, async () => "resumed")).toBe(
			"resumed",
		);
		await writeFile(
			join(dir, "operation.lock"),
			JSON.stringify({ host: "another-host", pid }),
		);
		await expect(
			records.withOperationLock(dir, async () => "unsafe"),
		).rejects.toThrow("OPERATION_LOCKED");
	} finally {
		await rm(dir, { recursive: true, force: true });
	}
});
it("copies a minted legacy portfolio record only after chain identity and owner validation", async () => {
	const root = await mkdtemp(join(tmpdir(), "legacy-migrate-"));
	const ownerKey = `0x${"03".repeat(32)}` as const;
	const sealId = `0x${"44".repeat(32)}` as const;
	const wallet = `0x${"55".repeat(20)}` as const;
	const legacy = JSON.stringify({
		agentId: "42",
		sealId,
		agentSealAddr: wallet,
		checksum: "a".repeat(64),
		idempotencyKey: "original-key",
	});
	const config = {
		model: "glm-5.3",
		attestorUrl: "https://example.com",
		credentials: { ownerKey },
	};
	let currentSeal = sealId as string;
	const ag = {
		agent: {
			getSealId: async () => currentSeal,
			getAgentSeal: async () => wallet,
			ownerOf: async () => privateKeyToAccount(ownerKey).address,
		},
	} as unknown as AgenticID;
	try {
		await writeFile(join(root, "deployment.json"), legacy);
		currentSeal = `0x${"66".repeat(32)}`;
		await expect(
			records.migrateLegacy(config, ag, environment, 42n, root),
		).rejects.toThrow("LEGACY_IDENTITY_MISMATCH");
		currentSeal = sealId;
		await records.migrateLegacy(config, ag, environment, 42n, root);
		expect(
			(await records.readRecord("portfolio-manager", environment, root))
				?.idempotencyKey,
		).toBe("original-key");
		expect(await readFile(join(root, "deployment.json"), "utf8")).toBe(legacy);
	} finally {
		await rm(root, { recursive: true, force: true });
	}
});
