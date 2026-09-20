import { decodeFunctionData, encodeAbiParameters, erc20Abi } from "viem";
import { afterEach, expect, test, vi } from "vitest";
import { assets } from "../src/assets.js";
import { createMarket, parsePrice, requestJson } from "../src/market.js";
import { config, tao, zero } from "./fixtures.js";

afterEach(() => vi.useRealTimers());
test("returns parsed HTTP data", async () => {
	expect(
		await requestJson(new URL("https://example.org"), {}, async () =>
			Response.json({ ok: true }),
		),
	).toEqual({ ok: true });
});
test.each([401, 403, 400])(
	"sanitizes HTTP %s without retrying",
	async (status) => {
		let calls = 0;
		await expect(
			requestJson(new URL("https://example.org"), {}, async () => {
				calls++;
				return new Response("secret-fixture", { status });
			}),
		).rejects.toThrow(`HTTP_${status}`);
		expect(calls).toBe(1);
	},
);
test("retries rate limiting then returns the successful body", async () => {
	let calls = 0;
	expect(
		await requestJson(new URL("https://example.org"), {}, async () =>
			++calls < 2
				? new Response("", { status: 429, headers: { "Retry-After": "0" } })
				: Response.json({ found: 1 }),
		),
	).toEqual({ found: 1 });
});
test("bounds transient read retries", async () => {
	let calls = 0;
	await expect(
		requestJson(new URL("https://example.org"), {}, async () => {
			calls++;
			return new Response("", { status: 503, headers: { "Retry-After": "0" } });
		}),
	).rejects.toThrow("HTTP_503");
	expect(calls).toBe(3);
});
test("never retries mutations", async () => {
	let calls = 0;
	await expect(
		requestJson(
			new URL("https://example.org"),
			{ method: "POST" },
			async () => {
				calls++;
				return new Response("", { status: 503 });
			},
		),
	).rejects.toThrow("HTTP_503");
	expect(calls).toBe(1);
});
test("rejects malformed data and redirects without reflecting bodies", async () => {
	await expect(
		requestJson(
			new URL("https://example.org"),
			{},
			async () => new Response("secret-fixture"),
		),
	).rejects.toThrow("INVALID_JSON");
	await expect(
		requestJson(
			new URL("https://example.org"),
			{},
			async () => new Response("", { status: 302 }),
		),
	).rejects.toThrow("HTTP_302");
});
test("truncates price precision to USD units without floating-point rounding", () => {
	expect(parsePrice("0.22616415486583122")).toBe(22616415n);
	expect(parsePrice("1.0001433194658422")).toBe(100014331n);
});
test.each([null, undefined, 1, "NaN", "-1", "0", "0.000000001"])(
	"rejects invalid/unrepresentable price %s",
	(value) => {
		expect(() => parsePrice(value)).toThrow("INVALID_PRICE");
	},
);

type Problem =
	| "none"
	| "wrong-chain"
	| "no-code"
	| "decimals"
	| "missing-price"
	| "rpc-failure"
	| "halt";
function transport(problem: Problem = "none"): typeof fetch {
	return async (input, init) => {
		const url = new URL(String(input));
		if (url.hostname === "api.1inch.com") {
			const requested = url.pathname.split("/").at(-1)!.split(",");
			return Response.json(
				Object.fromEntries(
					requested
						.filter((a) => problem !== "missing-price" || a !== zero.address)
						.map((a) => [a, "2.00000000001"]),
				),
			);
		}
		if (url.hostname === "api.robinhood.com") {
			if (url.pathname.includes("/prices/"))
				return Response.json({
					quotes: [
						{
							tokenSymbol: "NVDA",
							isTradingHalt: problem === "halt",
							generatedAt: new Date().toISOString(),
						},
					],
				});
			return Response.json({
				assets: assets
					.filter((a) => a.chainId === 4663 && a.kind === "position")
					.map((a) => ({
						tokenSymbol: a.symbol,
						tokenDecimals: 18,
						status: "ACTIVE",
						currentMultiplier: "2",
						deployments: [{ chainId: 4663, contractAddress: a.address }],
						tradingCapabilities: Object.fromEntries(
							["market", "extended", "overnight"].map((s) => [
								s,
								{
									fractional: "TRADING_STATUS_TRADABLE",
									whole: "TRADING_STATUS_TRADABLE",
								},
							]),
						),
					})),
			});
		}
		const body = JSON.parse(String(init?.body));
		const chain = url.hostname.includes("robinhood")
			? 4663
			: url.hostname.includes("bnbchain")
				? 56
				: 8453;
		if (problem === "rpc-failure" && chain === 56)
			throw new Error("provider-fixture-error");
		let result: unknown = "0x";
		if (body.method === "eth_chainId")
			result = `0x${(problem === "wrong-chain" ? 1 : chain).toString(16)}`;
		if (body.method === "eth_getCode")
			result = problem === "no-code" ? "0x" : "0x6000";
		if (body.method === "eth_call") {
			const address = body.params[0].to.toLowerCase();
			const asset = assets.find(
				(a) => a.chainId === chain && a.address === address,
			)!;
			const { functionName } = decodeFunctionData({
				abi: erc20Abi,
				data: body.params[0].data,
			});
			const decimals = ["USDC", "USDG"].includes(asset.symbol) ? 6 : 18;
			if (functionName === "decimals")
				result = encodeAbiParameters(
					[{ type: "uint8" }],
					[problem === "decimals" ? 1 : decimals],
				);
			if (functionName === "symbol")
				result = encodeAbiParameters([{ type: "string" }], [asset.symbol]);
			if (functionName === "balanceOf")
				result = encodeAbiParameters(
					[{ type: "uint256" }],
					[10n ** BigInt(decimals)],
				);
		}
		return Response.json({ jsonrpc: "2.0", id: body.id, result });
	};
}
test("reads all configured chains and cash tokens as a single portfolio", async () => {
	const market = createMarket(
		{ ...config, credentials: { oneinch: "test-key" } },
		transport(),
	);
	await market.preflight();
	const result = await market.snapshot(
		"0x0000000000000000000000000000000000000001",
	);
	expect(result.complete).toBe(true);
	expect(result.holdings).toHaveLength(5);
	expect(result.holdings.find((h) => h.asset.id === tao.id)?.priceUsd).toBe(
		200000000n,
	);
});
test.each(["wrong-chain", "no-code", "decimals"] as const)(
	"fails asset preflight on %s",
	async (problem) => {
		await expect(
			createMarket(config, transport(problem)).preflight(),
		).rejects.toThrow();
	},
);
test.each(["missing-price", "rpc-failure"] as const)(
	"refuses partial portfolio valuation on %s",
	async (problem) => {
		await expect(
			createMarket(
				{ ...config, credentials: { oneinch: "test-key" } },
				transport(problem),
			).snapshot("0x0000000000000000000000000000000000000001"),
		).rejects.toThrow();
	},
);
test("skips halted stocks", async () => {
	vi.useFakeTimers();
	vi.setSystemTime(new Date("2026-09-21T15:00:00Z"));
	const nvda = assets.find((a) => a.symbol === "NVDA")!;
	const market = createMarket(config, transport("halt"));
	expect(await market.tradable(nvda)).toBe(false);
});
test("refuses stale vendor timestamps", async () => {
	vi.useFakeTimers();
	vi.setSystemTime(new Date("2026-09-21T15:00:00Z"));
	const nvda = assets.find((a) => a.symbol === "NVDA")!;
	const base = transport();
	const market = createMarket(config, async (input, init) =>
		String(input).includes("/prices/")
			? Response.json({
					quotes: [
						{
							tokenSymbol: "NVDA",
							isTradingHalt: false,
							generatedAt: "2000-01-01T00:00:00Z",
						},
					],
				})
			: base(input, init),
	);
	expect(await market.tradable(nvda)).toBe(false);
});
test("uses token prices without applying the underlying share multiplier again", async () => {
	const nvda = assets.find((a) => a.symbol === "NVDA")!;
	const stockConfig = {
		...config,
		credentials: { oneinch: "fixture" },
		strategy: {
			...config.strategy,
			targets: [{ assetId: nvda.id, weightBps: 10000n }],
		},
	};
	const market = createMarket(stockConfig, transport());
	await market.preflight();
	const result = await market.snapshot(
		"0x0000000000000000000000000000000000000001",
	);
	expect(result.holdings.find((h) => h.asset.id === nvda.id)?.priceUsd).toBe(
		200000000n,
	);
});
