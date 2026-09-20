import { keccak256, type Hex } from 'viem';
import type { Store } from './state.js';
import type { Address, TradingChain } from './types.js';
import { requireTradingChain } from './config.js';
export type ExecutionResult = 'settled' | 'pending' | 'skipped';
export type Call = { chainId: TradingChain; to: Address; data: Hex; value: bigint };
export type TransactionPort = {
  sign(call: Call): Promise<Hex>;
  broadcast(chain: TradingChain, raw: Hex): Promise<unknown>;
  receipt(chain: TradingChain, hash: Hex): Promise<'success' | 'reverted' | undefined>;
};
export function createTransactionRunner(store: Store, port: TransactionPort, event: (e: { type: string; time: number; chainId: TradingChain; txHash: Hex }) => Promise<unknown> = async () => {}) {
  async function reconcile(rebroadcast = true): Promise<ExecutionResult> {
    const state = await store.load(), pending = state.pending;
    if (!pending) return 'settled';
    if (pending.kind !== 'transaction') return 'pending';
    const p = pending.payload as { chainId: TradingChain; raw: Hex };
    requireTradingChain(p.chainId);
    if (!/^0x(?:[\da-f]{2})+$/i.test(p.raw) || keccak256(p.raw) !== pending.id) throw new Error('STATE_CORRUPT');
    let receipt;
    try { receipt = await port.receipt(p.chainId, pending.id as Hex); } catch { return 'pending'; }
    if (!receipt) {
      // Identical bytes retain the original nonce/hash: no new signature or spend.
      if (rebroadcast) { try { await port.broadcast(p.chainId, p.raw); } catch { /* keep reserved */ } }
      return 'pending';
    }
    delete state.pending; await store.save(state);
    await event({ type: 'settled', time: Date.now(), chainId: p.chainId, txHash: pending.id as Hex });
    if (receipt !== 'success') throw new Error('TX_REVERTED');
    return 'settled';
  }
  return { reconcile,
    async send(call: Call): Promise<ExecutionResult> {
      requireTradingChain(call.chainId);
      const state = await store.load();
      if (state.pending) return 'pending';
      const raw = await port.sign(call), hash = keccak256(raw);
      state.pending = { kind: 'transaction', id: hash, payload: { chainId: call.chainId, raw } };
      await store.save(state);
      // A timeout may mean accepted. Never create another transaction while this hash is unresolved.
      try { await port.broadcast(call.chainId, raw); } catch { /* reconcile by deterministic hash */ }
      await event({ type: 'transaction', time: Date.now(), chainId: call.chainId, txHash: hash });
      return reconcile(false);
    },
  };
}
