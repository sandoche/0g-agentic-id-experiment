import { expect, it, vi } from 'vitest';
import { AuctionDetails, EvmAddress, EvmCrossChainOrder, ESCROW_FACTORY, HashLock, TimeLocks, Immutables, DstImmutablesComplement, EvmEscrowFactoryFacade, ESCROW_SRC_IMPLEMENTATION, ESCROW_DST_IMPLEMENTATION, SrcEscrowCreatedEvent, DstEscrowCreatedEvent, EscrowCancelledEvent } from '@1inch/cross-chain-sdk';
import { encodeAbiParameters, parseAbiParameters } from 'viem';
import { restoreOrder, validateOrder, createFusionLifecycle, type FusionRecord } from '../src/fusion.js';
import { validateEscrowPair, createEscrowVerifier } from '../src/escrow.js';
import { usdBase, usdR, config } from './fixtures.js';
import type { Journal, Store } from '../src/state.js';
const wallet = '0x1111111111111111111111111111111111111111';
const taker = EvmAddress.fromString('0x2222222222222222222222222222222222222222');
const maker = EvmAddress.fromString(wallet);
const secret = `0x${'ab'.repeat(32)}`;
const hashLock = HashLock.forSingleFill(secret);
const locks = TimeLocks.new({ srcWithdrawal: 10n, srcPublicWithdrawal: 30n, srcCancellation: 900n, srcPublicCancellation: 960n,
  dstWithdrawal: 10n, dstPublicWithdrawal: 20n, dstCancellation: 600n });
export function fusionRecord(secrets = [secret]): FusionRecord {
  const orderLock = secrets.length === 1 ? hashLock : HashLock.forMultipleFills(HashLock.getMerkleLeaves(secrets));
  const order = EvmCrossChainOrder.new(ESCROW_FACTORY[8453], { maker, receiver: maker, makerAsset: EvmAddress.fromString(usdBase.address),
    takerAsset: EvmAddress.fromString(usdR.address), makingAmount: 100000000n, takingAmount: 99500000n },
    { hashLock: orderLock, srcChainId: 8453, dstChainId: 4663, srcSafetyDeposit: 1n, dstSafetyDeposit: 1n, timeLocks: locks },
    { auction: AuctionDetails.noAuction(120n, BigInt(Math.floor(Date.now() / 1000))), whitelist: [{ address: taker, allowFrom: 0n }] },
    { allowPartialFills: secrets.length > 1, allowMultipleFills: secrets.length > 1, nonce: 1n });
  return { action: { kind: 'transfer', from: usdBase, to: usdR, amount: 100000000n }, wallet, owner: wallet,
    order: order.build(), extension: order.extension.encode(), hash: order.getOrderHash(8453), quoteId: 'fixture',
    secrets, state: 'prepared', disclosed: [], fills: {}, sourceBlock: 1n, minimum: 99500000n };
}
it('round-trips a real SDK order and validates every intent field before signing', () => {
  const p = fusionRecord(), o = restoreOrder(p);
  expect(o.getOrderHash(8453)).toBe(p.hash); expect(o.build()).toEqual(p.order);
  expect(() => validateOrder(p)).not.toThrow();
  for (const mutated of [{ ...p, wallet: '0x2222222222222222222222222222222222222222' },
    { ...p, secrets: [`0x${'cd'.repeat(32)}`] }, { ...p, minimum: p.minimum + 1n },
    { ...p, action: { ...p.action, amount: p.action.amount - 1n } },
    { ...p, action: { ...p.action, to: usdBase } }]) expect(() => validateOrder(mutated as FusionRecord)).toThrow();
});
it('verifies actual factory event encoding, computed escrow address, confirmations and funding', async () => {
  const p = fusionRecord(), now = BigInt(Math.floor(Date.now() / 1000));
  const src = Immutables.new({ orderHash: Buffer.from(p.hash.slice(2), 'hex'), hashLock, maker, taker, token: EvmAddress.fromString(usdBase.address),
    amount: p.action.amount, safetyDeposit: 1n, timeLocks: TimeLocks.fromBigInt(locks.build()).setDeployedAt(now - 20n) });
  const co = DstImmutablesComplement.new({ maker, taker, token: EvmAddress.fromString(usdR.address), amount: p.minimum, safetyDeposit: 1n, chainId: 4663n });
  const dest = new EvmEscrowFactoryFacade(4663, ESCROW_FACTORY[4663]).getDstEscrowAddress(src, co, now - 15n, taker, ESCROW_DST_IMPLEMENTATION[4663]);
  const sourceData = encodeAbiParameters(parseAbiParameters('(bytes32,bytes32,uint256,uint256,uint256,uint256,uint256,uint256,bytes), (uint256,uint256,uint256,uint256,uint256,bytes)'),
    [[p.hash as `0x${string}`, hashLock.toString() as `0x${string}`, BigInt(wallet), BigInt(taker.toString()), BigInt(usdBase.address), p.action.amount, 1n, src.timeLocks.build(), '0x'],
      [BigInt(wallet), p.minimum, BigInt(usdR.address), 1n, 4663n, co.fees.encode() as `0x${string}`]]);
  const destData = encodeAbiParameters(parseAbiParameters('address,bytes32,uint256'), [dest.toString() as `0x${string}`, hashLock.toString() as `0x${string}`, BigInt(taker.toString())]);
  let omitDst = false, funded = true, confirmed = true;
  const rpc = (chain: number) => ({ getChainId: async () => chain, getBlockNumber: async () => confirmed ? 12n : 10n,
    getTransactionReceipt: async () => ({ status: 'success', blockNumber: 10n, logs: chain === 4663 && omitDst ? [] : [{ address: ESCROW_FACTORY[chain as 8453 | 4663].toString(), topics: [chain === 8453 ? SrcEscrowCreatedEvent.TOPIC : DstEscrowCreatedEvent.TOPIC], data: chain === 8453 ? sourceData : destData }] }),
    getBlock: async () => ({ timestamp: chain === 8453 ? now - 20n : now - 15n }),
    getBytecode: async () => `0x363d${(chain === 8453 ? ESCROW_SRC_IMPLEMENTATION[8453] : ESCROW_DST_IMPLEMENTATION[4663]).toString().slice(2)}5af4`,
    readContract: async () => funded ? 100000000n : 0n, getBalance: async () => 1n,
  });
  const verifier = createEscrowVerifier(config, rpc as unknown as Parameters<typeof createEscrowVerifier>[1]);
  const fill = { idx: 0, srcEscrowDeployTxHash: 'src', dstEscrowDeployTxHash: 'dst' };
  expect((await verifier.verify(p, fill)).destination).toBe(dest.toString());
  omitDst = true; await expect(verifier.verify(p, fill)).rejects.toThrow('ESCROW_UNVERIFIED');
  omitDst = false; funded = false; await expect(verifier.verify(p, fill)).rejects.toThrow('ESCROW_UNFUNDED');
  funded = true; confirmed = false; await expect(verifier.verify(p, fill)).rejects.toThrow('ESCROW_UNCONFIRMED');
});
function memory(): Store {
  let j: Journal = { version: 1, wallet, owner: wallet, sequence: 0 };
  return { load: async () => structuredClone(j), save: async v => { j = structuredClone(v); }, lock: async () => {}, close: async () => {} };
}
it('advances and persists bounded terminal scans after an outage over 20000 blocks', async () => {
  let p = fusionRecord(); const now = BigInt(Math.floor(Date.now() / 1000));
  const src = Immutables.new({ orderHash: Buffer.from(p.hash.slice(2), 'hex'), hashLock, maker, taker, token: EvmAddress.fromString(usdBase.address), amount: p.action.amount, safetyDeposit: 1n, timeLocks: locks }).withDeployedAt(now - 2000n);
  const address = new EvmEscrowFactoryFacade(8453, ESCROW_FACTORY[8453]).getSrcEscrowAddress(src, ESCROW_SRC_IMPLEMENTATION[8453]).toString();
  p.sourceCursor = 50000n; p.discovered = { [address]: { source: address, sourceBlock: 1n, immutables: src.toABIEncoded(), complement: '{}' } };
  const calls: bigint[] = [];
  const rpc = (chain: number) => ({ getChainId: async () => chain, getBlockNumber: async () => 50001n,
    getLogs: async ({ address: requested, fromBlock, toBlock }: { address: string; fromBlock: bigint; toBlock: bigint }) => {
      if (requested.toLowerCase() !== address.toLowerCase()) return [];
      expect(toBlock - fromBlock).toBeLessThanOrEqual(1999n); calls.push(fromBlock);
      return fromBlock <= 45000n && toBlock >= 45000n ? [{ topics: [EscrowCancelledEvent.TOPIC] }] : [];
    },
  });
  let settled = false;
  for (let n = 0; n < 30 && !settled; n++) {
    settled = await createEscrowVerifier(config, rpc as unknown as Parameters<typeof createEscrowVerifier>[1]).settled(p);
    p = structuredClone(p); // persisted state, new verifier instance after restart
  }
  expect(settled).toBe(true); expect(calls.filter(n => n === 1n)).toHaveLength(1);
});
it('tracks separate partial-fill secrets without freeing the reserved order', async () => {
  const store = memory(), secrets = [secret, `0x${'cd'.repeat(32)}`, `0x${'ef'.repeat(32)}`], p = fusionRecord(secrets), disclose = vi.fn();
  const port = { submit: async () => {}, ready: async () => [0, 1].map(idx => ({ idx, srcEscrowDeployTxHash: `src${idx}`, dstEscrowDeployTxHash: `dst${idx}` })),
    verify: async (_: FusionRecord, f: { idx: number }) => ({ source: `src${f.idx}`, destination: `dst${f.idx}` }), disclose, settle: async () => false, recover: async () => {} };
  const life = createFusionLifecycle(store, port); await life.start(p); await life.reconcile();
  expect(disclose.mock.calls.map(c => c[1])).toEqual(secrets.slice(0, 2));
  expect(((await store.load()).pending?.payload as FusionRecord).disclosed).toEqual([0, 1]);
  expect((await store.load()).pending?.id).toBe(p.hash);
});
it('persists secrets and order before uncertain submission and never creates a second order', async () => {
  const store = memory(), p = fusionRecord();
  const submit = vi.fn(async () => { expect((await store.load()).pending?.id).toBe(p.hash); throw new Error('timeout'); });
  const life = createFusionLifecycle(store, { submit, ready: async () => [], verify: vi.fn(), disclose: vi.fn(), settle: async () => false, recover: async () => {} });
  expect(await life.start(p)).toBe('pending');
  expect((await store.load()).pending).toBeDefined();
  await life.start(fusionRecord()); expect(submit).toHaveBeenCalledTimes(1);
  expect(await life.reconcile()).toBe('pending');
});
it('never discloses on invalid index or unverified destination, and preserves a restart', async () => {
  const store = memory(), p = fusionRecord(), disclose = vi.fn();
  let idx = 9, safe = false;
  const port = { submit: async () => {}, ready: async () => [{ idx, srcEscrowDeployTxHash: 'src', dstEscrowDeployTxHash: 'dst' }],
    verify: async () => { if (!safe) throw new Error('ESCROW_UNVERIFIED'); return { source: 'src', destination: 'dst' }; },
    disclose, settle: async () => false, recover: async () => {} };
  const life = createFusionLifecycle(store, port); await life.start(p);
  await expect(life.reconcile()).rejects.toThrow('INVALID_SECRET_INDEX');
  idx = 0; await expect(life.reconcile()).rejects.toThrow('ESCROW_UNVERIFIED'); expect(disclose).not.toHaveBeenCalled();
  safe = true; await createFusionLifecycle(store, port).reconcile(); expect(disclose).toHaveBeenCalledWith(p.hash, secret);
  await life.reconcile(); expect(disclose).toHaveBeenCalledTimes(1);
  expect((await store.load()).pending).toBeDefined();
});
it('does not confuse expiry or API execution with on-chain settlement', async () => {
  const store = memory(), recover = vi.fn(); let settled = false;
  const port = { submit: async () => {}, ready: async () => [], verify: vi.fn(), disclose: vi.fn(), settle: async () => settled, recover };
  const life = createFusionLifecycle(store, port); await life.start(fusionRecord());
  await life.reconcile(); expect(recover).toHaveBeenCalled(); expect((await store.load()).pending).toBeDefined();
  settled = true; expect(await life.reconcile()).toBe('settled'); expect((await store.load()).pending).toBeUndefined();
});
it('checks paired immutables, fees and remaining withdrawal time', () => {
  const p = fusionRecord(), now = BigInt(Math.floor(Date.now() / 1000));
  const src = Immutables.new({ orderHash: Buffer.from(p.hash.slice(2), 'hex'), hashLock, maker, taker,
    token: EvmAddress.fromString(usdBase.address), amount: p.action.amount, safetyDeposit: 1n, timeLocks: TimeLocks.fromBigInt(locks.build()).setDeployedAt(now - 20n) });
  const complement = DstImmutablesComplement.new({ maker, taker, token: EvmAddress.fromString(usdR.address), amount: p.minimum, safetyDeposit: 1n, chainId: 4663n });
  const dst = src.withComplement(complement).withDeployedAt(now - 15n);
  expect(() => validateEscrowPair(p, 0, src, complement, dst, now)).not.toThrow();
  for (const [s, d, time] of [[src.withAmount(src.amount + 1n), dst, now], [src, dst.withAmount(1n), now],
    [src, dst, now + 1000n], [src, dst.withHashLock(HashLock.forSingleFill(`0x${'cd'.repeat(32)}`)), now]] as const) {
    expect(() => validateEscrowPair(p, 0, s, complement, d, time)).toThrow();
  }
});
