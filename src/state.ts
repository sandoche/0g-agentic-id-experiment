import { randomUUID } from "node:crypto";
import { mkdir, open, readFile, rename, unlink } from "node:fs/promises";
import { hostname } from "node:os";
import { join } from "node:path";
import type { Address } from "./types.js";
export type Journal = {
	version: 1;
	wallet: Address;
	owner: Address;
	sequence: number;
	pending?: { kind: "transaction" | "fusion"; id: string; payload: unknown };
	paper?: Record<string, bigint>;
};
export type Store = {
	load(): Promise<Journal>;
	save(value: Journal): Promise<void>;
	lock(): Promise<void>;
	close(): Promise<void>;
};
export const stringify = (value: unknown) =>
	JSON.stringify(value, (_, v) =>
		typeof v === "bigint" ? { $bigint: v.toString() } : v,
	);
export const parse = (value: string) =>
	JSON.parse(value, (_, v) =>
		v &&
		typeof v === "object" &&
		Object.keys(v).length === 1 &&
		typeof v.$bigint === "string" &&
		/^-?\d+$/.test(v.$bigint)
			? BigInt(v.$bigint)
			: v,
	);
export async function atomicWrite(path: string, data: string): Promise<void> {
	const temporary = `${path}.${randomUUID()}.tmp`;
	const handle = await open(temporary, "wx", 0o600);
	try {
		await handle.writeFile(data);
		await handle.sync();
	} finally {
		await handle.close();
	}
	await rename(temporary, path);
}
function missing(e: unknown) {
	return (e as NodeJS.ErrnoException)?.code === "ENOENT";
}
export function createStore(directory: string, wallet: Address): Store {
	const path = join(directory, "journal.json"),
		lockPath = join(directory, "worker.lock");
	const token = randomUUID();
	let locked = false;
	const empty = (): Journal => ({
		version: 1,
		wallet,
		owner: "0x0000000000000000000000000000000000000000",
		sequence: 0,
	});
	return {
		async lock() {
			if (locked) throw new Error("WORKER_ALREADY_RUNNING");
			await mkdir(directory, { recursive: true, mode: 0o700 });
			// Serialize acquisition AND stale-lock recovery so a racing reaper cannot unlink a new lock.
			let guard: Awaited<ReturnType<typeof open>>;
			try {
				guard = await open(`${lockPath}.guard`, "wx", 0o600);
			} catch {
				throw new Error("WORKER_ALREADY_RUNNING");
			}
			try {
				try {
					const previous = JSON.parse(await readFile(lockPath, "utf8"));
					if (
						previous.host !== hostname() ||
						!Number.isSafeInteger(previous.pid) ||
						previous.pid <= 0
					)
						throw new Error("WORKER_ALREADY_RUNNING");
					let dead = false;
					try {
						process.kill(previous.pid, 0);
					} catch (e) {
						dead = (e as NodeJS.ErrnoException).code === "ESRCH";
					}
					if (!dead) throw new Error("WORKER_ALREADY_RUNNING");
					await unlink(lockPath);
				} catch (e) {
					if (!missing(e)) throw e;
				}
				const handle = await open(lockPath, "wx", 0o600);
				try {
					await handle.writeFile(
						JSON.stringify({ pid: process.pid, host: hostname(), token }),
					);
					await handle.sync();
				} finally {
					await handle.close();
				}
				locked = true;
			} finally {
				await guard.close();
				await unlink(`${lockPath}.guard`);
			}
		},
		async close() {
			if (!locked) return;
			const current = JSON.parse(await readFile(lockPath, "utf8"));
			if (current.token !== token) throw new Error("LOCK_LOST");
			await unlink(lockPath);
			locked = false;
		},
		async load() {
			if (!locked) throw new Error("STATE_NOT_LOCKED");
			let value: Journal;
			try {
				value = parse(await readFile(path, "utf8"));
			} catch (e) {
				if (missing(e)) return empty();
				throw new Error("STATE_CORRUPT");
			}
			if (
				value?.version !== 1 ||
				!/^0x[\da-f]{40}$/i.test(value.wallet) ||
				!/^0x[\da-f]{40}$/i.test(value.owner) ||
				!Number.isSafeInteger(value.sequence) ||
				value.sequence < 0 ||
				(value.pending &&
					(!["transaction", "fusion"].includes(value.pending.kind) ||
						typeof value.pending.id !== "string" ||
						!value.pending.payload))
			)
				throw new Error("STATE_CORRUPT");
			if (value.wallet.toLowerCase() !== wallet.toLowerCase()) {
				await rename(path, join(directory, `quarantined-${randomUUID()}.json`));
				return empty();
			}
			return value;
		},
		async save(value) {
			if (!locked) throw new Error("STATE_NOT_LOCKED");
			if (value.wallet.toLowerCase() !== wallet.toLowerCase())
				throw new Error("WALLET_MISMATCH");
			await atomicWrite(path, stringify(value));
		},
	};
}
