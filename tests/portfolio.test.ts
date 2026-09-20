import { expect, test } from "vitest";
import { holdingValue, nextAction } from "../src/portfolio.js";
import {
	config,
	holding,
	snapshot,
	tao,
	usdB,
	usdBase,
	usdR,
	zero,
} from "./fixtures.js";

const strategy = config.strategy;

test("values 6-decimal holdings exactly beyond Number precision", () => {
	expect(
		holdingValue({
			...holding(usdBase, 0n, 250000000n),
			units: 9007199254740993n,
		}),
	).toBe(2251799813685248250n);
});
test("sells overweight tokens before buying deficits", () => {
	expect(nextAction(strategy, snapshot(800n, 200n))).toEqual({
		kind: "swap",
		from: tao,
		to: usdR,
		amount: 200n * 10n ** 18n,
	});
});
test("an exactly balanced portfolio stays idle", () => {
	expect(nextAction(strategy, snapshot(600n, 400n))).toEqual({
		kind: "idle",
		reason: "WITHIN_THRESHOLDS",
	});
});
test("moves funding cash to the largest chain deficit", () => {
	expect(nextAction(strategy, snapshot(0n, 0n, 0n, 0n, 1000n))).toEqual({
		kind: "transfer",
		from: usdBase,
		to: usdR,
		amount: 600000000n,
	});
});
test("uses existing destination cash without a bridge", () => {
	expect(nextAction(strategy, snapshot(0n, 400n, 600n))).toEqual({
		kind: "swap",
		from: usdR,
		to: tao,
		amount: 600000000n,
	});
});
test("keeps cash required for the source chain positions", () => {
	expect(nextAction(strategy, snapshot(0n, 0n, 1000n))).toEqual({
		kind: "transfer",
		from: usdR,
		to: usdB,
		amount: 400000000n,
	});
});
test("counts deposits in global target value", () => {
	expect(nextAction(strategy, snapshot(600n, 400n, 0n, 0n, 100n))).toEqual({
		kind: "transfer",
		from: usdBase,
		to: usdR,
		amount: 60000000n,
	});
});
test("prices settlement cash at its actual value", () => {
	const s = snapshot(0n, 0n, 0n, 0n, 1000n);
	s.holdings[4]!.priceUsd = 90000000n;
	expect(nextAction(strategy, s)).toEqual({
		kind: "transfer",
		from: usdBase,
		to: usdR,
		amount: 600000000n,
	});
});
test("rounds token units down and never overspends", () => {
	const s = snapshot(0n, 0n, 0n, 0n, 101n);
	s.holdings[4]!.units += 1n;
	const result = nextAction(strategy, s);
	expect(result).toEqual({
		kind: "transfer",
		from: usdBase,
		to: usdR,
		amount: 60600000n,
	});
});
test("leaves small deposits and rounding dust unspent", () => {
	expect(nextAction(strategy, snapshot(600n, 400n, 0n, 0n, 1n)).kind).toBe(
		"idle",
	);
});
test("does not liquidate small drift below its threshold", () => {
	expect(nextAction(strategy, snapshot(601n, 399n)).kind).toBe("idle");
});
test.each([
	"incomplete",
	"missing",
	"stale",
	"future",
	"negative",
	"zero-price",
	"duplicate",
	"native",
])("halts on %s data", (problem) => {
	const s = snapshot(600n, 400n);
	if (problem === "incomplete") s.complete = false;
	if (problem === "missing")
		s.holdings = s.holdings.filter((h) => h.asset.id !== zero.id);
	if (problem === "stale") s.holdings[0]!.observedAt = 0;
	if (problem === "future") s.holdings[0]!.observedAt = 100001;
	if (problem === "negative") s.holdings[0]!.units = -1n;
	if (problem === "zero-price") s.holdings[0]!.priceUsd = 0n;
	if (problem === "duplicate") s.holdings.push(s.holdings[0]!);
	if (problem === "native")
		s.holdings.push(holding({ ...tao, id: "native", symbol: "ETH" }, 100n));
	expect(() => nextAction(strategy, s)).toThrow();
});
test("uses BNB cash to buy its configured position", () => {
	expect(nextAction(strategy, snapshot(600n, 0n, 0n, 400n))).toEqual({
		kind: "swap",
		from: usdB,
		to: zero,
		amount: 400n * 10n ** 18n,
	});
});
test("values actual six-decimal Robinhood USDG units correctly", () => {
	expect(
		holdingValue({
			asset: usdR,
			units: 1000000n,
			priceUsd: 100000000n,
			observedAt: 0,
		}),
	).toBe(100000000n);
});
