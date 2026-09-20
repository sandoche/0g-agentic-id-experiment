import { appendFile, mkdir } from "node:fs/promises";
import { dirname } from "node:path";
import { explorers } from "./assets.js";
import type { TradingChain } from "./types.js";
export type Event = {
	type: string;
	time: number;
	sequence?: number;
	cycleId?: string;
	chainId?: TradingChain;
	txHash?: string;
	orderHash?: string;
	code?: string;
};
const types = new Set([
	"cycle",
	"idle",
	"error",
	"paused",
	"configured",
	"stopped",
	"transaction",
	"settled",
	"fusion",
	"recovery",
	"simulation",
	"ready",
]);
const codes = new Set([
	"API_FAILED",
	"RPC_READ_FAILED",
	"RPC_CHAIN_MISMATCH",
	"MARKET_CLOSED",
	"BALANCED",
	"MINIMUM_TRADE",
	"NO_FUNDS",
	"OWNER_CHANGED",
	"OWNER_UNAVAILABLE",
	"NOT_CONFIGURED",
	"PENDING",
	"STATE_CORRUPT",
	"EXECUTION_FAILED",
	"TX_REVERTED",
	"INSUFFICIENT_GAS",
	"UNSUPPORTED_CALLDATA",
	"PROOF_FAILED",
	"RECOVERY_REQUIRED",
	"SIMULATED",
	"WORKER_FAILED",
]);
export function safeEvent(input: Record<string, unknown>): Event {
	const event: Event = {
		type:
			typeof input.type === "string" && types.has(input.type)
				? input.type
				: "error",
		time: Number.isSafeInteger(input.time)
			? (input.time as number)
			: Date.now(),
	};
	if (typeof input.code === "string" && codes.has(input.code))
		event.code = input.code;
	if (Number.isSafeInteger(input.sequence) && Number(input.sequence) >= 0)
		event.sequence = input.sequence as number;
	if (typeof input.cycleId === "string" && /^[\da-f-]{36}$/.test(input.cycleId))
		event.cycleId = input.cycleId;
	if ([56, 4663, 8453, 42161].includes(input.chainId as number))
		event.chainId = input.chainId as TradingChain;
	for (const key of ["txHash", "orderHash"] as const)
		if (typeof input[key] === "string" && /^0x[\da-f]{64}$/i.test(input[key]))
			event[key] = input[key];
	return event;
}
export function createLogger(
	path: string,
	output: (line: string) => void = console.log,
) {
	let queue = Promise.resolve();
	return (input: Event) => {
		const event = safeEvent(input as unknown as Record<string, unknown>);
		const line = JSON.stringify(event);
		queue = queue.then(async () => {
			await mkdir(dirname(path), { recursive: true, mode: 0o700 });
			await appendFile(path, `${line}\n`, { mode: 0o600 });
			const link =
				event.txHash && event.chainId
					? ` ${explorers[event.chainId]}/tx/${event.txHash}`
					: "";
			output(`${line}${link}`);
		});
		return queue;
	};
}
