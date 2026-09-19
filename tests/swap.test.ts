import { describe, expect, it, vi } from 'vitest';
import { encodeFunctionData, keccak256, parseAbi } from 'viem';
import { validateSwap, ROUTER, createSwap } from '../src/swap.js';
import { createTransactionRunner } from '../src/transaction.js';
import { config, tao, usdR } from './fixtures.js';
import type { Journal, Store } from '../src/state.js';
const wallet = '0x1111111111111111111111111111111111111111';
const other = '0x2222222222222222222222222222222222222222';
const abi = parseAbi(['function swap(address executor, (address srcToken,address dstToken,address srcReceiver,address dstReceiver,uint256 amount,uint256 minReturnAmount,uint256 flags) desc, bytes data) payable returns (uint256 returnAmount, uint256 spentAmount)']);
const action = { kind: 'swap' as const, from: usdR, to: tao, amount: 10000000n };
const desc = { srcToken: usdR.address, dstToken: tao.address, srcReceiver: other, dstReceiver: wallet, amount: action.amount, minReturnAmount: 995n, flags: 0n } as const;
function response(changes = {}) { return { tx: { from: wallet, to: ROUTER, value: '0', data: encodeFunctionData({ abi, functionName: 'swap', args: [other, { ...desc, ...changes }, '0x'] }) }, dstAmount: '1000' }; }
it('accepts a constrained generic ERC20 swap', () => {
  expect(validateSwap(action, wallet, 4663, ROUTER, response(), 1000n, 50n).to).toBe(ROUTER);
});
describe('rejects unsafe calldata before any signer is called', () => {
  it.each([{ dstReceiver: other }, { srcToken: tao.address }, { dstToken: usdR.address }, { amount: 1n }, { minReturnAmount: 994n }, { flags: 1n }, { flags: 2n }, { flags: 4n }])('rejects mutation %#', change => {
    expect(() => validateSwap(action, wallet, 4663, ROUTER, response(change), 1000n, 50n)).toThrow();
  });
  it('rejects wrong chain, spender, router, sender, value and selector', () => {
    expect(() => validateSwap(action, wallet, 1, ROUTER, response(), 1000n, 50n)).toThrow();
    expect(() => validateSwap(action, wallet, 4663, other, response(), 1000n, 50n)).toThrow();
    for (const change of [{ to: other }, { from: other }, { value: '1' }, { data: '0x12345678' }]) {
      const r = response(); Object.assign(r.tx, change);
      expect(() => validateSwap(action, wallet, 4663, ROUTER, r, 1000n, 50n)).toThrow();
    }
  });
});
function state(): Store {
  let journal: Journal = { version: 1, wallet, owner: wallet, sequence: 0 };
  return { load: async () => structuredClone(journal), save: async j => { journal = structuredClone(j); }, lock: async () => {}, close: async () => {} };
}
it('persists signed bytes before broadcast; recovers an accepted timeout without signing twice', async () => {
  const store = state(), signed = '0x1234' as const;
  let mined = false;
  const port = { sign: vi.fn(async () => signed), receipt: vi.fn(async () => mined ? 'success' as const : undefined),
    broadcast: vi.fn(async () => { expect((await store.load()).pending?.id).toBe(keccak256(signed)); throw new Error('timeout'); }) };
  const runner = createTransactionRunner(store, port);
  expect(await runner.send({ chainId: 4663, to: ROUTER, data: '0x', value: 0n })).toBe('pending');
  expect(await runner.send({ chainId: 4663, to: ROUTER, data: '0x', value: 0n })).toBe('pending');
  mined = true;
  expect(await createTransactionRunner(store, port).reconcile()).toBe('settled');
  expect(port.sign).toHaveBeenCalledTimes(1); expect((await store.load()).pending).toBeUndefined();
});
it('keeps unsigned/broadcast-free state when saving fails', async () => {
  const store = state(); store.save = async () => { throw new Error('DISK_FULL'); };
  const broadcast = vi.fn();
  const runner = createTransactionRunner(store, { sign: async () => '0x1234', broadcast, receipt: async () => undefined });
  await expect(runner.send({ chainId: 56, to: ROUTER, data: '0x', value: 0n })).rejects.toThrow('DISK_FULL');
  expect(broadcast).not.toHaveBeenCalled();
});
it('records revert and stops the current operation', async () => {
  const store = state();
  const runner = createTransactionRunner(store, { sign: async () => '0x1234', broadcast: async () => {}, receipt: async () => 'reverted' });
  await expect(runner.send({ chainId: 56, to: ROUTER, data: '0x', value: 0n })).rejects.toThrow('TX_REVERTED');
  expect((await store.load()).pending).toBeUndefined();
});
it('validates response before requesting an allowance signature', async () => {
  const approve = vi.fn(), signer = vi.fn();
  const swap = createSwap(config, wallet, { quote: async () => 1000n, swap: async () => response({ dstReceiver: other }), spender: async () => ROUTER },
    { verifyRouter: async () => {}, balance: async () => action.amount, allowance: async () => 0n, guard: async () => {}, send: signer, approve });
  await expect(swap.execute(action)).rejects.toThrow();
  expect(approve).not.toHaveBeenCalled(); expect(signer).not.toHaveBeenCalled();
});
