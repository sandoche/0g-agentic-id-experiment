import { afterEach, expect, it, vi } from 'vitest';
import { privateKeyToAccount } from 'viem/accounts';
import { startServer, serviceDefinitions, registerServices } from '../src/server.js';
import { createAuth, authMessage } from '../src/auth.js';
import type { Worker } from '../src/worker.js';
import { createServer } from 'node:http';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
const owner = privateKeyToAccount(`0x${'02'.repeat(32)}`);
const identity = { agentId: '12', wallet: owner.address, instance: 'fixture' };
const closers: (() => Promise<void>)[] = [];
afterEach(async () => { for (const close of closers.splice(0)) await close(); });
async function server() {
  const configure = vi.fn(async () => {}), stop = vi.fn(async () => {});
  const worker = { status: () => ({ mode: 'simulation', state: 'ready' }), events: () => [], configure, stop, start: vi.fn() } as unknown as Worker;
  const s = await startServer(worker, createAuth(identity, async () => owner.address), identity, 'abc'); closers.push(s.close);
  return { ...s, configure, stop, url: `http://127.0.0.1:${s.port}` };
}
it('serves only exact routes, bounded public fields and correctly signed configuration', async () => {
  const s = await server();
  expect(await (await fetch(`${s.url}/api/status`)).json()).toEqual({ ...identity, checksum: 'abc', mode: 'simulation', state: 'ready' });
  expect((await fetch(`${s.url}/api/status/extra`)).status).toBe(404);
  expect((await fetch(`${s.url}/api/events?after=-1`)).status).toBe(400);
  const challenge = await (await fetch(`${s.url}/api/challenge`)).json();
  const payload = JSON.stringify({ oneinch: 'synthetic-secret', mode: 'simulation' });
  const signature = await owner.signMessage({ message: authMessage('configure', challenge, payload) });
  const r = await fetch(`${s.url}/api/configure`, { method: 'POST', body: JSON.stringify({ challenge, payload, signature }) });
  expect(r.status).toBe(200); expect(s.configure).toHaveBeenCalledWith(JSON.parse(payload), owner.address);
  expect(await r.text()).not.toContain('synthetic-secret');
});
it('rejects overflow, unknown fields, and wrong signatures without echoing secrets', async () => {
  const s = await server();
  const r = await fetch(`${s.url}/api/configure`, { method: 'POST', body: 'private-secret'.repeat(2000) });
  expect(r.status).toBe(413); expect(await r.text()).not.toContain('private-secret');
  const challenge = await (await fetch(`${s.url}/api/challenge`)).json();
  const payload = '{"url":"private-secret"}', signature = await owner.signMessage({ message: authMessage('configure', challenge, payload) });
  expect((await fetch(`${s.url}/api/configure`, { method: 'POST', body: JSON.stringify({ challenge, payload, signature }) })).status).toBe(400);
  expect(s.configure).not.toHaveBeenCalled();
});
it('registers exact methods and loopback backends via the sign socket transport', async () => {
  const post = vi.fn(async () => {}); await registerServices('/synthetic.sock', 8081, post);
  expect(post).toHaveBeenCalledWith('/synthetic.sock', '/services', serviceDefinitions(8081));
  expect(serviceDefinitions(8081).map(s => `${s.method} ${s.path}`)).toEqual(['GET /api/status', 'GET /api/events', 'GET /api/challenge', 'POST /api/configure', 'POST /api/stop']);
  expect(serviceDefinitions(8081).every(s => s.backend === 'http://127.0.0.1:8081')).toBe(true);
});
it.runIf(process.platform !== 'win32')('registers over a real Unix socket', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'portfolio-socket-')), socket = join(directory, 'sign.sock');
  let received = '';
  const server = createServer((req, res) => { req.on('data', chunk => { received += String(chunk); }); req.on('end', () => { res.end('{}'); }); });
  await new Promise<void>(r => server.listen(socket, r));
  try { await registerServices(socket, 8081); expect(JSON.parse(received)).toEqual(serviceDefinitions(8081)); }
  finally { await new Promise<void>(r => server.close(() => r())); await rm(directory, { recursive: true, force: true }); }
});
