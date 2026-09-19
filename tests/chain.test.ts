import { expect, it, vi } from 'vitest';
import { signingGate } from '../src/chain.js';
it('rejects insufficient gas, concurrent nonce, owner failure and reduced balance before signing', async () => {
  for (const failure of ['gas', 'nonce', 'owner', 'balance']) {
    const sign = vi.fn();
    await expect(signingGate({ gas: 21000n, gasPrice: 2n, nonce: 3 }, {
      native: async () => failure === 'gas' ? 10n : 100000n,
      nonces: async () => failure === 'nonce' ? [3, 4] : [3, 3],
      owner: async () => { if (failure === 'owner') throw new Error('OWNER_CHANGED'); },
      balance: async () => failure === 'balance' ? 0n : 100n,
    }, 100n, sign)).rejects.toThrow();
    expect(sign).not.toHaveBeenCalled();
  }
});
it('signs after checks and requires an explicit fee cap', async () => {
  const io = { native: async () => 100000n, nonces: async (): Promise<[number, number]> => [3, 3], owner: async () => {}, balance: async () => 100n };
  const sign = vi.fn(async () => 'signed');
  await expect(signingGate({ gas: 21000n, nonce: 3 }, io, 100n, sign)).rejects.toThrow('INVALID_GAS');
  expect(await signingGate({ gas: 21000n, maxFeePerGas: 2n, nonce: 3 }, io, 100n, sign)).toBe('signed');
});
