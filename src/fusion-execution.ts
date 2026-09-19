import { HashLock, type SDK } from '@1inch/cross-chain-sdk';
import { encodeFunctionData, parseAbi, type LocalAccount } from 'viem';
import { createFusionSdk, createFusionLifecycle, prepareFusion, restoreOrder, type FusionRecord } from './fusion.js';
import { createEscrowVerifier } from './escrow.js';
import { createChain } from './chain.js';
import { ROUTER } from './swap.js';
import type { Store } from './state.js';
import type { Config } from './types.js';
import type { Call, ExecutionResult } from './transaction.js';
const cancelAbi = parseAbi(['function cancelOrder(uint256 makerTraits,bytes32 orderHash)']);
export function createFusionExecution(config: Config, account: LocalAccount, store: Store, guard: () => Promise<void>, event?: Parameters<typeof createChain>[4]) {
  const chain = createChain(config, account, store, guard, event);
  const sdk: SDK = createFusionSdk(config, account, store, guard, chain.port), verifier = createEscrowVerifier(config);
  let record: FusionRecord | undefined, allowed: Call | undefined;
  const recoveryStore: Store = {
    ...store,
    async load() { const j = await store.load(); return { ...j, pending: record?.recovery }; },
    async save(j) {
      if (!record) throw new Error('NO_RECOVERY');
      record.recovery = j.pending as FusionRecord['recovery'];
      const current = await store.load(); current.pending = { kind: 'fusion', id: record.hash, payload: record }; await store.save(current);
    },
  };
  const recoverChain = createChain(config, account, recoveryStore, guard, event, async call => !!allowed
    && call.chainId === allowed.chainId && call.to === allowed.to && call.data === allowed.data && call.value === 0n);
  const lifecycle = createFusionLifecycle(store, {
    async submit(p) { await sdk.submitOrder(p.action.from.chainId, restoreOrder(p), p.quoteId, p.secrets.map(s => HashLock.hashSecret(s))); },
    async ready(p) { try { return (await sdk.getReadyToAcceptSecretFills(p.hash)).fills; } catch { return []; } },
    verify: verifier.verify,
    async disclose(hash, secret) { await guard(); await sdk.submitSecret(hash, secret); },
    settle: verifier.settled,
    async recover(p) {
      record = p;
      try {
        if (p.recovery) {
          if (await recoverChain.runner.reconcile() === 'pending') return;
          // A confirmed cancelOrder can be distinguished from an escrow recovery by its saved call purpose.
          if (p.state === 'expired') p.cancelled = true;
        }
        const expired = restoreOrder(p).deadline < BigInt(Math.floor(Date.now() / 1000));
        if (expired && !p.cancelled) {
          const expected = encodeFunctionData({ abi: cancelAbi, functionName: 'cancelOrder', args: [BigInt(p.order.makerTraits), p.hash as `0x${string}`] });
          // Prefer the SDK method; remote traits must reproduce the locally persisted cancellation exactly.
          let data = expected;
          try { data = await sdk.buildCancelOrderCallData(p.hash) as `0x${string}`; } catch { /* Saved order permits offline calldata reconstruction. */ }
          if (data !== expected) throw new Error('UNSAFE_CANCELLATION');
          allowed = { chainId: p.action.from.chainId, to: ROUTER, data, value: 0n }; p.state = 'expired';
        } else { allowed = await verifier.recovery(p); if (allowed) p.state = 'recovering'; }
        if (allowed) {
          await chain.port.verifyRouter(p.action.from.chainId);
          const result = await recoverChain.runner.send(allowed);
          if (result === 'settled' && p.state === 'expired') p.cancelled = true;
        }
      } finally { allowed = undefined; record = undefined; }
    },
  });
  return { reconcile: lifecycle.reconcile,
    async execute(action: FusionRecord['action']): Promise<ExecutionResult> {
      const j = await store.load(); if (j.pending) return 'pending';
      await guard(); await chain.port.verifyRouter(action.from.chainId);
      if (await chain.port.balance(action.from) < action.amount) throw new Error('INSUFFICIENT_BALANCE');
      const allowance = await chain.port.allowance(action.from);
      if (allowance < action.amount) return chain.port.approve(action.from, allowance === 0n ? action.amount : 0n);
      const p = await prepareFusion(sdk, action, account.address, j.owner, await chain.rpc(action.from.chainId).getBlockNumber(), config.strategy.slippageBps);
      await guard(); return lifecycle.start(p);
    },
  };
}
