import { expect, it, vi } from 'vitest';
import { AgenticID, type AgentClient } from '@0gfoundation/0g-agenticid-sdk';
import { privateKeyToAccount } from 'viem/accounts';
import { activate } from '../src/agent.js';
import { taskHash } from '../src/proof.js';
import { config } from './fixtures.js';
it('activates once, verifies readiness, then configures keys outside chat on both calls', async () => {
  const key = `0x${'03'.repeat(32)}` as const, owner = privateKeyToAccount(key), wallet = owner.address;
  let started = false;
  const state = { agentId: '1', wallet, instance: 'test', checksum: 'fixture', state: 'ready' };
  const chat = vi.fn(async () => { started = true; return { choices: [] }; });
  const write = vi.fn(async () => Response.json({ ok: true }));
  const client = { base: 'https://synthetic.example', chat, fetch: write,
    fetchWithProof: async (path: string) => {
      if (!started) throw new Error('not started');
      const now = BigInt(Math.floor(Date.now() / 1000));
      const value = path === '/api/status' ? state : { agentId: '1', wallet, instance: 'test', nonce: 'fixture', issuedAt: Date.now(), expiresAt: Date.now() + 60000 };
      const body = JSON.stringify(value), bytes = new TextEncoder().encode(body);
      return { response: new Response(body), proof: { agentId: 1n, submitter: wallet, timestamp: now, deadline: now + 60n,
        taskHash: taskHash('GET', path, new Uint8Array(), bytes, 200), dataHashes: [], frameworkHash: '0x', signature: '0x' } };
    },
  } as unknown as AgentClient;
  const mock = vi.spyOn(AgenticID, 'fromAttestor').mockResolvedValue({ agent: { client: async () => client, getAgentSeal: async () => wallet }, reputation: { verifyProof: async () => ({ ok: true }) } } as unknown as AgenticID);
  try {
    const cfg = { ...config, credentials: { ownerKey: key, oneinch: 'synthetic-secret' } };
    expect((await activate(cfg, 1n, 'fixture')).state).toBe('ready');
    await activate(cfg, 1n, 'fixture');
    expect(chat).toHaveBeenCalledOnce(); expect(write).toHaveBeenCalledTimes(2);
    expect(JSON.stringify(chat.mock.calls)).not.toContain('synthetic-secret');
    expect(JSON.stringify(chat.mock.calls)).not.toContain(config.strategy.prompt);
    started = false; await activate(cfg, 1n, 'fixture'); expect(chat).toHaveBeenCalledTimes(2); // reset reconstructs without strategy in the message
  } finally { mock.mockRestore(); }
});
