import { expect, it, vi } from 'vitest';
import { runInNewContext } from 'node:vm';
import { createHash } from 'node:crypto';
import { buildCapability, unpackCapability, launcher } from '../src/bootstrap.js';
import { config } from './fixtures.js';
import { readConfig } from '../src/config.js';
const files = { 'worker.mjs': 'export const fixture = true;', 'package.json': '{}', 'package-lock.json': '{}' };
it('retries an interrupted dependency install and marks only a successful matching lock', () => {
  const disk = new Map<string, string>([['manifest.json', '{"files":{}}'], ['package.json', '{}'], ['package-lock.json', '{}']]);
  const fs = {
    readFileSync: (p: string) => { if (!disk.has(p)) throw Object.assign(new Error('missing'), { code: 'ENOENT' }); return disk.get(p); },
    existsSync: (p: string) => p === 'node_modules' || disk.has(p), mkdirSync: () => {},
    writeFileSync: (p: string, v: string) => disk.set(p, v), renameSync: (a: string, b: string) => { disk.set(b, disk.get(a)!); disk.delete(a); },
    unlinkSync: (p: string) => disk.delete(p), openSync: () => 3, closeSync: () => {},
  };
  const install = vi.fn().mockReturnValueOnce({ status: 1 }).mockReturnValue({ status: 0 });
  const spawn = vi.fn(() => ({ unref() {} }));
  const run = () => runInNewContext(launcher, { __dirname: '.', console: { log() {} },
    process: { versions: { node: '22.0.0' }, argv: ['node', 'start.cjs', '1'], chdir() {}, platform: 'linux', env: {}, execPath: 'node' },
    require: (name: string) => name === 'node:fs' ? fs : name === 'node:crypto' ? { createHash } : name === 'node:child_process' ? { spawnSync: install, spawn } : {},
  });
  expect(run).toThrow('DEPENDENCY_INSTALL_FAILED'); expect(spawn).not.toHaveBeenCalled();
  run(); expect(install).toHaveBeenCalledTimes(2); expect(spawn).toHaveBeenCalledOnce();
  run(); expect(install).toHaveBeenCalledTimes(2);
  disk.set('package-lock.json', '{"changed":true}'); run(); expect(install).toHaveBeenCalledTimes(3);
});
it('round-trips a deterministic encrypted-persona payload without local credentials', () => {
  const cap = buildCapability(config.strategy, files);
  const unpacked = unpackCapability(cap.systemPrompt);
  expect(unpacked['worker.mjs']).toBe(files['worker.mjs']);
  expect(unpacked['runtime.json']).toContain('Synthetic test strategy.');
  expect(cap.sha256).toBe(buildCapability(config.strategy, files).sha256);
  expect(cap.systemPrompt).not.toContain('OWNER_PRIVATE_KEY');
  expect(cap.systemPrompt).not.toContain('AGENT_API_KEY');
});
it('preserves validated runtime infrastructure settings without embedding credentials', () => {
  const cfg = { ...config, attestorUrl: 'https://attestor.example', rpcUrls: { 56: 'https://bnb.example', 4663: 'https://rh.example', 8453: 'https://base.example', 42161: 'https://arb.example' }, credentials: { oneinch: 'synthetic-private-trading-key' } };
  const payload = unpackCapability(buildCapability(cfg.strategy, files, cfg).systemPrompt);
  const restored = readConfig(JSON.parse(payload['runtime.json']!));
  expect(restored.attestorUrl).toBe(cfg.attestorUrl); expect(restored.rpcUrls).toEqual(cfg.rpcUrls); expect(restored.model).toBe(cfg.model);
  expect(JSON.stringify(payload)).not.toContain('synthetic-private-trading-key');
});
it('rejects checksum corruption, traversal and oversized files', () => {
  const cap = buildCapability(config.strategy, files);
  expect(() => unpackCapability(cap.systemPrompt.replace(cap.sha256, '0'.repeat(64)))).toThrow('PAYLOAD_CHECKSUM');
  expect(() => buildCapability(config.strategy, { ...files, '../.env': 'secret' })).toThrow('UNSAFE_PAYLOAD_PATH');
  expect(() => buildCapability(config.strategy, { ...files, 'worker.mjs': 'x'.repeat(9 * 1024 * 1024) })).toThrow('PAYLOAD_TOO_LARGE');
});
