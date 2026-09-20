import { setTimeout as delay } from 'node:timers/promises';
import { erc20Abi } from 'viem';
import { cashAsset, getAsset } from './assets.js';
import { createRpc } from './rpc.js';
import { parseUsd } from './config.js';
import type { Address, Asset, Config, Holding, Snapshot } from './types.js';
export type Market = { preflight(): Promise<void>; snapshot(wallet: Address): Promise<Snapshot>; tradable(asset: Asset): Promise<boolean> };
export async function requestJson<T>(url: URL, init: RequestInit = {}, fetcher: typeof fetch = fetch): Promise<T> {
  const attempts = (init.method ?? 'GET').toUpperCase() === 'GET' ? 3 : 1;
  for (let attempt = 0; attempt < attempts; attempt++) {
    let response: Response;
    try {
      const timeout = AbortSignal.timeout(10000);
      response = await fetcher(url, { ...init, redirect: 'error',
        signal: init.signal ? AbortSignal.any([init.signal, timeout]) : timeout });
    } catch {
      if (init.signal?.aborted) throw new Error('REQUEST_ABORTED');
      if (attempt + 1 === attempts) throw new Error('NETWORK_ERROR');
      await delay(250 * 2 ** attempt, undefined, { signal: init.signal ?? undefined });
      continue;
    }
    if (!response.ok) {
      if ((response.status === 429 || response.status >= 500) && attempt + 1 < attempts) {
        const header = response.headers.get('retry-after');
        const seconds = header === null ? NaN : Number(header);
        const ms = Number.isFinite(seconds) ? Math.min(5000, Math.max(0, seconds * 1000))
          : response.status === 429 ? 1100 : 250 * 2 ** attempt;
        await response.body?.cancel();
        await delay(ms, undefined, { signal: init.signal ?? undefined });
        continue;
      }
      await response.body?.cancel();
      throw new Error(`HTTP_${response.status}`);
    }
    try {
      const text = await response.text();
      if (text.length > 4 * 1024 * 1024) throw new Error();
      return JSON.parse(text) as T;
    } catch { throw new Error('INVALID_JSON'); }
  }
  throw new Error('NETWORK_ERROR');
}
export function parsePrice(value: unknown): bigint {
  if (typeof value !== 'string' || !/^\d+(?:\.\d+)?$/.test(value) || value.length > 100) throw new Error('INVALID_PRICE');
  const [whole, fraction] = value.split('.');
  const parsed = parseUsd(fraction ? `${whole}.${fraction.slice(0, 8)}` : whole!);
  if (parsed <= 0n) throw new Error('INVALID_PRICE');
  return parsed;
}
type Stock = {
  tokenSymbol: string; tokenDecimals: number; status: string;
  deployments: { chainId: number; contractAddress: string }[];
  tradingCapabilities: Record<string, { fractional?: string; whole?: string }>;
};
const stockNames = new Set(['NVDA', 'MSFT', 'GOOGL', 'AMZN', 'AVGO']);
function session(now: Date): string | undefined {
  const parts = new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', weekday: 'short',
    hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(now);
  const value = (type: Intl.DateTimeFormatPartTypes) => parts.find(p => p.type === type)?.value;
  if (['Sat', 'Sun'].includes(value('weekday')!)) return undefined;
  const minutes = Number(value('hour')) * 60 + Number(value('minute'));
  return minutes >= 570 && minutes < 960 ? 'market' : minutes >= 240 && minutes < 1200 ? 'extended' : 'overnight';
}
export function createMarket(config: Config, fetcher: typeof fetch = fetch): Market {
  const positions = config.strategy.targets.map(t => getAsset(t.assetId));
  const chains = [...new Set([config.strategy.fundingChain, ...positions.map(a => a.chainId)])];
  const tracked = [...positions, ...chains.map(cashAsset)];
  const rpc = new Map(chains.map(chain => [chain, createRpc(config, chain, fetcher)]));
  const stockRegistry = async () => {
    const data = await requestJson<{ assets: Stock[] }>(new URL('https://api.robinhood.com/rhj/assets'), {}, fetcher);
    if (!Array.isArray(data.assets)) throw new Error('INVALID_STOCK_REGISTRY');
    return data.assets;
  };
  const checkStock = (asset: Asset, registry: Stock[]) => {
    const stock = registry.find(s => s.tokenSymbol === asset.symbol);
    if (!stock || stock.tokenDecimals !== asset.decimals || !stock.deployments?.some(d =>
      d.chainId === asset.chainId && d.contractAddress.toLowerCase() === asset.address)) throw new Error('STOCK_METADATA_MISMATCH');
    return stock;
  };
  return {
    async preflight() {
      try {
        for (const chain of chains) if (await rpc.get(chain)!.getChainId() !== chain) throw new Error('RPC_CHAIN_MISMATCH');
        for (const asset of tracked) {
          const client = rpc.get(asset.chainId)!;
          const code = await client.getBytecode({ address: asset.address });
          if (!code || code === '0x') throw new Error('TOKEN_HAS_NO_CODE');
          const decimals = await client.readContract({ address: asset.address, abi: erc20Abi, functionName: 'decimals' });
          const symbol = await client.readContract({ address: asset.address, abi: erc20Abi, functionName: 'symbol' });
          if (decimals !== asset.decimals || symbol !== asset.symbol) throw new Error('TOKEN_METADATA_MISMATCH');
        }
      } catch (error) {
        const code = error instanceof Error ? error.message : '';
        throw new Error(['RPC_CHAIN_MISMATCH', 'TOKEN_HAS_NO_CODE', 'TOKEN_METADATA_MISMATCH'].includes(code) ? code : 'RPC_READ_FAILED');
      }
      const stocks = positions.filter(a => stockNames.has(a.symbol));
      if (stocks.length) {
        const registry = await stockRegistry();
        for (const asset of stocks) checkStock(asset, registry);
      }
    },
    async snapshot(wallet) {
      if (!config.credentials.oneinch) throw new Error('MISSING_TRADING_KEY');
      const holdings: Holding[] = [];
      for (const chain of chains) {
        const client = rpc.get(chain)!;
        try { if (await client.getChainId() !== chain) throw new Error(); }
        catch { throw new Error('RPC_CHAIN_MISMATCH'); }
        const chainAssets = tracked.filter(a => a.chainId === chain);
        const url = new URL(`https://api.1inch.com/price/v1.1/${chain}/${chainAssets.map(a => a.address).join(',')}`);
        url.searchParams.set('currency', 'USD');
        // Stamp before the request so time spent fetching cannot make old data fresh.
        const observedAt = Date.now();
        const result = await requestJson<Record<string, unknown>>(url, {
          headers: { Authorization: `Bearer ${config.credentials.oneinch}` },
        }, fetcher);
        if (!result || typeof result !== 'object') throw new Error('INVALID_PRICES');
        const prices = new Map(Object.entries(result).map(([address, value]) => [address.toLowerCase(), value]));
        for (const asset of chainAssets) {
          const priceUsd = parsePrice(prices.get(asset.address));
          let units: bigint;
          try { units = await client.readContract({ address: asset.address, abi: erc20Abi, functionName: 'balanceOf', args: [wallet] }); }
          catch { throw new Error('RPC_READ_FAILED'); }
          holdings.push({ asset, units, priceUsd, observedAt });
        }
      }
      return { holdings, complete: true, now: Date.now() };
    },
    async tradable(asset) {
      if (!stockNames.has(asset.symbol)) return true;
      const activeSession = session(new Date());
      if (!activeSession) return false;
      const stock = checkStock(asset, await stockRegistry());
      if (stock.status !== 'ACTIVE' || stock.tradingCapabilities?.[activeSession]?.fractional !== 'TRADING_STATUS_TRADABLE') return false;
      const data = await requestJson<{ quotes: { tokenSymbol: string; isTradingHalt: boolean; generatedAt: string }[] }>(
        new URL(`https://api.robinhood.com/rhj/prices/${asset.symbol}`), {}, fetcher);
      const quote = data.quotes?.find(q => q.tokenSymbol === asset.symbol);
      if (!quote || quote.isTradingHalt !== false) return false;
      const age = Date.now() - Date.parse(quote.generatedAt);
      return Number.isFinite(age) && age >= 0 && age <= 60000;
    },
  };
}
