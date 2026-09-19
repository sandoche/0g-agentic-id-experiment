import { createHash, randomBytes } from 'node:crypto';
import { recoverMessageAddress, type Hex } from 'viem';
import type { Address } from './types.js';
export type Identity = { agentId: string; wallet: Address; instance: string };
export type Challenge = Identity & { nonce: string; issuedAt: number; expiresAt: number };
export type Envelope = { challenge: Challenge; payload: string; signature: Hex };
export function authMessage(action: 'configure' | 'stop', c: Challenge, payload: string): string {
  const hash = createHash('sha256').update(payload, 'utf8').digest('hex');
  return ['Portfolio worker authorization v1', `action:${action}`, `agent:${c.agentId}`, `seal:${c.wallet.toLowerCase()}`,
    `instance:${c.instance}`, `nonce:${c.nonce}`, `issued:${c.issuedAt}`, `expires:${c.expiresAt}`, `payload-sha256:${hash}`].join('\n');
}
export function createAuth(identity: Identity, readOwner: () => Promise<Address>) {
  const outstanding = new Map<string, Challenge>();
  return {
    challenge(): Challenge {
      const now = Date.now();
      for (const [nonce, c] of outstanding) if (c.expiresAt < now) outstanding.delete(nonce);
      if (outstanding.size >= 128) throw new Error('TOO_MANY_CHALLENGES');
      const c = { ...identity, nonce: randomBytes(32).toString('hex'), issuedAt: now, expiresAt: now + 60000 };
      outstanding.set(c.nonce, c); return { ...c };
    },
    async verify(action: 'configure' | 'stop', envelope: Envelope): Promise<Address> {
      try {
        if (!envelope || Object.keys(envelope).sort().join(',') !== 'challenge,payload,signature' || typeof envelope.payload !== 'string'
          || envelope.payload.length > 4096 || !/^0x[\da-f]{130}$/i.test(envelope.signature)) throw new Error();
        const c = envelope.challenge, stored = outstanding.get(c.nonce);
        if (!stored || JSON.stringify(stored) !== JSON.stringify(c) || c.issuedAt > Date.now() || c.expiresAt < Date.now()) throw new Error();
        // Consume synchronously before owner RPC or signature recovery, including failed attempts.
        outstanding.delete(c.nonce);
        const owner = await readOwner(), signer = await recoverMessageAddress({ message: authMessage(action, stored, envelope.payload), signature: envelope.signature });
        if (signer.toLowerCase() !== owner.toLowerCase()) throw new Error();
        return owner;
      } catch { throw new Error('UNAUTHORIZED'); }
    },
  };
}
