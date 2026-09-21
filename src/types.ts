export type TradingChain = 56 | 4663 | 8453 | 42161;
export type Address = `0x${string}`;
export type Asset = {
	id: string;
	symbol: string;
	chainId: TradingChain;
	address: Address;
	decimals: number;
	kind: "position" | "cash";
	source: string;
};
export type Target = { assetId: string; weightBps: bigint };
export type Strategy = {
	prompt: string;
	targets: Target[];
	fundingChain: 8453 | 42161;
	intervalMs: number;
	slippageBps: bigint;
	driftBps: bigint;
	minTradeUsd: bigint;
};
export type AgentProfile = "minimal" | "portfolio-manager";
export type ConnectionConfig = {
	attestorUrl: string;
	model: string;
	credentials: { inference?: string; ownerKey?: Address };
};
export type MinimalConfig = ConnectionConfig & { profile: "minimal" };
export type ApplicationConfig =
	| MinimalConfig
	| (Config & { profile: "portfolio-manager" });
export type Config = ConnectionConfig & {
	strategy: Strategy;
	mode: "simulation" | "live";
	rpcUrls: Record<TradingChain, string>;
	credentials: ConnectionConfig["credentials"] & { oneinch?: string };
};
export type Holding = {
	asset: Asset;
	units: bigint;
	priceUsd: bigint;
	observedAt: number;
};
export type Snapshot = { holdings: Holding[]; now: number; complete: boolean };
export type Action =
	| { kind: "swap"; from: Asset; to: Asset; amount: bigint }
	| { kind: "transfer"; from: Asset; to: Asset; amount: bigint }
	| { kind: "idle"; reason: string };
