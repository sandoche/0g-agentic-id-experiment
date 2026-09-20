import { expect, it } from 'vitest';
import { buildCapability, unpackCapability } from '../src/bootstrap.js';
import { config } from './fixtures.js';
const files = { 'worker.mjs': 'export const fixture = true;', 'package.json': '{}', 'package-lock.json': '{}' };
it('round-trips a deterministic encrypted-persona payload without local credentials', () => {
  const cap = buildCapability(config.strategy, files);
  const unpacked = unpackCapability(cap.systemPrompt);
  expect(unpacked['worker.mjs']).toBe(files['worker.mjs']);
  expect(unpacked['runtime.json']).toContain('Synthetic test strategy.');
  expect(cap.sha256).toBe(buildCapability(config.strategy, files).sha256);
  expect(cap.systemPrompt).not.toContain('OWNER_PRIVATE_KEY');
  expect(cap.systemPrompt).not.toContain('AGENT_API_KEY');
});
it('rejects checksum corruption, traversal and oversized files', () => {
  const cap = buildCapability(config.strategy, files);
  expect(() => unpackCapability(cap.systemPrompt.replace(cap.sha256, '0'.repeat(64)))).toThrow('PAYLOAD_CHECKSUM');
  expect(() => buildCapability(config.strategy, { ...files, '../.env': 'secret' })).toThrow('UNSAFE_PAYLOAD_PATH');
  expect(() => buildCapability(config.strategy, { ...files, 'worker.mjs': 'x'.repeat(9 * 1024 * 1024) })).toThrow('PAYLOAD_TOO_LARGE');
});
