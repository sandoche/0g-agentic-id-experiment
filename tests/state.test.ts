import { mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, it } from "vitest";
import { createStore } from "../src/state.js";

const wallet = "0x1111111111111111111111111111111111111111";
const dirs: string[] = [];
async function directory() {
	const d = await mkdtemp(join(tmpdir(), "portfolio-"));
	dirs.push(d);
	return d;
}
afterEach(async () => {
	for (const d of dirs.splice(0)) await rm(d, { recursive: true, force: true });
});
it("saves and reloads atomically with bigint payloads", async () => {
	const d = await directory(),
		s = createStore(d, wallet);
	await s.lock();
	await s.save({
		version: 1,
		wallet,
		owner: wallet,
		sequence: 4,
		pending: { kind: "fusion", id: "test", payload: { amount: 25n } },
	});
	expect((await s.load()).pending?.payload).toEqual({ amount: 25n });
	expect(await readdir(d)).not.toContain("journal.tmp");
	await s.close();
});
it("refuses corrupt journals rather than resetting balances", async () => {
	const d = await directory(),
		s = createStore(d, wallet);
	await s.lock();
	await writeFile(join(d, "journal.json"), "{broken");
	await expect(s.load()).rejects.toThrow("STATE_CORRUPT");
	await s.close();
});
it("quarantines inherited wallet state and does not replay it", async () => {
	const d = await directory(),
		s = createStore(d, wallet);
	await s.lock();
	await s.save({ version: 1, wallet, owner: wallet, sequence: 4 });
	await s.close();
	const clone = createStore(d, "0x2222222222222222222222222222222222222222");
	await clone.lock();
	expect((await clone.load()).sequence).toBe(0);
	expect((await readdir(d)).some((n) => n.startsWith("quarantined-"))).toBe(
		true,
	);
	await clone.close();
});
it("locks out a second process instance and rejects unlocked writes", async () => {
	const d = await directory(),
		a = createStore(d, wallet),
		b = createStore(d, wallet);
	await expect(
		a.save({ version: 1, wallet, owner: wallet, sequence: 0 }),
	).rejects.toThrow("STATE_NOT_LOCKED");
	await a.lock();
	await expect(b.lock()).rejects.toThrow("WORKER_ALREADY_RUNNING");
	await a.close();
	await b.lock();
	expect(await readFile(join(d, "worker.lock"), "utf8")).toContain(
		String(process.pid),
	);
	await b.close();
});
