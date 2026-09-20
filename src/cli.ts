import { parseArgs } from 'node:util';
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';
import { readFile } from 'node:fs/promises';
import { setTimeout as delay } from 'node:timers/promises';
import { AgenticID } from '@0gfoundation/0g-agenticid-sdk';
import { parseEther, formatEther } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { loadEnvironment } from './environment.js';
import { readConfig } from './config.js';
import { assets, cashAsset, chainNames } from './assets.js';
import { createStore, parse } from './state.js';
import { createLogger } from './log.js';
import { createWorker } from './worker.js';
import { activate, checkModel, deploymentPreflight, loadDeployment, mintOrResume, probeInference } from './agent.js';
import { requestJson } from './market.js';
import { onlineCheck, gasCheck } from './preflight.js';
import { readProven, verifyTranscript } from './proof.js';
import { authMessage, type Challenge } from './auth.js';
import type { Config } from './types.js';
import { paperMarket } from './paper.js';
const commands = new Set(['check', 'models', 'simulate', 'deploy', 'activate', 'status', 'watch', 'verify-proof', 'fund', 'topup-sandbox', 'topup-agent', 'stop', 'preflight', 'retry', 'reset']);
const ownerCommands = new Set(['deploy', 'activate', 'topup-sandbox', 'topup-agent', 'stop', 'preflight', 'retry', 'reset']);
export function argumentsFor(args: string[]) {
  const parsed = parseArgs({ args, allowPositionals: true, strict: true, options: { env: { type: 'string' }, online: { type: 'boolean' }, once: { type: 'boolean' },
    agent: { type: 'string' }, live: { type: 'boolean' }, file: { type: 'string' }, amount: { type: 'string' } } });
  const command = parsed.positionals[0]; if (!command || !commands.has(command) || parsed.positionals.length !== 1) throw new Error('COMMAND_REQUIRED');
  if (parsed.values.live && command !== 'activate') throw new Error('LIVE_FLAG_ONLY_ACTIVATE');
  return { command, values: parsed.values };
}
function connectionConfig(env: Record<string, string | undefined>): Config {
  // Managing an existing INFT never needs its private prompt or allocations locally.
  return readConfig({ ...env, TRADING_MODE: 'simulation', STRATEGY_PROMPT: 'Connection settings only; strategy stays in the INFT.',
    PORTFOLIO_ALLOCATIONS: JSON.stringify(assets.filter(a => a.kind === 'position').map(a => ({ symbol: a.symbol, chainId: a.chainId, weightBps: 1250 }))) });
}
async function ownerSdk(config: Config) {
  if (!config.credentials.ownerKey) throw new Error('OWNER_KEY_REQUIRED');
  const remote = await requestJson<{ chain_id: number }>(new URL(`${config.attestorUrl}/config`));
  if (![16602, 16661].includes(remote.chain_id)) throw new Error('UNSUPPORTED_SEALED_ENVIRONMENT');
  return AgenticID.fromAttestor(config.attestorUrl, { account: config.credentials.ownerKey });
}
async function simulate(config: Config, once: boolean) {
  const wallet = '0x0000000000000000000000000000000000000001', store = createStore('.local/simulation', wallet); await store.lock();
  const worker = createWorker(config, paperMarket(config),
    { execute: async () => { throw new Error('SIMULATION_CANNOT_SIGN'); }, reconcile: async () => 'pending' }, store, async () => wallet, createLogger('.local/simulation/events.jsonl'));
  console.log('simulation: synthetic $1 token prices and paper balances; no network requests or signatures.');
  await worker.configure({ oneinch: 'paper-only', mode: 'simulation' }, wallet); await worker.tick();
  if (!once) { worker.start(); await new Promise<void>(r => { process.once('SIGINT', r); process.once('SIGTERM', r); }); }
  await worker.stop(); await store.close();
  if (worker.events(0).some(e => e.type === 'error')) throw new Error('SIMULATION_FAILED');
}
export async function runCli(args: string[], env: Record<string, string | undefined>): Promise<number> {
  try {
    const { command, values } = argumentsFor(args);
    if (command === 'models') {
      const result = await requestJson<{ data: { id: string; verifiability: string; tee_attested: boolean; supported_parameters: string[] }[] }>(new URL('https://router-api.0g.ai/v1/models'));
      for (const m of result.data.filter(m => m.verifiability === 'TeeML' && m.tee_attested && m.supported_parameters.includes('tools'))) console.log(m.id); return 0;
    }
    const localStrategy = ['check', 'simulate', 'deploy'].includes(command);
    const config = localStrategy ? readConfig({ ...env, TRADING_MODE: 'simulation', ...(!ownerCommands.has(command) ? { OWNER_PRIVATE_KEY: undefined } : {}) }) : connectionConfig(env);
    if (command === 'check') {
      console.log('Configuration valid. Ethereum mainnet excluded; simulation is the default.');
      if (values.online) { await checkModel(config.model, 0); if (config.credentials.inference) { await probeInference(config.credentials.inference, config.model); console.log('Private TeeML inference: PASS'); }
        if (!await onlineCheck(config)) throw new Error('SOME_ROUTES_UNAVAILABLE'); }
      return 0;
    }
    if (command === 'simulate') { await simulate(config, !!values.once); return 0; }
    if (command === 'preflight') {
      const p = await deploymentPreflight(config); console.log(JSON.stringify({ sandboxAvailableOG: formatEther(p.available), sandboxMinimumOG: formatEther(p.required), ownerGasOG: formatEther(p.native), acknowledged: p.acknowledgments.allAcked })); return 0;
    }
    if (command === 'deploy') { const result = await mintOrResume(config); console.log(JSON.stringify({ ...result, agentId: String(result.agentId) })); return 0; }
    if (command === 'topup-sandbox') {
      if (!values.amount || !/^\d+(\.\d{1,18})?$/.test(values.amount) || parseEther(values.amount) <= 0n) throw new Error('EXACT_AMOUNT_REQUIRED');
      const ag = await ownerSdk(config); const hash = await ag.deposit({ amountWei: parseEther(values.amount) }); await ag.waitForTransaction(hash); console.log(`Sandbox deposit on configured 0G chain: ${hash}`); return 0;
    }
    if (command === 'verify-proof') {
      if (!values.file) throw new Error('PROOF_FILE_REQUIRED');
      const record = parse(await readFile(values.file, 'utf8'));
      const ag = await AgenticID.fromAttestor(config.attestorUrl);
      const id = values.agent ? BigInt(values.agent) : record.proof.agentId;
      await verifyTranscript(record.proof, id, record.path, Buffer.from(record.responseBase64, 'base64'), record.status, async p => (await ag.reputation.verifyProof(p)).ok);
      console.log(`Verified current proof for agent ${id}.`); return 0;
    }
    if (!values.agent || !/^\d+$/.test(values.agent)) throw new Error('AGENT_ID_REQUIRED');
    const agentId = BigInt(values.agent);
    const ag = ownerCommands.has(command) ? await ownerSdk(config) : await AgenticID.fromAttestor(config.attestorUrl);
    const wallet = await ag.agent.getAgentSeal(agentId);
    if (command === 'fund') {
      console.log(`Agent wallet: ${wallet}`);
      for (const chain of [config.strategy.fundingChain, 4663, 56] as const) { const cash = cashAsset(chain); console.log(`${chainNames[chain]} (${chain}): ${cash.symbol} ${cash.address}; native gas ${chain === 56 ? 'BNB' : 'ETH'}.`); }
      console.log('Use the matching exchange withdrawal network or a supported non-Ethereum route. 0G protocol/evolution gas is separate from investment 0G on BNB.'); return 0;
    }
    if (command === 'topup-agent') {
      if (!values.amount || !/^\d+(\.\d{1,18})?$/.test(values.amount) || parseEther(values.amount) <= 0n) throw new Error('EXACT_AMOUNT_REQUIRED');
      const hash = await ag.agent.topUpAgentSeal(wallet, parseEther(values.amount)); await ag.agent.waitForTransaction(hash); console.log(`Agent evolution-gas transfer on configured 0G chain: ${hash}`); return 0;
    }
    if (command === 'retry' || command === 'reset') {
      if (!config.credentials.inference) throw new Error('INFERENCE_KEY_REQUIRED');
      const seal = await ag.agent.getSealId(agentId); await ag.agent[command](seal, { framework: 'openclaw', apiKey: config.credentials.inference }); console.log('Same identity restarted; activate it again after the container is running.'); return 0;
    }
    if (command === 'activate') {
      config.mode = values.live ? 'live' : 'simulation';
      if (values.live) { if (!await onlineCheck(config, wallet)) throw new Error('SOME_ROUTES_UNAVAILABLE'); await gasCheck(config, wallet); }
      const saved = await loadDeployment(), checksum = saved?.agentId === String(agentId) ? saved.checksum as string : undefined;
      console.log(JSON.stringify(await activate(config, agentId, checksum))); return 0;
    }
    const client = await ag.agent.client(agentId);
    if (command === 'stop') {
      const challenge = await readProven<Challenge>(ag, client, agentId, '/api/challenge');
      if (challenge.agentId !== String(agentId) || challenge.wallet.toLowerCase() !== wallet.toLowerCase()) throw new Error('CHALLENGE_IDENTITY_MISMATCH');
      const payload = '{}', signature = await privateKeyToAccount(config.credentials.ownerKey!).signMessage({ message: authMessage('stop', challenge, payload) });
      const response = await client.fetch('/api/stop', { method: 'POST', redirect: 'error', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ challenge, payload, signature }), signal: AbortSignal.timeout(15000) });
      if (!response.ok) throw new Error('STOP_FAILED'); await response.body?.cancel(); console.log('Worker stopped; unresolved transactions/orders remain journaled.'); return 0;
    }
    const abort = new AbortController(), stop = () => abort.abort(); process.once('SIGINT', stop); process.once('SIGTERM', stop);
    try {
      let cursor = 0;
      do {
        const path = command === 'watch' ? `/api/events?after=${cursor}` : '/api/status';
        const result = await readProven<{ events?: { sequence: number }[] }>(ag, client, agentId, path, '.local/proofs'); console.log(JSON.stringify(result));
        if (result.events?.length) cursor = result.events[result.events.length - 1]!.sequence;
        if (command !== 'watch' || values.once) break;
        await delay(15000, undefined, { signal: abort.signal });
      } while (!abort.signal.aborted);
    } catch (e) { if (!abort.signal.aborted) throw e; }
    finally { process.removeListener('SIGINT', stop); process.removeListener('SIGTERM', stop); }
    console.log(`Proof files: ${resolve('.local/proofs')}`); return 0;
  } catch (error) {
    const message = error instanceof Error ? error.message : '';
    const safe = /^(?:[A-Z][A-Z_]{2,60})(?::\d+)?$/.test(message) ? message : 'COMMAND_FAILED';
    console.error(`${safe}. Check .env.example and README; credentials and private strategy are never printed.`); return 1;
  }
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try { const args = process.argv.slice(2), p = argumentsFor(args); process.exitCode = await runCli(args, await loadEnvironment(p.values.env ?? '.env', ownerCommands.has(p.command))); }
  catch { console.error('Invalid command/options. See README for commands.'); process.exitCode = 1; }
}
