import { SDK } from '@1inch/cross-chain-sdk';
import { assets, cashAsset } from './assets.js';
import { createMarket, requestJson } from './market.js';
import { createSwapApi } from './swap.js';
import { createRpc } from './rpc.js';
import type { Address, Config } from './types.js';
export async function onlineCheck(config: Config, wallet: Address = '0x0000000000000000000000000000000000000001', log: (line: string) => void = console.log) {
  const market = createMarket(config); await market.preflight();
  const snapshot = await market.snapshot(wallet); log(`Asset metadata and live prices: ${snapshot.holdings.length} assets verified.`);
  const api = createSwapApi(config, wallet); let available = true;
  for (const target of config.strategy.targets) {
    const to = assets.find(a => a.id === target.assetId)!, from = cashAsset(to.chainId);
    try { await api.quote({ kind: 'swap', from, to, amount: 100n * 10n ** BigInt(from.decimals) }); log(`Quote ${from.chainId} ${from.symbol}->${to.symbol}: available`); }
    catch { available = false; log(`Quote ${from.chainId} ${from.symbol}->${to.symbol}: unavailable`); }
  }
  const sdk = new SDK({ url: 'https://api.1inch.com/fusion-plus', httpProvider: {
    get: url => requestJson(new URL(url), { headers: { Authorization: `Bearer ${config.credentials.oneinch}` } }),
    post: async () => { throw new Error('READ_ONLY_CHECK'); },
  } });
  const from = cashAsset(config.strategy.fundingChain);
  for (const chainId of [...new Set(config.strategy.targets.map(t => assets.find(a => a.id === t.assetId)!.chainId))]) {
    if (chainId === from.chainId) continue; const to = cashAsset(chainId);
    try { await sdk.getQuote({ srcChainId: from.chainId, dstChainId: to.chainId, srcTokenAddress: from.address, dstTokenAddress: to.address,
      amount: (100n * 10n ** BigInt(from.decimals)).toString(), walletAddress: wallet, enableEstimate: false }); log(`Fusion quote ${from.chainId}->${to.chainId}: available`); }
    catch { available = false; log(`Fusion quote ${from.chainId}->${to.chainId}: unavailable`); }
  }
  return available;
}
export async function gasCheck(config: Config, wallet: Address) {
  const chains = [...new Set([config.strategy.fundingChain, ...config.strategy.targets.map(t => assets.find(a => a.id === t.assetId)!.chainId)])];
  for (const chain of chains) { const rpc = createRpc(config, chain); if (await rpc.getChainId() !== chain || await rpc.getBalance({ address: wallet }) === 0n) throw new Error('AGENT_TRADING_GAS_REQUIRED'); }
}
