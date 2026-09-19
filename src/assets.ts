import type { Address, Asset, TradingChain } from './types.js';

const stockSource = 'https://api.robinhood.com/rhj/assets';
function asset(symbol: string, chainId: TradingChain, address: Address,
  decimals: number, kind: Asset['kind'], source: string): Asset {
  const lower = address.toLowerCase() as Address;
  return Object.freeze({ id: `${chainId}:${lower}`, symbol, chainId, address: lower, decimals, kind, source });
}
export const assets: readonly Asset[] = Object.freeze([
  asset('NVDA', 4663, '0xd0601CE157Db5bdC3162BbaC2a2C8aF5320D9EEC', 18, 'position', stockSource),
  asset('MSFT', 4663, '0xe93237C50D904957Cf27E7B1133b510C669c2e74', 18, 'position', stockSource),
  asset('GOOGL', 4663, '0x2e0847E8910a9732eB3fb1bb4b70a580ADAD4FE3', 18, 'position', stockSource),
  asset('AMZN', 4663, '0x12f190a9F9d7D37a250758b26824B97CE941bF54', 18, 'position', stockSource),
  asset('AVGO', 4663, '0x156E175DD063a8cE274C50654eF40e0032b3fbcF', 18, 'position', stockSource),
  asset('TAO', 4663, '0xf3081494b87e8d5fb7960f066e931d1d0e6e3d67', 18, 'position',
    'https://github.com/ForeverMoney-Ai/forevermoney-sdk/blob/main/src/chains/deployment.ts'),
  asset('0G', 56, '0x4b948d64de1f71fcd12fb586f4c776421a35b3ee', 18, 'position',
    'https://www.binance.com/en/support/announcement/detail/e7b441acff484d25a1120f8ae7ce6e54'),
  asset('FET', 56, '0x031b41e504677879370e9dbcf937283a8691fa7f', 18, 'position',
    'https://superintelligence.io/asi-token-fet/'),
  asset('USDC', 8453, '0x833589fcd6edb6e08f4c7c32d4f71b54bda02913', 6, 'cash',
    'https://developers.circle.com/stablecoins/usdc-contract-addresses'),
  asset('USDC', 42161, '0xaf88d065e77c8cc2239327c5edb3a432268e5831', 6, 'cash',
    'https://developers.circle.com/stablecoins/usdc-contract-addresses'),
  asset('USDG', 4663, '0x5fc5360d0400a0fd4f2af552add042d716f1d168', 18, 'cash',
    'https://docs.robinhood.com/chain/contracts/'),
  asset('USDT', 56, '0x55d398326f99059ff775485246999027b3197955', 18, 'cash',
    'https://www.binance.com/en/proof-of-collateral'),
]);

export function getAsset(id: string): Asset {
  const result = assets.find(a => a.id === id);
  if (!result) throw new Error('UNKNOWN_ASSET');
  return result;
}
export function cashAsset(chainId: TradingChain): Asset {
  const result = assets.find(a => a.chainId === chainId && a.kind === 'cash');
  if (!result) throw new Error('UNKNOWN_CASH_ASSET');
  return result;
}
export const chainNames: Record<TradingChain, string> = {
  56: 'BNB Smart Chain', 4663: 'Robinhood Chain', 8453: 'Base', 42161: 'Arbitrum One',
};
export const explorers: Record<TradingChain, string> = {
  56: 'https://bscscan.com', 4663: 'https://robinhoodchain.blockscout.com',
  8453: 'https://basescan.org', 42161: 'https://arbiscan.io',
};
