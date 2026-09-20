import { createReadStream } from "node:fs";
import { createInterface } from "node:readline";
import { parse } from "dotenv";

const names = new Set([
	"ONEINCH_API_KEY",
	"AGENT_API_KEY",
	"OWNER_PRIVATE_KEY",
	"AGENTIC_ATTESTOR_URL",
	"INFERENCE_MODEL",
	"TRADING_MODE",
	"REBALANCE_INTERVAL_MS",
	"MAX_SLIPPAGE_BPS",
	"DRIFT_THRESHOLD_BPS",
	"MIN_TRADE_USD",
	"FUNDING_CHAIN_ID",
	"BASE_RPC_URL",
	"ARBITRUM_RPC_URL",
	"ROBINHOOD_RPC_URL",
	"BNB_RPC_URL",
	"PORTFOLIO_ALLOCATIONS",
	"STRATEGY_PROMPT",
]);
export async function loadEnvironment(
	path: string,
	owner: boolean,
): Promise<Record<string, string | undefined>> {
	const result: Record<string, string | undefined> = {};
	for (const name of names)
		if (
			(owner || name !== "OWNER_PRIVATE_KEY") &&
			process.env[name] !== undefined
		)
			result[name] = process.env[name];
	const stream = createReadStream(path),
		lines = createInterface({ input: stream, crlfDelay: Infinity });
	let pending: { key: string; text: string } | undefined;
	const complete = (text: string) => {
		const value = text.slice(text.indexOf("=") + 1).trimStart(),
			quote = value[0];
		if (!quote || !['"', "'", "`"].includes(quote)) return true;
		for (let i = 1; i < value.length; i++) {
			if (value[i] === "\\" && value[i + 1] === quote) {
				i++;
				continue;
			}
			if (value[i] === quote) return /^\s*(?:#.*)?$/.test(value.slice(i + 1));
		}
		return false;
	};
	try {
		for await (const line of lines) {
			if (pending) {
				pending.text += `\n${line}`;
				if (complete(pending.text)) {
					result[pending.key] = parse(pending.text)[pending.key];
					pending = undefined;
				}
				continue;
			}
			const key = line.match(/^\s*(?:export\s+)?([A-Z_]+)\s*=/)?.[1];
			if (
				!key ||
				!names.has(key) ||
				(!owner && key === "OWNER_PRIVATE_KEY") ||
				result[key] !== undefined
			)
				continue;
			if (complete(line)) result[key] = parse(line)[key];
			else pending = { key, text: line };
		}
	} catch (e) {
		if ((e as NodeJS.ErrnoException).code !== "ENOENT")
			throw new Error("ENV_READ_FAILED");
	} finally {
		lines.close();
		stream.destroy();
	}
	if (pending) throw new Error("ENV_UNTERMINATED_VALUE");
	return result;
}
