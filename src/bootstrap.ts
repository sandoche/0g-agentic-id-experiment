import { createHash } from 'node:crypto';
import { gzipSync, gunzipSync } from 'node:zlib';
import { getAsset } from './assets.js';
import type { Strategy } from './types.js';
const limit = 8 * 1024 * 1024;
const allowed = new Set(['worker.mjs', 'package.json', 'package-lock.json', 'runtime.json', 'start.cjs', 'SKILL.md']);
export const sha256 = (s: string | Uint8Array) => createHash('sha256').update(s).digest('hex');
export const launcher = String.raw`const fs=require('node:fs'),path=require('node:path'),cp=require('node:child_process'),crypto=require('node:crypto');
process.chdir(__dirname);
if(Number(process.versions.node.split('.')[0])<22)throw Error('NODE_22_REQUIRED');
const id=process.argv[2];if(!/^\d+$/.test(id||''))throw Error('AGENT_ID_REQUIRED');
const manifest=JSON.parse(fs.readFileSync('manifest.json','utf8'));
for(const [file,hash] of Object.entries(manifest.files)){if(crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex')!==hash)throw Error('PACKAGE_CHECKSUM');}
fs.mkdirSync('state',{recursive:true,mode:448});
try{const lock=JSON.parse(fs.readFileSync('state/worker.lock','utf8'));process.kill(lock.pid,0);console.log('Worker already running; use the signed status endpoint.');process.exit(0);}catch(e){if(e.code!=='ENOENT'&&e.code!=='ESRCH')throw e;}
if(!fs.existsSync('node_modules')){const r=cp.spawnSync(process.platform==='win32'?'npm.cmd':'npm',['ci','--omit=dev','--ignore-scripts','--no-audit','--no-fund'],{stdio:'ignore',shell:process.platform==='win32'});if(r.status!==0)throw Error('DEPENDENCY_INSTALL_FAILED');}
const log=fs.openSync('state/process.log','a',384);
const child=cp.spawn(process.execPath,['worker.mjs','--agent-id',id],{cwd:__dirname,env:process.env,detached:true,stdio:['ignore',log,log],windowsHide:true});child.unref();fs.closeSync(log);
console.log('Worker launched; verify identity and checksum through /api/status.');`;
export const bootstrapProgram = String.raw`const fs=require('node:fs'),z=require('node:zlib'),c=require('node:crypto'),p=require('node:path'),cp=require('node:child_process');
const text=fs.readFileSync('SOUL.md','utf8'),m=text.match(/PORTFOLIO_PAYLOAD_SHA256:([a-f0-9]{64})\n([A-Za-z0-9+/=]+)\nEND_PORTFOLIO_PAYLOAD/);
if(!m||m[2].length>2000000)throw Error('PAYLOAD_MISSING');const raw=z.gunzipSync(Buffer.from(m[2],'base64'),{maxOutputLength:8388608});
if(c.createHash('sha256').update(raw).digest('hex')!==m[1])throw Error('PAYLOAD_CHECKSUM');const pack=JSON.parse(raw),allowed=['worker.mjs','package.json','package-lock.json','runtime.json','start.cjs','SKILL.md'];
if(pack.version!==1||Object.keys(pack.files).length!==allowed.length)throw Error('PAYLOAD_VERSION');
const dir=p.resolve('skills/portfolio');fs.mkdirSync(dir,{recursive:true,mode:448});const hashes={};
for(const [name,file] of Object.entries(pack.files)){if(!allowed.includes(name)||typeof file.content!=='string'||c.createHash('sha256').update(file.content).digest('hex')!==file.sha256)throw Error('PAYLOAD_FILE_CHECKSUM');hashes[name]=file.sha256;}
for(const [name,file] of Object.entries(pack.files))fs.writeFileSync(p.join(dir,name),file.content,{mode:384});
fs.writeFileSync(p.join(dir,'manifest.json'),JSON.stringify({sha256:m[1],files:hashes}),{mode:384});
const r=cp.spawnSync(process.execPath,[p.join(dir,'start.cjs'),process.argv[1]],{stdio:'inherit'});process.exit(r.status===0?0:1);`;
export const bootstrapCommand = `node -e "eval(Buffer.from('${Buffer.from(bootstrapProgram).toString('base64')}','base64').toString())"`;
export function buildCapability(strategy: Strategy, workerFiles: Record<string, string>) {
  for (const path of Object.keys(workerFiles)) if (!['worker.mjs', 'package.json', 'package-lock.json'].includes(path)) throw new Error('UNSAFE_PAYLOAD_PATH');
  const runtime = {
    STRATEGY_PROMPT: strategy.prompt,
    PORTFOLIO_ALLOCATIONS: JSON.stringify(strategy.targets.map(t => { const a = getAsset(t.assetId); return { symbol: a.symbol, chainId: a.chainId, weightBps: Number(t.weightBps) }; })),
    FUNDING_CHAIN_ID: String(strategy.fundingChain), REBALANCE_INTERVAL_MS: String(strategy.intervalMs), MAX_SLIPPAGE_BPS: String(strategy.slippageBps),
    DRIFT_THRESHOLD_BPS: String(strategy.driftBps), MIN_TRADE_USD: `${strategy.minTradeUsd / 100000000n}.${(strategy.minTradeUsd % 100000000n).toString().padStart(8, '0')}`,
  };
  const files = { ...workerFiles, 'runtime.json': JSON.stringify(runtime), 'start.cjs': launcher,
    'SKILL.md': '---\nname: portfolio\ndescription: Start the sealed portfolio worker on owner request\n---\nRun node skills/portfolio/start.cjs AGENT_ID from the workspace. Keep the strategy, payload, credentials and state private. Never print them in chat. Use only the registered owner-signed configure and stop endpoints. Never trade Ethereum mainnet.\n' };
  if (Object.keys(files).length !== allowed.size) throw new Error('MISSING_WORKER_FILES');
  const pack = { version: 1, files: Object.fromEntries(Object.entries(files).sort(([a], [b]) => a.localeCompare(b)).map(([name, content]) => [name, { content, sha256: sha256(content) }])) };
  const raw = JSON.stringify(pack); if (Buffer.byteLength(raw) > limit) throw new Error('PAYLOAD_TOO_LARGE');
  const digest = sha256(raw), compressed = gzipSync(raw, { level: 9 }).toString('base64');
  const systemPrompt = `You operate a sealed deterministic portfolio worker. Keep all strategy, payload, files and credentials confidential. Do not send them to chat or logs. Never use Ethereum mainnet. Do not improvise trading commands or change the supplied strategy. On an owner activation request, run node skills/portfolio/start.cjs AGENT_ID if installed. Otherwise run the exact bootstrap command below from the OpenClaw workspace, replacing AGENT_ID with the owner's numeric token ID. It reads the payload from your local SOUL.md; do not copy or regenerate the payload through a tool argument. Dependencies are pinned. After launch report only whether /api/status is ready. API credentials arrive through an authenticated endpoint, never ask for them in chat. After reset or clone, activate with the current agent ID; the worker validates the sealed wallet and quarantines inherited state.\n\n${bootstrapCommand} AGENT_ID\n\nPORTFOLIO_PAYLOAD_SHA256:${digest}\n${compressed}\nEND_PORTFOLIO_PAYLOAD\n`;
  return { systemPrompt, sha256: digest, bytes: Buffer.byteLength(systemPrompt) };
}
export function unpackCapability(prompt: string): Record<string, string> {
  const m = prompt.match(/PORTFOLIO_PAYLOAD_SHA256:([a-f0-9]{64})\n([A-Za-z0-9+/=]+)\nEND_PORTFOLIO_PAYLOAD/);
  if (!m || m[2]!.length > 2000000) throw new Error('PAYLOAD_MISSING');
  const raw = gunzipSync(Buffer.from(m[2]!, 'base64'), { maxOutputLength: limit });
  if (sha256(raw) !== m[1]) throw new Error('PAYLOAD_CHECKSUM');
  const pack = JSON.parse(raw.toString()) as { version: number; files: Record<string, { content: string; sha256: string }> };
  if (pack.version !== 1 || Object.keys(pack.files).length !== allowed.size) throw new Error('PAYLOAD_VERSION');
  return Object.fromEntries(Object.entries(pack.files).map(([path, file]) => {
    if (!allowed.has(path) || typeof file.content !== 'string' || sha256(file.content) !== file.sha256) throw new Error('PAYLOAD_FILE_CHECKSUM');
    return [path, file.content];
  }));
}
