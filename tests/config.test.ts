import { expect, test } from "vitest";
import { parseUsd, readConfig, requireTradingChain } from "../src/config.js";

const allocation = [
	{ symbol: "TAO", chainId: 4663, weightBps: 6000 },
	{ symbol: "0G", chainId: 56, weightBps: 4000 },
];
const input = {
	STRATEGY_PROMPT: "Synthetic allocation test.",
	FUNDING_CHAIN_ID: "42161",
	PORTFOLIO_ALLOCATIONS: JSON.stringify(allocation),
};
test("parses weights exactly without requiring keys for simulation", () => {
	const config = readConfig(input);
	expect(config.mode).toBe("simulation");
	expect(config.strategy.fundingChain).toBe(42161);
	expect(
		config.strategy.targets.map((t: { weightBps: bigint }) => t.weightBps),
	).toEqual([6000n, 4000n]);
	expect(config.model).toBe("glm-5.3");
	expect(config.strategy.intervalMs).toBe(300000);
	expect(config.strategy.slippageBps).toBe(50n);
});
test("accepts an explicit one-minute cycle and ten-percent slippage", () => {
	const config = readConfig({
		...input,
		REBALANCE_INTERVAL_MS: "60000",
		MAX_SLIPPAGE_BPS: "1000",
	});
	expect(config.strategy.intervalMs).toBe(60000);
	expect(config.strategy.slippageBps).toBe(1000n);
});
test.each([undefined, ""])(
	"defaults an unset or empty attestor to mainnet without enabling live trading (%s)",
	(attestor) => {
		const config = readConfig({ ...input, AGENTIC_ATTESTOR_URL: attestor });
		expect(config.attestorUrl).toBe("https://agenticid-mainnet.0g.ai");
		expect(config.mode).toBe("simulation");
	},
);
test.each([
	"https://agenticid-mainnet.0g.ai",
	"https://agenticid.0g.ai",
	"https://attestor.example",
])("preserves the explicitly selected AgenticID environment %s", (endpoint) => {
	const config = readConfig({
		...input,
		AGENTIC_ATTESTOR_URL: `${endpoint}/`,
	});
	expect(config.attestorUrl).toBe(endpoint);
	expect(config.rpcUrls).toEqual(readConfig(input).rpcUrls);
	expect(config.mode).toBe("simulation");
});
test.each([1, 16602, 46630, 0, NaN])(
	"rejects forbidden trading chain %s",
	(chain) => {
		expect(() => requireTradingChain(chain)).toThrow("CHAIN_NOT_ALLOWED");
	},
);
test.each(["1e3", "-1", "NaN", "Infinity", "1.000000001", "0x10", ""])(
	"rejects invalid USD %s",
	(value) => {
		expect(() => parseUsd(value)).toThrow("INVALID_USD");
	},
);
test("parses USD without floating point", () => {
	expect(parseUsd("5.25")).toBe(525000000n);
	expect(parseUsd("9007199254740993.00000001")).toBe(900719925474099300000001n);
});
test.each([
	{ FUNDING_CHAIN_ID: "1" },
	{ FUNDING_CHAIN_ID: "56" },
	{ STRATEGY_PROMPT: "" },
	{ TRADING_MODE: "automatic" },
	{ REBALANCE_INTERVAL_MS: "1" },
	{ REBALANCE_INTERVAL_MS: "59999" },
	{ REBALANCE_INTERVAL_MS: "300001" },
	{ MAX_SLIPPAGE_BPS: "1001" },
	{ MAX_SLIPPAGE_BPS: "0" },
	{ MIN_TRADE_USD: "0" },
	{ DRIFT_THRESHOLD_BPS: "-1" },
	{ OWNER_PRIVATE_KEY: "secret-test-key" },
	{ BASE_RPC_URL: "http://insecure.example" },
])("rejects invalid settings without leaking inputs", (override) => {
	expect(() => readConfig({ ...input, ...override })).toThrow();
	try {
		readConfig({ ...input, ...override });
	} catch (error) {
		expect(String(error)).not.toContain("secret-test-key");
	}
});
test.each(
	[
		[{ symbol: "TAO", chainId: 4663, weightBps: 5000 }],
		[
			{ symbol: "TAO", chainId: 4663, weightBps: 6000 },
			{ symbol: "TAO", chainId: 4663, weightBps: 4000 },
		],
		[{ symbol: "TAO", chainId: 4663, weightBps: 10000.5 }],
		[{ symbol: "TAO", chainId: 4663, weightBps: -1 }],
		[{ symbol: "VIRTUAL", chainId: 8453, weightBps: 10000 }],
		[{ symbol: "RENDER", chainId: 56, weightBps: 10000 }],
		[{ symbol: "TAO", chainId: 1, weightBps: 10000 }],
	].map((allocations) => ({ allocations })),
)("rejects invalid or removed positions", ({ allocations }) => {
	expect(() =>
		readConfig({
			...input,
			PORTFOLIO_ALLOCATIONS: JSON.stringify(allocations),
		}),
	).toThrow();
});
test("requires both opt-in and keys before live configuration", () => {
	expect(() => readConfig({ ...input, TRADING_MODE: "live" })).toThrow(
		"MISSING_TRADING_KEY",
	);
});
