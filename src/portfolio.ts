import { cashAsset, getAsset } from './assets.js';
import type { Action, Holding, Snapshot, Strategy } from './types.js';

export function holdingValue(holding: Holding): bigint {
  if (holding.units < 0n || holding.priceUsd <= 0n) throw new Error('INVALID_HOLDING');
  return holding.units * holding.priceUsd / 10n ** BigInt(holding.asset.decimals);
}
const min = (a: bigint, b: bigint) => a < b ? a : b;
const positive = (value: bigint) => value > 0n ? value : 0n;

export function nextAction(strategy: Strategy, snapshot: Snapshot): Action {
  if (!snapshot.complete || !Number.isSafeInteger(snapshot.now)) throw new Error('INCOMPLETE_SNAPSHOT');
  const required = new Set(strategy.targets.map(t => t.assetId));
  const chains = new Set(strategy.targets.map(t => getAsset(t.assetId).chainId));
  chains.add(strategy.fundingChain);
  for (const chain of chains) required.add(cashAsset(chain).id);
  const holdings = new Map<string, Holding>();
  for (const holding of snapshot.holdings) {
    const { asset, observedAt } = holding;
    if (!required.has(asset.id) || holdings.has(asset.id)) throw new Error('UNEXPECTED_HOLDING');
    const canonical = getAsset(asset.id);
    if (asset.address !== canonical.address || asset.chainId !== canonical.chainId ||
      asset.decimals !== canonical.decimals || asset.kind !== canonical.kind) throw new Error('ASSET_METADATA_MISMATCH');
    if (!Number.isSafeInteger(observedAt) || observedAt > snapshot.now || snapshot.now - observedAt > 60000) {
      throw new Error('STALE_SNAPSHOT');
    }
    holdingValue(holding);
    holdings.set(asset.id, holding);
  }
  if (holdings.size !== required.size) throw new Error('INCOMPLETE_SNAPSHOT');
  const total = [...holdings.values()].reduce((sum, h) => sum + holdingValue(h), 0n);
  if (total === 0n) return { kind: 'idle', reason: 'NO_FUNDS' };
  const positions = strategy.targets.map(target => {
    const holding = holdings.get(target.assetId)!;
    const delta = total * target.weightBps / 10000n - holdingValue(holding);
    return { holding, delta };
  });
  const eligible = (usd: bigint) => usd >= strategy.minTradeUsd && usd * 10000n / total >= strategy.driftBps;
  const ranked = <T extends { holding: Holding; delta: bigint }>(rows: T[], direction: 1 | -1) => rows.sort((a, b) => {
    const diff = (a.delta - b.delta) * BigInt(direction);
    return diff === 0n ? a.holding.asset.id.localeCompare(b.holding.asset.id) : diff < 0n ? -1 : 1;
  });
  const sell = ranked(positions.filter(p => p.delta < 0n && eligible(-p.delta)), 1)[0];
  if (sell) {
    const { asset, priceUsd, units } = sell.holding;
    const amount = min(units, -sell.delta * 10n ** BigInt(asset.decimals) / priceUsd);
    if (amount > 0n) return { kind: 'swap', from: asset, to: cashAsset(asset.chainId), amount };
  }
  const buys = ranked(positions.filter(p => p.delta > 0n && eligible(p.delta)), -1);
  const cash = [...chains].map(chain => {
    const holding = holdings.get(cashAsset(chain).id)!;
    const needed = buys.filter(p => p.holding.asset.chainId === chain).reduce((sum, p) => sum + p.delta, 0n);
    const value = holdingValue(holding);
    return { holding, needed, missing: positive(needed - value), surplus: positive(value - needed) };
  });
  const receivers = cash.filter(c => c.missing >= strategy.minTradeUsd)
    .sort((a, b) => a.missing === b.missing ? a.holding.asset.id.localeCompare(b.holding.asset.id) : a.missing > b.missing ? -1 : 1);
  const donors = cash.filter(c => c.surplus >= strategy.minTradeUsd)
    .sort((a, b) => a.surplus === b.surplus ? a.holding.asset.id.localeCompare(b.holding.asset.id) : a.surplus > b.surplus ? -1 : 1);
  for (const receiver of receivers) for (const donor of donors) {
    if (receiver.holding.asset.chainId === donor.holding.asset.chainId) continue;
    const spend = min(donor.surplus, receiver.missing);
    const amount = min(donor.holding.units, spend * 10n ** BigInt(donor.holding.asset.decimals) / donor.holding.priceUsd);
    if (amount > 0n) return { kind: 'transfer', from: donor.holding.asset, to: receiver.holding.asset, amount };
  }
  for (const buy of buys) {
    const available = holdings.get(cashAsset(buy.holding.asset.chainId).id)!;
    const spend = min(buy.delta, holdingValue(available));
    if (spend < strategy.minTradeUsd) continue;
    const amount = min(available.units, spend * 10n ** BigInt(available.asset.decimals) / available.priceUsd);
    if (amount > 0n) return { kind: 'swap', from: available.asset, to: buy.holding.asset, amount };
  }
  return { kind: 'idle', reason: 'WITHIN_THRESHOLDS' };
}
