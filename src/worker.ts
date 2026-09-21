import { randomUUID } from "node:crypto";
import { cashAsset } from "./assets.js";
import { type Event, safeEvent } from "./log.js";
import type { Market } from "./market.js";
import { nextAction } from "./portfolio.js";
import type { Store } from "./state.js";
import type { ExecutionResult } from "./transaction.js";
import type { Action, Address, Config } from "./types.js";
export type Execution = {
	execute(action: Exclude<Action, { kind: "idle" }>): Promise<ExecutionResult>;
	reconcile(): Promise<ExecutionResult>;
};
export type Configuration = { oneinch: string; mode: "simulation" | "live" };
export function validateConfiguration(value: unknown): Configuration {
	const c = value as Configuration;
	if (
		!c ||
		typeof c !== "object" ||
		Object.keys(c).sort().join(",") !== "mode,oneinch" ||
		typeof c.oneinch !== "string" ||
		c.oneinch.length < 1 ||
		c.oneinch.length > 2048 ||
		!["live", "simulation"].includes(c.mode)
	)
		throw new Error("INVALID_CONFIGURATION");
	return c;
}
export function createWorker(
	config: Config,
	market: Market,
	execution: Execution,
	store: Store,
	readOwner: () => Promise<Address>,
	logger: (event: Event) => Promise<unknown>,
) {
	let active = false,
		busy = false,
		state = "awaiting_configuration",
		lastCycleId: string | undefined,
		pendingId: string | undefined;
	let timer: ReturnType<typeof setInterval> | undefined;
	let generation = 0;
	const drained: (() => void)[] = [];
	const finish = () => {
		busy = false;
		for (const resolve of drained.splice(0)) resolve();
	};
	const events: Event[] = [];
	async function emit(event: Event) {
		const j = await store.load();
		event.sequence = ++j.sequence;
		await store.save(j);
		const safe = safeEvent(event as unknown as Record<string, unknown>);
		events.push(safe);
		if (events.length > 300) events.shift();
		await logger(safe);
	}
	async function guard() {
		if (!active) throw new Error("NOT_CONFIGURED");
		let owner: Address;
		try {
			owner = await readOwner();
		} catch {
			state = "paused";
			throw new Error("OWNER_UNAVAILABLE");
		}
		if (owner.toLowerCase() !== (await store.load()).owner.toLowerCase()) {
			config.credentials = {};
			active = false;
			state = "paused";
			throw new Error("OWNER_CHANGED");
		}
		if (!active) throw new Error("NOT_CONFIGURED");
	}
	const worker = {
		guard,
		emit,
		status: () => ({
			mode: config.mode,
			state,
			...(lastCycleId ? { lastCycleId } : {}),
			...(pendingId ? { pendingId } : {}),
		}),
		events: (after: number) =>
			events.filter((e) => (e.sequence ?? 0) > after).slice(0, 100),
		async configure(input: Configuration, owner: Address) {
			const c = validateConfiguration(input);
			if (busy) throw new Error("WORKER_BUSY");
			busy = true;
			const started = generation;
			try {
				if ((await readOwner()).toLowerCase() !== owner.toLowerCase())
					throw new Error("OWNER_CHANGED");
				await market.preflight();
				if (started !== generation) throw new Error("NOT_CONFIGURED");
				const j = await store.load();
				j.owner = owner;
				await store.save(j);
				if (started !== generation) throw new Error("NOT_CONFIGURED");
				config.credentials = { oneinch: c.oneinch };
				config.mode = c.mode;
				active = true;
				state = "ready";
				await emit({ type: "configured", time: Date.now() });
			} finally {
				finish();
			}
		},
		async tick() {
			if (busy || !active) return;
			busy = true;
			lastCycleId = randomUUID();
			try {
				await guard();
				state = "running";
				const initial = await store.load();
				pendingId = initial.pending?.id;
				await emit({ type: "cycle", time: Date.now(), cycleId: lastCycleId });
				if (initial.pending) {
					if (config.mode !== "live") {
						state = "pending";
						return;
					}
					const result = await execution.reconcile();
					state = result === "pending" ? "pending" : "ready";
					pendingId = (await store.load()).pending?.id;
					return;
				}
				const s = await market.snapshot(initial.wallet);
				if (config.mode === "simulation") {
					const j = await store.load();
					if (!j.paper) {
						j.paper = Object.fromEntries(
							s.holdings.map((h) => [h.asset.id, h.units]),
						);
						if (s.holdings.every((h) => h.units === 0n)) {
							const cash = cashAsset(config.strategy.fundingChain);
							j.paper[cash.id] = 1000n * 10n ** BigInt(cash.decimals);
						}
						await store.save(j);
					}
					for (const h of s.holdings) h.units = j.paper[h.asset.id] ?? 0n;
				}
				const action = nextAction(config.strategy, s);
				await guard();
				if (action.kind === "idle") {
					state = "ready";
					await emit({ type: "idle", time: Date.now(), code: action.reason });
					return;
				}
				if (
					!(await market.tradable(action.from)) ||
					!(await market.tradable(action.to))
				) {
					state = "ready";
					await emit({ type: "idle", time: Date.now(), code: "MARKET_CLOSED" });
					return;
				}
				await guard();
				if (config.mode === "simulation") {
					const j = await store.load(),
						from = s.holdings.find((h) => h.asset.id === action.from.id)!,
						to = s.holdings.find((h) => h.asset.id === action.to.id)!;
					const received =
						(action.amount *
							from.priceUsd *
							10n ** BigInt(to.asset.decimals) *
							(10000n - config.strategy.slippageBps)) /
						(10n ** BigInt(from.asset.decimals) * to.priceUsd * 10000n);
					j.paper![from.asset.id] = from.units - action.amount;
					j.paper![to.asset.id] = to.units + received;
					await store.save(j);
					await emit({
						type: "simulation",
						time: Date.now(),
						chainId: action.from.chainId,
						code: "SIMULATED",
					});
					state = "ready";
				} else {
					const result = await execution.execute(action);
					state = result === "pending" ? "pending" : "ready";
					pendingId = (await store.load()).pending?.id;
				}
			} catch (e) {
				const code =
					e instanceof Error &&
					[
						"OWNER_CHANGED",
						"OWNER_UNAVAILABLE",
						"NOT_CONFIGURED",
						"TX_REVERTED",
						"INSUFFICIENT_GAS",
						"UNSUPPORTED_CALLDATA",
					].includes(e.message)
						? e.message
						: "EXECUTION_FAILED";
				if (active) state = "paused";
				await emit({
					type: "error",
					time: Date.now(),
					cycleId: lastCycleId,
					code,
				});
			} finally {
				finish();
			}
		},
		start() {
			if (!timer)
				timer = setInterval(() => {
					void worker.tick().catch(() => {
						state = "paused";
						active = false;
					});
				}, config.strategy.intervalMs);
		},
		async stop() {
			generation++;
			active = false;
			state = "stopped";
			config.credentials = {};
			if (timer) clearInterval(timer);
			timer = undefined;
		},
		async drain() {
			if (busy) await new Promise<void>((resolve) => drained.push(resolve));
		},
	};
	return worker;
}
export type Worker = ReturnType<typeof createWorker>;
