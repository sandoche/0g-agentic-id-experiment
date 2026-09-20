import { expect, it, vi } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { config } from './fixtures.js';
import { keccak256, concatHex, stringToHex } from 'viem';
import { taskHash, verifyTranscript } from '../src/proof.js';
import type { ServeProof, AgenticID } from '@0gfoundation/0g-agenticid-sdk';
import * as bindings from '../src/proof.js';
it('rejects empty, subset, duplicate, stale framework and wrong submitter bindings', async () => {
  const hash = `0x${'11'.repeat(32)}` as const, other = `0x${'22'.repeat(32)}` as const, submitter = '0x0000000000000000000000000000000000000000' as const;
  const proof: ServeProof = { dataHashes: [hash, other], frameworkHash: hash, submitter, agentId: 1n, timestamp: 1n, deadline: 2n, taskHash: hash, signature: '0x' };
  const expected = { dataHashes: [hash, other], frameworkHash: hash, submitter, frameworkAllowed: true };
  expect(bindings.validBindings(proof, expected)).toBe(true);
  for (const changed of [{ dataHashes: [] }, { dataHashes: [hash] }, { dataHashes: [hash, hash] }, { frameworkHash: other }, { submitter: `0x${'33'.repeat(20)}` }]) {
    expect(bindings.validBindings({ ...proof, ...changed } as ServeProof, expected)).toBe(false);
  }
  expect(bindings.validBindings(proof, { ...expected, frameworkAllowed: false })).toBe(false);
});
it('pins only a signature-verified registry-approved framework and rechecks current data', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'portfolio-proof-'));
  const hash = `0x${'11'.repeat(32)}` as const, changed = `0x${'22'.repeat(32)}` as const;
  const proof: ServeProof = { agentId: 1n, timestamp: 1n, deadline: 2n, taskHash: hash, signature: '0x', dataHashes: [hash], frameworkHash: hash, submitter: '0x0000000000000000000000000000000000000000' };
  let approved = true, authentic = false, current = hash as string;
  const ag = { reputation: { verifyProof: async () => ({ ok: authentic }) }, agent: { intelligentDatasOf: async () => [{ dataHash: current }] } } as unknown as AgenticID;
  const fetcher = vi.spyOn(globalThis, 'fetch').mockImplementation(async (url, init) => {
    if (String(url).endsWith('/config')) return Response.json({ chain_id: 16602, chain_rpc: 'https://rpc.example', agentic_id_addr: `0x${'44'.repeat(20)}` });
    const rpc = JSON.parse(String(init?.body));
    return Response.json({ jsonrpc: '2.0', id: rpc.id, result: rpc.method === 'eth_chainId' ? '0x40da' : `0x${(approved ? '1' : '0').padStart(64, '0')}` });
  });
  try {
    const verify = await bindings.createProofVerifier(config, ag, 1n, undefined, directory);
    expect(await verify(proof)).toBe(false); authentic = true; approved = false;
    expect(await verify(proof)).toBe(false); approved = true;
    expect(await verify(proof)).toBe(true);
    expect(await verify({ ...proof, frameworkHash: changed })).toBe(false);
    current = changed; expect(await verify(proof)).toBe(false);
  } finally { fetcher.mockRestore(); await rm(directory, { recursive: true, force: true }); }
});
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
