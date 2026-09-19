import { randomBytes } from 'node:crypto';
import { EvmCrossChainOrder, Extension, HashLock, ESCROW_FACTORY, SDK, type LimitOrderV4Struct, type ReadyToAcceptSecretFill } from '@1inch/cross-chain-sdk';
import { hashTypedData, type Hex, type LocalAccount } from 'viem';
import { getAsset } from './assets.js';
import { requireTradingChain } from './config.js';
import { requestJson } from './market.js';
import { ROUTER, type SwapPort } from './swap.js';
import type { Action, Address, Config } from './types.js';
import type { Store } from './state.js';
import type { ExecutionResult } from './transaction.js';
export type FusionRecord = {
  action: Extract<Action, { kind: 'transfer' }>; wallet: Address; owner: Address;
  order: LimitOrderV4Struct; extension: string; hash: string; quoteId: string;
  secrets: string[]; state: 'prepared' | 'submission-unknown' | 'pending' | 'partially-filled' | 'expired' | 'recovering';
  disclosed: number[]; fills: Record<string, unknown>; sourceBlock: bigint; minimum: bigint;
  signature?: Hex; recovery?: { kind: 'transaction'; id: string; payload: unknown }; cancelled?: boolean;
  sourceCursor?: bigint; discovered?: Record<string, { source: string; sourceBlock: bigint; immutables: string; complement: string }>;
};
export function restoreOrder(p: FusionRecord): EvmCrossChainOrder {
  const order = EvmCrossChainOrder.fromDataAndExtension(p.order, Extension.decode(p.extension));
  if (order.getOrderHash(p.action.from.chainId) !== p.hash || order.extension.encode() !== p.extension) throw new Error('ORDER_CORRUPT');
  return order;
}
export function validateOrder(p: FusionRecord, allowExpired = false): EvmCrossChainOrder {
  const a = p.action;
  requireTradingChain(a.from.chainId); requireTradingChain(a.to.chainId);
  if (a.from.chainId === a.to.chainId || a.amount <= 0n) throw new Error('INVALID_TRANSFER');
  for (const token of [a.from, a.to]) {
    const canonical = getAsset(token.id);
    if (canonical.kind !== 'cash' || canonical.chainId !== token.chainId || canonical.address !== token.address || canonical.decimals !== token.decimals) throw new Error('INVALID_TRANSFER');
  }
  if (p.secrets.length < 1 || p.secrets.length > 32 || p.secrets.some(s => !/^0x[\da-f]{64}$/i.test(s))) throw new Error('INVALID_SECRETS');
  const o = restoreOrder(p), hashLock = p.secrets.length === 1 ? HashLock.forSingleFill(p.secrets[0]!) : HashLock.forMultipleFills(HashLock.getMerkleLeaves(p.secrets));
  const eq = (x: string, y: string) => x.toLowerCase() === y.toLowerCase();
  const traits = BigInt(o.build().makerTraits), now = BigInt(Math.floor(Date.now() / 1000));
  if (!eq(o.maker.toString(), p.wallet) || !eq(o.receiver.toString(), p.wallet) || !eq(o.makerAsset.toString(), a.from.address)
    || !eq(o.takerAsset.toString(), a.to.address) || o.dstChainId !== a.to.chainId || o.makingAmount !== a.amount
    || o.takingAmount < p.minimum || p.minimum <= 0n || !o.hashLock.eq(hashLock)
    || !eq(o.escrowExtension.address.toString(), ESCROW_FACTORY[a.from.chainId].toString())
    || o.extension.makerPermit !== '0x' || (traits & ((1n << 248n) | (1n << 247n) | (1n << 252n))) !== 0n
    || (!allowExpired && (o.deadline <= now || o.deadline > now + 3600n))) throw new Error('ORDER_INTENT_MISMATCH');
  const data = o.getTypedData(a.from.chainId);
  if (Number(data.domain.chainId) !== a.from.chainId || !eq(String(data.domain.verifyingContract), ROUTER)) throw new Error('UNSAFE_ORDER_DOMAIN');
  return o;
}
export type FusionLifecyclePort = {
  submit(p: FusionRecord): Promise<void>; ready(p: FusionRecord): Promise<ReadyToAcceptSecretFill[]>;
  verify(p: FusionRecord, fill: ReadyToAcceptSecretFill): Promise<unknown>;
  disclose(hash: string, secret: string): Promise<void>;
  settle(p: FusionRecord): Promise<boolean>; recover(p: FusionRecord): Promise<void>;
};
export function createFusionLifecycle(store: Store, port: FusionLifecyclePort) {
  async function save(p: FusionRecord) { const j = await store.load(); j.pending = { kind: 'fusion', id: p.hash, payload: p }; await store.save(j); }
  return {
    async start(p: FusionRecord): Promise<ExecutionResult> {
      if ((await store.load()).pending) return 'pending';
      validateOrder(p); await save(p);
      try { await port.submit(p); p.state = 'pending'; } catch { p.state = 'submission-unknown'; }
      const saved = (await store.load()).pending?.payload as FusionRecord | undefined;
      if (saved?.signature) p.signature = saved.signature;
      await save(p); return 'pending';
    },
    async reconcile(): Promise<ExecutionResult> {
      const j = await store.load(); if (!j.pending) return 'settled'; if (j.pending.kind !== 'fusion') return 'pending';
      const p = j.pending.payload as FusionRecord; validateOrder(p, true);
      if (await port.settle(p)) { delete j.pending; await store.save(j); return 'settled'; }
      for (const fill of await port.ready(p)) {
        if (!Number.isInteger(fill.idx) || fill.idx < 0 || fill.idx >= p.secrets.length) throw new Error('INVALID_SECRET_INDEX');
        if (p.disclosed.includes(fill.idx)) continue;
        p.fills[fill.idx] = await port.verify(p, fill);
        // Persist the verified pair before an irreversible disclosure. A timeout retries only this same secret.
        await save(p); await port.disclose(p.hash, p.secrets[fill.idx]!);
        p.disclosed.push(fill.idx); p.state = 'partially-filled'; await save(p);
      }
      await port.recover(p); await save(p); return 'pending';
    },
  };
}
export function createFusionSdk(config: Config, account: LocalAccount, store: Store, guard: () => Promise<void>, chain: SwapPort) {
  const http = async <T>(url: string, method: string, body?: unknown) => {
    const target = new URL(url);
    if (target.origin !== 'https://api.1inch.com' || !target.pathname.startsWith('/fusion-plus/')) throw new Error('UNSAFE_API_URL');
    return requestJson<T>(target, { method, headers: { Authorization: `Bearer ${config.credentials.oneinch}`, 'Content-Type': 'application/json' },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
  };
  return new SDK({ url: 'https://api.1inch.com/fusion-plus',
    httpProvider: { get: url => http(url, 'GET'), post: (url, body) => http(url, 'POST', body) },
    blockchainProvider: {
      ethCall: async () => { throw new Error('UNSUPPORTED_SDK_CALL'); },
      async signTypedData(wallet, data) {
        const j = await store.load(); if (j.pending?.kind !== 'fusion') throw new Error('ORDER_NOT_PERSISTED');
        const p = j.pending.payload as FusionRecord, o = validateOrder(p);
        if (wallet.toLowerCase() !== account.address.toLowerCase() || hashTypedData(data) !== o.getOrderHash(p.action.from.chainId)) throw new Error('UNSAFE_TYPED_DATA');
        await chain.verifyRouter(p.action.from.chainId);
        if (await chain.balance(p.action.from) < p.action.amount || await chain.allowance(p.action.from) < p.action.amount) throw new Error('INSUFFICIENT_BALANCE');
        await guard();
        const signature = await account.signTypedData(data);
        p.signature = signature; await store.save(j);
        return signature;
      },
    },
  });
}
export async function prepareFusion(sdk: SDK, action: FusionRecord['action'], wallet: Address, owner: Address, sourceBlock: bigint, slippage: bigint): Promise<FusionRecord> {
  requireTradingChain(action.from.chainId); requireTradingChain(action.to.chainId);
  const q = await sdk.getQuote({ srcChainId: action.from.chainId, dstChainId: action.to.chainId,
    srcTokenAddress: action.from.address, dstTokenAddress: action.to.address, amount: action.amount.toString(), walletAddress: wallet, enableEstimate: true, isPermit2: false });
  if (q.srcEscrowFactory.toString().toLowerCase() !== ESCROW_FACTORY[action.from.chainId].toString().toLowerCase()
    || q.dstEscrowFactory.toString().toLowerCase() !== ESCROW_FACTORY[action.to.chainId].toString().toLowerCase()) throw new Error('FACTORY_MISMATCH');
  const preset = q.recommendedPreset, count = q.presets[preset]?.secretsCount ?? 0;
  if (!Number.isInteger(count) || count < 1 || count > 32) throw new Error('INVALID_SECRETS_COUNT');
  const secrets = Array.from({ length: count }, () => `0x${randomBytes(32).toString('hex')}`);
  const lock = count === 1 ? HashLock.forSingleFill(secrets[0]!) : HashLock.forMultipleFills(HashLock.getMerkleLeaves(secrets));
  const prepared = sdk.createOrder(q, { walletAddress: wallet, receiver: wallet, preset, hashLock: lock, secretHashes: secrets.map(s => HashLock.hashSecret(s)), isPermit2: false });
  if (!(prepared.order instanceof EvmCrossChainOrder)) throw new Error('UNSUPPORTED_ORDER');
  const p: FusionRecord = { action, wallet, owner, order: prepared.order.build(), extension: prepared.order.extension.encode(), hash: prepared.hash,
    quoteId: prepared.quoteId, secrets, state: 'prepared', disclosed: [], fills: {}, sourceBlock,
    minimum: (q.dstTokenAmount * (10000n - slippage) + 9999n) / 10000n };
  validateOrder(p); return p;
}
