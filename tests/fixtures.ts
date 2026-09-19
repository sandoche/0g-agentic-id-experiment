import { assets, cashAsset } from '../src/assets.js';
import { readConfig } from '../src/config.js';
import type { Asset, Holding, Snapshot } from '../src/types.js';

export const tao = assets.find(a => a.symbol === 'TAO')!;
export const zero = assets.find(a => a.symbol === '0G')!;
export const usdR = cashAsset(4663), usdB = cashAsset(56), usdBase = cashAsset(8453);
export const config = readConfig({
  STRATEGY_PROMPT: 'Synthetic test strategy.',
  PORTFOLIO_ALLOCATIONS: JSON.stringify([
    { symbol: 'TAO', chainId: 4663, weightBps: 6000 },
    { symbol: '0G', chainId: 56, weightBps: 4000 },
  ]),
});
export function holding(asset: Asset, tokens: bigint, priceUsd = 100000000n): Holding {
  return { asset, units: tokens * 10n ** BigInt(asset.decimals), priceUsd, observedAt: 100000 };
}
export function snapshot(taoTokens = 0n, zeroTokens = 0n, rhCash = 0n, bnbCash = 0n, baseCash = 0n): Snapshot {
  return { now: 100000, complete: true, holdings: [holding(tao, taoTokens), holding(zero, zeroTokens),
    holding(usdR, rhCash), holding(usdB, bnbCash), holding(usdBase, baseCash)] };
}
