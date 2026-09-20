import { mkdir } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { join } from 'node:path';
import { concatHex, keccak256, stringToHex } from 'viem';
import type { AgentClient, AgenticID, ServeProof } from '@0gfoundation/0g-agenticid-sdk';
import { atomicWrite, stringify } from './state.js';
export const taskHash = (method: string, path: string, request: Uint8Array, response: Uint8Array, status: number) =>
  keccak256(concatHex([stringToHex(method), stringToHex(path), keccak256(request), keccak256(response), stringToHex(String(status))]));
export async function verifyTranscript(proof: ServeProof | null, agentId: bigint, path: string, response: Uint8Array, status: number, verify: (p: ServeProof) => Promise<boolean>) {
  const now = BigInt(Math.floor(Date.now() / 1000));
  if (!proof || proof.agentId !== agentId || proof.timestamp > now + 30n || proof.timestamp < now - 300n || proof.deadline < now
    || proof.taskHash !== taskHash('GET', path, new Uint8Array(), response, status) || !await verify(proof)) throw new Error('PROOF_INVALID');
}
export async function readProven<T>(ag: AgenticID, client: AgentClient, agentId: bigint, path: string, directory?: string): Promise<T> {
  if (new URL(client.base).protocol !== 'https:' || !/^\/api\/(status|challenge|events(?:\?after=\d+)?)$/.test(path)) throw new Error('UNSAFE_PROOF_REQUEST');
  const { response, proof } = await client.fetchWithProof(path, { signal: AbortSignal.timeout(15000), redirect: 'error' });
  const bytes = new Uint8Array(await response.arrayBuffer());
  if (bytes.length > 1024 * 1024 || response.status !== 200) throw new Error('AGENT_NOT_READY');
  await verifyTranscript(proof, agentId, path, bytes, response.status, async p => (await ag.reputation.verifyProof(p)).ok);
  if (directory) {
    await mkdir(directory, { recursive: true, mode: 0o700 });
    await atomicWrite(join(directory, `${Date.now()}-${randomUUID()}.json`), stringify({ method: 'GET', path, status: response.status, requestBody: '', responseBase64: Buffer.from(bytes).toString('base64'), proof, verifiedAt: new Date().toISOString() }));
  }
  return JSON.parse(new TextDecoder().decode(bytes)) as T;
}
