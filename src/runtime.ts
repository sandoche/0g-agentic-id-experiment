import { readFile, mkdir } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { AgenticID } from '@0gfoundation/0g-agenticid-sdk';
import { sealAccount } from '@0gfoundation/0g-agenticid-sdk/seal';
import { readConfig } from './config.js';
import { assets, cashAsset } from './assets.js';
import { createStore, atomicWrite } from './state.js';
import { createMarket, type Market } from './market.js';
import { createWorker, type Worker, type Execution } from './worker.js';
import { createLogger } from './log.js';
import { createChain } from './chain.js';
import { createSwap, createSwapApi } from './swap.js';
import { createFusionExecution } from './fusion-execution.js';
import { createAuth } from './auth.js';
import { startServer, registerServices } from './server.js';
import type { Address } from './types.js';
import { paperMarket } from './paper.js';
async function main() {
  if (Number(process.versions.node.split('.')[0]) < 22) throw new Error('NODE_22_REQUIRED');
  const id = process.argv[process.argv.indexOf('--agent-id') + 1]; if (!id || !/^\d+$/.test(id)) throw new Error('AGENT_ID_REQUIRED');
  const selfTest = process.argv.includes('--self-test');
  const config = readConfig(JSON.parse(await readFile('runtime.json', 'utf8')));
  const { sha256: checksum } = JSON.parse(await readFile('manifest.json', 'utf8')) as { sha256: string };
  if (!/^[\da-f]{64}$/.test(checksum)) throw new Error('PAYLOAD_CHECKSUM');
  let wallet: Address, readOwner: () => Promise<Address>, account: Awaited<ReturnType<typeof sealAccount>> | undefined;
  if (selfTest) { wallet = '0x1111111111111111111111111111111111111111'; readOwner = async () => wallet; }
  else {
    if (!process.env.SEAL_SIGN_SOCK || !process.env.AGENT_SEAL) throw new Error('SEALED_RUNTIME_REQUIRED');
    account = await sealAccount(); wallet = account.address;
    const ag = await AgenticID.fromAttestor(config.attestorUrl);
    if ((await ag.agent.getAgentSeal(BigInt(id))).toLowerCase() !== wallet.toLowerCase()) throw new Error('AGENT_IDENTITY_MISMATCH');
    readOwner = () => ag.agent.ownerOf(BigInt(id));
  }
  const store = createStore('state', wallet); await store.lock();
  const initial = await store.load(); await store.save(initial);
  const logger = createLogger('state/events.jsonl'); let worker: Worker;
  let market: Market, execution: Execution;
  if (selfTest) {
    market = paperMarket(config);
    execution = { execute: async () => { throw new Error('SELF_TEST_CANNOT_SIGN'); }, reconcile: async () => 'pending' };
  } else {
    market = createMarket(config);
    const guard = () => worker.guard(), event = async (e: Parameters<Worker['emit']>[0]) => worker.emit(e);
    const chain = createChain(config, account!, store, guard, event), swap = createSwap(config, wallet, createSwapApi(config, wallet), chain.port);
    const fusion = createFusionExecution(config, account!, store, guard, event);
    execution = { execute: a => a.kind === 'swap' ? swap.execute(a) : fusion.execute(a),
      reconcile: async () => (await store.load()).pending?.kind === 'fusion' ? fusion.reconcile() : chain.runner.reconcile() };
  }
  worker = createWorker(config, market, execution, store, readOwner, logger);
  const identity = { agentId: id, wallet, instance: randomUUID() };
  const server = await startServer(worker, createAuth(identity, readOwner), identity, checksum);
  if (!selfTest) await registerServices(process.env.SEAL_SIGN_SOCK!, server.port);
  else { await worker.configure({ oneinch: 'synthetic-test-only', mode: 'simulation' }, wallet); await worker.tick(); }
  await atomicWrite('state/ready.json', JSON.stringify({ ...identity, checksum, port: server.port, pid: process.pid }));
  await worker.emit({ type: 'ready', time: Date.now() }); worker.start();
  for (const signal of ['SIGINT', 'SIGTERM'] as const) process.once(signal, () => {
    void (async () => { await worker.stop(); await worker.drain(); await server.close(); await store.close(); process.exit(0); })().catch(() => process.exit(1));
  });
}
main().catch(() => { console.error('WORKER_START_FAILED'); process.exit(1); });
