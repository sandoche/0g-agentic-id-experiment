import { HashLock, Immutables, EvmAddress, DstImmutablesComplement, EvmEscrowFactoryFacade, ESCROW_FACTORY, ESCROW_SRC_IMPLEMENTATION,
  ESCROW_DST_IMPLEMENTATION, SrcEscrowCreatedEvent, DstEscrowCreatedEvent, EscrowWithdrawalEvent, EscrowCancelledEvent, type ReadyToAcceptSecretFill } from '@1inch/cross-chain-sdk';
import { erc20Abi, type Hex, parseAbi, encodeFunctionData } from 'viem';
import { createRpc } from './rpc.js';
import type { Config, TradingChain, Address } from './types.js';
import type { Call } from './transaction.js';
import type { FusionRecord } from './fusion.js';
import { restoreOrder } from './fusion.js';
export function validateEscrowPair(p: FusionRecord, idx: number, src: Immutables<EvmAddress>, complement: DstImmutablesComplement<EvmAddress>, dst: Immutables<EvmAddress>, now: bigint) {
  const secret = p.secrets[idx]; if (!secret) throw new Error('INVALID_SECRET_INDEX');
  const eq = (a: string, b: string) => a.toLowerCase() === b.toLowerCase();
  const order = restoreOrder(p), srcTime = src.timeLocks.toSrcTimeLocks(), dstTime = dst.timeLocks.toDstTimeLocks();
  const fees = (dst.fees?.integratorFeeAmount ?? 0n) + (dst.fees?.resolverFeeAmount ?? 0n);
  if (`0x${src.orderHash.toString('hex')}` !== p.hash || !src.orderHash.equals(dst.orderHash)
    || !eq(src.maker.toString(), p.wallet) || !eq(dst.maker.toString(), p.wallet) || !eq(complement.maker.toString(), p.wallet)
    || !eq(src.token.toString(), p.action.from.address) || !eq(dst.token.toString(), p.action.to.address)
    || !eq(complement.token.toString(), p.action.to.address) || complement.chainId !== BigInt(p.action.to.chainId)
    || src.hashLock.toString() !== HashLock.hashSecret(secret) || !src.hashLock.eq(dst.hashLock)
    || src.amount <= 0n || src.amount > p.action.amount || dst.amount !== complement.amount
    || dst.amount - fees < (p.minimum * src.amount + p.action.amount - 1n) / p.action.amount
    || src.safetyDeposit < order.srcSafetyDeposit || dst.safetyDeposit < order.dstSafetyDeposit
    || (src.timeLocks.build() & ((1n << 224n) - 1n)) !== (order.timeLocks.build() & ((1n << 224n) - 1n))
    || (dst.timeLocks.build() & ((1n << 224n) - 1n)) !== (order.timeLocks.build() & ((1n << 224n) - 1n))
    || now < srcTime.privateWithdrawal || now < dstTime.privateWithdrawal
    || now + 120n >= dstTime.privateCancellation || dstTime.privateCancellation + 60n >= srcTime.privateCancellation) throw new Error('ESCROW_UNVERIFIED');
}
const escrowAbi = parseAbi([
  'function publicCancel((bytes32 orderHash,bytes32 hashlock,uint256 maker,uint256 taker,uint256 token,uint256 amount,uint256 safetyDeposit,uint256 timelocks,bytes parameters) immutables)',
  'function publicWithdraw(bytes32 secret,(bytes32 orderHash,bytes32 hashlock,uint256 maker,uint256 taker,uint256 token,uint256 amount,uint256 safetyDeposit,uint256 timelocks,bytes parameters) immutables)',
]);
export type VerifiedPair = { source: Address; destination: Address; src: string; dst: string; srcBlock: bigint; dstBlock: bigint };
function factory(chain: TradingChain) { return new EvmEscrowFactoryFacade(chain, ESCROW_FACTORY[chain]); }
const addr = (a: EvmAddress) => a.toString().toLowerCase() as Address;
export function createEscrowVerifier(config: Config, rpc: (chain: TradingChain) => ReturnType<typeof createRpc> = chain => createRpc(config, chain)) {
  async function client(chain: TradingChain) { const c = rpc(chain); if (await c.getChainId() !== chain) throw new Error('RPC_CHAIN_MISMATCH'); return c; }
  async function receipt(chain: TradingChain, hash: string) {
    const c = await client(chain), r = await c.getTransactionReceipt({ hash: hash as Hex });
    if (r.status !== 'success' || await c.getBlockNumber() < r.blockNumber + 1n) throw new Error('ESCROW_UNCONFIRMED');
    return { c, r, block: await c.getBlock({ blockNumber: r.blockNumber }) };
  }
  async function active(chain: TradingChain, address: Address, i: Immutables<EvmAddress>, implementation: EvmAddress) {
    const c = await client(chain), code = await c.getBytecode({ address });
    if (!code?.toLowerCase().includes(addr(implementation).slice(2))
      || await c.readContract({ address: addr(i.token), abi: erc20Abi, functionName: 'balanceOf', args: [address] }) < i.amount
      || await c.getBalance({ address }) < i.safetyDeposit) throw new Error('ESCROW_UNFUNDED');
  }
  async function logs(chain: TradingChain, address: Address, from: bigint, to: bigint) {
    const c = await client(chain), found = [];
    for (let start = from; start <= to; start += 2000n) {
      if (start - from >= 20000n) throw new Error('RECOVERY_SCAN_LIMIT');
      found.push(...await c.getLogs({ address, fromBlock: start, toBlock: start + 1999n < to ? start + 1999n : to }));
    }
    return found;
  }
  async function terminal(p: FusionRecord, chain: TradingChain, address: Address, from: bigint, cancelled: boolean) {
    const c = await client(chain), head = await c.getBlockNumber();
    p.terminalScans ??= {};
    const scan = p.terminalScans[`${chain}:${address.toLowerCase()}`] ??= { cursor: from, cancelled: false, withdrawn: false };
    // A restart continues from the saved cursor; old escrows never require an unbounded scan.
    for (let page = 0; page < 10 && scan.cursor < head && !scan.cancelled && !scan.withdrawn; page++) {
      const to = head - 1n < scan.cursor + 1999n ? head - 1n : scan.cursor + 1999n;
      for (const log of await logs(chain, address, scan.cursor, to)) {
        if (log.topics[0] === EscrowCancelledEvent.TOPIC) scan.cancelled = true;
        if (log.topics[0] === EscrowWithdrawalEvent.TOPIC) scan.withdrawn = true;
      }
      scan.cursor = to + 1n;
    }
    return cancelled ? scan.cancelled : scan.withdrawn;
  }
  return {
    async verify(p: FusionRecord, fill: ReadyToAcceptSecretFill): Promise<VerifiedPair> {
      const { r: sr, block: sb } = await receipt(p.action.from.chainId, fill.srcEscrowDeployTxHash);
      const { r: dr, block: db } = await receipt(p.action.to.chainId, fill.dstEscrowDeployTxHash);
      const sources = sr.logs.filter(l => l.address.toLowerCase() === addr(ESCROW_FACTORY[p.action.from.chainId]) && l.topics[0] === SrcEscrowCreatedEvent.TOPIC)
        .map(l => SrcEscrowCreatedEvent.fromData(l.data)).filter(e => `0x${e.srcImmutables.orderHash.toString('hex')}` === p.hash && e.srcImmutables.hashLock.toString() === HashLock.hashSecret(p.secrets[fill.idx]!));
      if (sources.length !== 1) throw new Error('ESCROW_UNVERIFIED');
      const sourceEvent = sources[0]!, src = sourceEvent.srcImmutables;
      const co = sourceEvent.dstImmutablesComplement;
      if (co.chainId !== BigInt(p.action.to.chainId)) throw new Error('ESCROW_UNVERIFIED');
      const complement = DstImmutablesComplement.new({ ...co, maker: EvmAddress.fromString(co.maker.toString()), taker: EvmAddress.fromString(co.taker.toString()), token: EvmAddress.fromString(co.token.toString()) });
      const dests = dr.logs.filter(l => l.address.toLowerCase() === addr(ESCROW_FACTORY[p.action.to.chainId]) && l.topics[0] === DstEscrowCreatedEvent.TOPIC)
        .map(l => DstEscrowCreatedEvent.fromData(l.data)).filter(e => e.hashlock === src.hashLock.toString());
      if (dests.length !== 1 || src.timeLocks.deployedAt !== sb.timestamp) throw new Error('ESCROW_UNVERIFIED');
      const de = dests[0]!, dst = src.withComplement(complement).withDeployedAt(db.timestamp).withTaker(de.taker);
      const source = addr(factory(p.action.from.chainId).getSrcEscrowAddress(src, ESCROW_SRC_IMPLEMENTATION[p.action.from.chainId]));
      const destination = addr(factory(p.action.to.chainId).getDstEscrowAddress(src, complement, db.timestamp, de.taker, ESCROW_DST_IMPLEMENTATION[p.action.to.chainId]));
      if (destination !== addr(de.escrow)) throw new Error('ESCROW_UNVERIFIED');
      validateEscrowPair(p, fill.idx, src, complement, dst, BigInt(Math.floor(Date.now() / 1000)));
      await active(p.action.from.chainId, source, src, ESCROW_SRC_IMPLEMENTATION[p.action.from.chainId]);
      await active(p.action.to.chainId, destination, dst, ESCROW_DST_IMPLEMENTATION[p.action.to.chainId]);
      return { source, destination, src: src.toABIEncoded(), dst: dst.toABIEncoded(), srcBlock: sr.blockNumber, dstBlock: dr.blockNumber };
    },
    async settled(p: FusionRecord) {
      const c = await client(p.action.from.chainId), head = await c.getBlockNumber();
      p.discovered ??= {};
      // Independently enumerate factory emissions; an API omitting a partial fill cannot make funds appear free.
      const from = p.sourceCursor ?? p.sourceBlock, to = head - 1n < from + 1999n ? head - 1n : from + 1999n;
      for (const l of await logs(p.action.from.chainId, addr(ESCROW_FACTORY[p.action.from.chainId]), from, to)) {
        if (l.topics[0] !== SrcEscrowCreatedEvent.TOPIC) continue;
        const e = SrcEscrowCreatedEvent.fromData(l.data), i = e.srcImmutables;
        if (`0x${i.orderHash.toString('hex')}` !== p.hash) continue;
        const source = addr(factory(p.action.from.chainId).getSrcEscrowAddress(i, ESCROW_SRC_IMPLEMENTATION[p.action.from.chainId]));
        p.discovered[source] = { source, sourceBlock: l.blockNumber!, immutables: i.toABIEncoded(), complement: JSON.stringify(e.dstImmutablesComplement.toJSON()) };
      }
      p.sourceCursor = to + 1n;
      if (to < head - 1n) return false;
      const known = Object.values(p.discovered);
      let resolved = 0n;
      for (const item of known) {
        const i = Immutables.fromABIEncoded(item.immutables);
        if (await terminal(p, p.action.from.chainId, item.source as Address, item.sourceBlock, true)) { resolved += i.amount; continue; }
        const pair = Object.values(p.fills).find(v => (v as VerifiedPair).source === item.source) as VerifiedPair | undefined;
        if (!pair || !await terminal(p, p.action.from.chainId, pair.source, pair.srcBlock, false)
          || !await terminal(p, p.action.to.chainId, pair.destination, pair.dstBlock, false)) return false;
        resolved += i.amount;
      }
      const expired = restoreOrder(p).deadline < BigInt(Math.floor(Date.now() / 1000)) - 60n;
      return resolved === p.action.amount || (p.cancelled === true && expired && resolved === known.reduce((s, v) => s + Immutables.fromABIEncoded(v.immutables).amount, 0n));
    },
    async recovery(p: FusionRecord): Promise<Call | undefined> {
      const now = BigInt(Math.floor(Date.now() / 1000));
      for (const item of Object.values(p.discovered ?? {})) {
        const src = Immutables.fromABIEncoded(item.immutables), chainId = p.action.from.chainId;
        if (now < src.timeLocks.toSrcTimeLocks().publicCancellation || await terminal(p, chainId, item.source as Address, item.sourceBlock, true)
          || await terminal(p, chainId, item.source as Address, item.sourceBlock, false)) continue;
        const i = src.build();
        const data = encodeFunctionData({ abi: escrowAbi, functionName: 'publicCancel', args: [{ ...i, orderHash: i.orderHash as Hex, hashlock: i.hashlock as Hex,
          maker: BigInt(i.maker), taker: BigInt(i.taker), token: BigInt(i.token), amount: BigInt(i.amount), safetyDeposit: BigInt(i.safetyDeposit), timelocks: BigInt(i.timelocks), parameters: i.parameters as Hex }] });
        const call = { chainId, to: item.source as Address, data, value: 0n };
        // eth_call enforces this deployment's access-token restriction; no unauthorized cancellation signature.
        try { await (await client(chainId)).call({ account: p.wallet, to: call.to, data }); return call; } catch { continue; }
      }
      return undefined;
    },
  };
}
