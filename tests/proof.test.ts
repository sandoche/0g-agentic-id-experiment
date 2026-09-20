import { expect, it } from 'vitest';
import { keccak256, concatHex, stringToHex } from 'viem';
import { taskHash, verifyTranscript } from '../src/proof.js';
import type { ServeProof } from '@0gfoundation/0g-agenticid-sdk';
it('binds method, exact URI, exact response bytes, status, identity and cryptographic verification', async () => {
  const path = '/api/events?after=1', body = new TextEncoder().encode('{"events":[]}');
  const expected = keccak256(concatHex([stringToHex('GET'), stringToHex(path), keccak256('0x'), keccak256(body), stringToHex('200')]));
  expect(taskHash('GET', path, new Uint8Array(), body, 200)).toBe(expected);
  const now = BigInt(Math.floor(Date.now() / 1000));
  const p: ServeProof = { agentId: 1n, timestamp: now, deadline: now + 300n, taskHash: expected, dataHashes: [], frameworkHash: `0x${'11'.repeat(32)}`,
    signature: '0x', submitter: '0x0000000000000000000000000000000000000000' };
  await expect(verifyTranscript(p, 1n, path, body, 200, async () => true)).resolves.toBeUndefined();
  for (const altered of [{ ...p, agentId: 2n }, { ...p, deadline: now - 1n }, { ...p, taskHash: `0x${'00'.repeat(32)}` }, { ...p, timestamp: now + 60n }]) {
    await expect(verifyTranscript(altered as ServeProof, 1n, path, body, 200, async () => true)).rejects.toThrow('PROOF_INVALID');
  }
  await expect(verifyTranscript(p, 1n, path, body, 200, async () => false)).rejects.toThrow('PROOF_INVALID');
  await expect(verifyTranscript(p, 1n, '/api/events?after=2', body, 200, async () => true)).rejects.toThrow('PROOF_INVALID');
});
