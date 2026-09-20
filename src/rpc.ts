import { createPublicClient, defineChain, http } from "viem";
import { chainNames, explorers } from "./assets.js";
import { requireTradingChain } from "./config.js";
import type { Config, TradingChain } from "./types.js";

export function chainDefinition(id: TradingChain, rpcUrl: string) {
	requireTradingChain(id);
	return defineChain({
		id,
		name: chainNames[id],
		nativeCurrency: {
			name: id === 56 ? "BNB" : "Ether",
			symbol: id === 56 ? "BNB" : "ETH",
			decimals: 18,
		},
		rpcUrls: { default: { http: [rpcUrl] } },
		blockExplorers: { default: { name: chainNames[id], url: explorers[id] } },
	});
}
export function createRpc(
	config: Config,
	chain: TradingChain,
	fetcher: typeof fetch = fetch,
) {
	requireTradingChain(chain);
	return createPublicClient({
		chain: chainDefinition(chain, config.rpcUrls[chain]),
		transport: http(config.rpcUrls[chain], {
			fetchFn: fetcher,
			timeout: 10000,
			retryCount: 0,
		}),
	});
}
