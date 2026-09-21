import {
	decodeFunctionData,
	encodeFunctionData,
	type Hex,
	parseAbi,
} from "viem";
import { getAsset } from "./assets.js";
import { requireTradingChain } from "./config.js";
import { requestJson } from "./market.js";
import type { Call, ExecutionResult } from "./transaction.js";
import type { Action, Address, Asset, Config, TradingChain } from "./types.js";
// Official 1inch SDK constant; bytecode fingerprints verified on each allowed chain 2026-09-20.
export const ROUTER = "0x111111125421ca6dc452d289314280a0f8842a65" as const;
export const routerCode: Record<TradingChain, Hex> = {
	56: "0x7b9ea7c1da2784fe89f77fb8dba143f593a5ebf5afe45d0970d57007a98233af",
	4663: "0x0d5525e859587ec5c9ffb49b28a7bdb74b3b7d582fd07322b7f354f652d25b63",
	8453: "0x770b14c4159d028ba8004c2d37bf91cc6111b1270bdf2afa75d4af1b77dbd75f",
	42161: "0xaae25d52ea3e7bbb8cc826b589060f063c7f6ca2c2da88bc9b3b0e0a57bd8fb6",
};
export const swapAbi = parseAbi([
	"function swap(address executor, (address srcToken,address dstToken,address srcReceiver,address dstReceiver,uint256 amount,uint256 minReturnAmount,uint256 flags) desc, bytes data) payable returns (uint256 returnAmount, uint256 spentAmount)",
]);
type SwapAction = Extract<Action, { kind: "swap" }>;
export type SwapResponse = {
	tx: { from: string; to: string; value: string; data: Hex };
	dstAmount: string;
};
export function validateSwap(
	action: SwapAction,
	wallet: Address,
	chain: number,
	spender: string,
	response: SwapResponse,
	quote: bigint,
	slippage: bigint,
): Call {
	requireTradingChain(chain);
	for (const asset of [action.from, action.to]) {
		const canonical = getAsset(asset.id);
		if (
			canonical.address !== asset.address ||
			canonical.chainId !== chain ||
			canonical.decimals !== asset.decimals
		)
			throw new Error("ASSET_MISMATCH");
	}
	if (
		action.from.id === action.to.id ||
		action.amount <= 0n ||
		quote <= 0n ||
		slippage < 1n ||
		slippage > 1000n
	)
		throw new Error("INVALID_SWAP");
	const tx = response.tx;
	if (
		spender.toLowerCase() !== ROUTER ||
		tx.to.toLowerCase() !== ROUTER ||
		tx.from.toLowerCase() !== wallet.toLowerCase() ||
		tx.value !== "0"
	)
		throw new Error("UNSAFE_TRANSACTION");
	try {
		const decoded = decodeFunctionData({ abi: swapAbi, data: tx.data });
		const [, desc] = decoded.args;
		if (
			encodeFunctionData({
				abi: swapAbi,
				functionName: decoded.functionName,
				args: decoded.args,
			}).toLowerCase() !== tx.data.toLowerCase() ||
			desc.srcToken.toLowerCase() !== action.from.address ||
			desc.dstToken.toLowerCase() !== action.to.address ||
			desc.dstReceiver.toLowerCase() !== wallet.toLowerCase() ||
			desc.amount !== action.amount ||
			desc.flags !== 0n ||
			desc.minReturnAmount < (quote * (10000n - slippage) + 9999n) / 10000n
		)
			throw new Error();
	} catch {
		throw new Error("UNSUPPORTED_CALLDATA");
	}
	return { chainId: action.from.chainId, to: ROUTER, data: tx.data, value: 0n };
}
export type SwapApi = {
	quote(action: SwapAction): Promise<bigint>;
	swap(action: SwapAction): Promise<SwapResponse>;
	spender(chain: TradingChain): Promise<string>;
};
export function createSwapApi(
	config: Config,
	wallet: Address,
	fetcher: typeof fetch = fetch,
): SwapApi {
	const request = <T>(
		chain: TradingChain,
		method: string,
		params: Record<string, string> = {},
	) => {
		requireTradingChain(chain);
		const url = new URL(`https://api.1inch.com/swap/v6.1/${chain}/${method}`);
		url.search = new URLSearchParams(params).toString();
		if (!config.credentials.oneinch) throw new Error("MISSING_TRADING_KEY");
		return requestJson<T>(
			url,
			{ headers: { Authorization: `Bearer ${config.credentials.oneinch}` } },
			fetcher,
		);
	};
	const params = (a: SwapAction) => ({
		src: a.from.address,
		dst: a.to.address,
		amount: a.amount.toString(),
	});
	return {
		async quote(a) {
			const r = await request<{ dstAmount: string }>(
				a.from.chainId,
				"quote",
				params(a),
			);
			if (!/^\d+$/.test(r.dstAmount)) throw new Error("INVALID_QUOTE");
			return BigInt(r.dstAmount);
		},
		swap(a) {
			return request(a.from.chainId, "swap", {
				...params(a),
				from: wallet,
				origin: wallet,
				receiver: wallet,
				slippage: (Number(config.strategy.slippageBps) / 100).toString(),
				allowPartialFill: "false",
				usePermit2: "false",
				disableEstimate: "true",
			});
		},
		async spender(chain) {
			return (await request<{ address: string }>(chain, "approve/spender"))
				.address;
		},
	};
}
export type SwapPort = {
	verifyRouter(chain: TradingChain): Promise<void>;
	balance(asset: Asset): Promise<bigint>;
	allowance(asset: Asset): Promise<bigint>;
	guard(): Promise<void>;
	send(call: Call): Promise<ExecutionResult>;
	approve(asset: Asset, amount: bigint): Promise<ExecutionResult>;
};
export function createSwap(
	config: Config,
	wallet: Address,
	api: SwapApi,
	port: SwapPort,
) {
	return {
		async execute(action: SwapAction): Promise<ExecutionResult> {
			await port.verifyRouter(action.from.chainId);
			const started = Date.now(),
				quote = await api.quote(action),
				response = await api.swap(action),
				spender = await api.spender(action.from.chainId);
			const call = validateSwap(
				action,
				wallet,
				action.from.chainId,
				spender,
				response,
				quote,
				config.strategy.slippageBps,
			);
			if (Date.now() - started > 30000) throw new Error("STALE_QUOTE");
			await port.guard();
			if ((await port.balance(action.from)) < action.amount)
				throw new Error("INSUFFICIENT_BALANCE");
			const allowance = await port.allowance(action.from);
			// A confirmed approval is its own cycle; the next cycle always obtains fresh balances and calldata.
			if (allowance < action.amount)
				return port.approve(action.from, allowance === 0n ? action.amount : 0n);
			await port.guard();
			return port.send(call);
		},
	};
}
