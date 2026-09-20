import { cashAsset, getAsset } from "./assets.js";
import type { Market } from "./market.js";
import type { Config } from "./types.js";
export function paperMarket(config: Config, clock = Date.now): Market {
	const tracked = config.strategy.targets.map((t) => getAsset(t.assetId));
	const chains = [
		...new Set([
			config.strategy.fundingChain,
			...tracked.map((a) => a.chainId),
		]),
	];
	return {
		preflight: async () => {},
		tradable: async () => true,
		snapshot: async () => {
			const now = clock();
			return {
				now,
				complete: true,
				holdings: [...tracked, ...chains.map(cashAsset)].map((asset) => ({
					asset,
					units: 0n,
					priceUsd: 100000000n,
					observedAt: now,
				})),
			};
		},
	};
}
