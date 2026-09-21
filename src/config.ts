import { assets } from "./assets.js";
import type {
	Address,
	AgentProfile,
	ApplicationConfig,
	Config,
	ConnectionConfig,
	Target,
	TradingChain,
} from "./types.js";

export function readProfile(
	env: Record<string, string | undefined>,
): AgentProfile {
	const profile = env.AGENT_PROFILE ?? "portfolio-manager";
	if (profile !== "minimal" && profile !== "portfolio-manager")
		throw new Error("INVALID_AGENT_PROFILE");
	return profile;
}
export function readConnectionConfig(
	env: Record<string, string | undefined>,
): ConnectionConfig {
	if (env.AGENTIC_ATTESTOR_URL && new URL(env.AGENTIC_ATTESTOR_URL).search)
		throw new Error("ATTESTOR_QUERY_NOT_ALLOWED");
	const ownerKey = env.OWNER_PRIVATE_KEY?.trim() || undefined;
	if (ownerKey && !/^0x[0-9a-fA-F]{64}$/.test(ownerKey))
		throw new Error("INVALID_OWNER_KEY");
	return {
		attestorUrl: url(
			env.AGENTIC_ATTESTOR_URL || "https://agenticid-mainnet.0g.ai",
		),
		model: env.INFERENCE_MODEL?.trim() || "glm-5.3",
		credentials: {
			ownerKey: ownerKey as Address | undefined,
			inference: env.AGENT_API_KEY?.trim() || undefined,
		},
	};
}
export function readApplicationConfig(
	env: Record<string, string | undefined>,
): ApplicationConfig {
	const profile = readProfile(env);
	return profile === "minimal"
		? { ...readConnectionConfig(env), profile }
		: { ...readConfig(env), profile };
}

export function requireTradingChain(chainId: number): TradingChain {
	if (![56, 4663, 8453, 42161].includes(chainId))
		throw new Error("CHAIN_NOT_ALLOWED");
	return chainId as TradingChain;
}
export function parseUsd(value: string): bigint {
	if (!/^\d+(?:\.\d{1,8})?$/.test(value)) throw new Error("INVALID_USD");
	const [whole, fraction = ""] = value.split(".");
	return BigInt(whole!) * 100000000n + BigInt(fraction.padEnd(8, "0"));
}
function integer(
	value: string,
	min: number,
	max: number,
	code: string,
): number {
	if (!/^\d+$/.test(value)) throw new Error(code);
	const number = Number(value);
	if (!Number.isSafeInteger(number) || number < min || number > max)
		throw new Error(code);
	return number;
}
function url(value: string): string {
	let parsed: URL;
	try {
		parsed = new URL(value);
	} catch {
		throw new Error("INVALID_URL");
	}
	if (
		parsed.protocol !== "https:" ||
		parsed.username ||
		parsed.password ||
		parsed.hash
	)
		throw new Error("INVALID_URL");
	return parsed.toString().replace(/\/$/, "");
}
export function readConfig(env: Record<string, string | undefined>): Config {
	let entries: unknown;
	try {
		entries = JSON.parse(env.PORTFOLIO_ALLOCATIONS ?? "null");
	} catch {
		throw new Error("INVALID_ALLOCATIONS");
	}
	if (!Array.isArray(entries) || entries.length === 0 || entries.length > 8)
		throw new Error("INVALID_ALLOCATIONS");
	const targets: Target[] = [];
	const seen = new Set<string>();
	for (const entry of entries) {
		if (
			!entry ||
			typeof entry !== "object" ||
			Object.keys(entry).some(
				(k) => !["symbol", "chainId", "weightBps"].includes(k),
			)
		) {
			throw new Error("INVALID_ALLOCATIONS");
		}
		const chain = requireTradingChain(entry.chainId);
		const asset = assets.find(
			(a) =>
				a.chainId === chain &&
				a.symbol === entry.symbol &&
				a.kind === "position",
		);
		if (!asset) throw new Error("UNKNOWN_ASSET");
		if (seen.has(asset.id)) throw new Error("DUPLICATE_ASSET");
		if (
			!Number.isSafeInteger(entry.weightBps) ||
			entry.weightBps <= 0 ||
			entry.weightBps > 10000
		)
			throw new Error("INVALID_WEIGHT");
		seen.add(asset.id);
		targets.push({ assetId: asset.id, weightBps: BigInt(entry.weightBps) });
	}
	if (targets.reduce((total, t) => total + t.weightBps, 0n) !== 10000n)
		throw new Error("WEIGHTS_MUST_TOTAL_100_PERCENT");
	const prompt = env.STRATEGY_PROMPT?.trim();
	if (!prompt) throw new Error("MISSING_STRATEGY_PROMPT");
	const fundingChain = integer(
		env.FUNDING_CHAIN_ID ?? "8453",
		1,
		100000,
		"INVALID_FUNDING_CHAIN",
	);
	if (fundingChain !== 8453 && fundingChain !== 42161)
		throw new Error("INVALID_FUNDING_CHAIN");
	const mode = env.TRADING_MODE ?? "simulation";
	if (mode !== "simulation" && mode !== "live")
		throw new Error("INVALID_TRADING_MODE");
	const oneinch = env.ONEINCH_API_KEY?.trim() || undefined;
	if (mode === "live" && !oneinch) throw new Error("MISSING_TRADING_KEY");
	const ownerKey = env.OWNER_PRIVATE_KEY?.trim() || undefined;
	if (ownerKey && !/^0x[0-9a-fA-F]{64}$/.test(ownerKey))
		throw new Error("INVALID_OWNER_KEY");
	const minTradeUsd = parseUsd(env.MIN_TRADE_USD ?? "5");
	if (minTradeUsd === 0n) throw new Error("INVALID_MINIMUM_TRADE");
	return {
		strategy: {
			prompt,
			targets,
			fundingChain,
			intervalMs: integer(
				env.REBALANCE_INTERVAL_MS ?? "300000",
				300000,
				300000,
				"INTERVAL_MUST_BE_FIVE_MINUTES",
			),
			slippageBps: BigInt(
				integer(env.MAX_SLIPPAGE_BPS ?? "50", 1, 500, "INVALID_SLIPPAGE"),
			),
			driftBps: BigInt(
				integer(env.DRIFT_THRESHOLD_BPS ?? "100", 1, 10000, "INVALID_DRIFT"),
			),
			minTradeUsd,
		},
		mode,
		model: env.INFERENCE_MODEL?.trim() || "glm-5.3",
		attestorUrl: url(
			env.AGENTIC_ATTESTOR_URL || "https://agenticid-mainnet.0g.ai",
		),
		rpcUrls: {
			8453: url(env.BASE_RPC_URL || "https://mainnet.base.org"),
			42161: url(env.ARBITRUM_RPC_URL || "https://arb1.arbitrum.io/rpc"),
			4663: url(
				env.ROBINHOOD_RPC_URL || "https://rpc.mainnet.chain.robinhood.com",
			),
			56: url(env.BNB_RPC_URL || "https://bsc-dataseed.bnbchain.org"),
		},
		credentials: {
			oneinch,
			inference: env.AGENT_API_KEY?.trim() || undefined,
			ownerKey: ownerKey as Address | undefined,
		},
	};
}
