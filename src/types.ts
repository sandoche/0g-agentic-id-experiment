export type TradingChain = 56 | 4663 | 8453 | 42161;
export type Address = `0x${string}`;
export type Asset = {
  id: string; symbol: string; chainId: TradingChain; address: Address;
  decimals: number; kind: 'position' | 'cash'; source: string;
};
export type Target = { assetId: string; weightBps: bigint };
export type Strategy = {
  prompt: string; targets: Target[]; fundingChain: 8453 | 42161;
  intervalMs: number; slippageBps: bigint; driftBps: bigint; minTradeUsd: bigint;
};
export type Config = {
  strategy: Strategy; mode: 'simulation' | 'live';
  rpcUrls: Record<TradingChain, string>; attestorUrl: string; model: string;
  credentials: { oneinch?: string; inference?: string; ownerKey?: Address };
};
export type Holding = { asset: Asset; units: bigint; priceUsd: bigint; observedAt: number };
export type Snapshot = { holdings: Holding[]; now: number; complete: boolean };
export type Action =
  | { kind: 'swap'; from: Asset; to: Asset; amount: bigint }
  | { kind: 'transfer'; from: Asset; to: Asset; amount: bigint }
  | { kind: 'idle'; reason: string };
