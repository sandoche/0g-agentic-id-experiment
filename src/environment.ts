import { createReadStream } from 'node:fs';
import { createInterface } from 'node:readline';
import { parse } from 'dotenv';
const names = new Set(['ONEINCH_API_KEY', 'AGENT_API_KEY', 'OWNER_PRIVATE_KEY', 'AGENTIC_ATTESTOR_URL', 'INFERENCE_MODEL', 'TRADING_MODE',
  'REBALANCE_INTERVAL_MS', 'MAX_SLIPPAGE_BPS', 'DRIFT_THRESHOLD_BPS', 'MIN_TRADE_USD', 'FUNDING_CHAIN_ID', 'BASE_RPC_URL', 'ARBITRUM_RPC_URL',
  'ROBINHOOD_RPC_URL', 'BNB_RPC_URL', 'PORTFOLIO_ALLOCATIONS', 'STRATEGY_PROMPT']);
export async function loadEnvironment(path: string, owner: boolean): Promise<Record<string, string | undefined>> {
  const result: Record<string, string | undefined> = {};
  for (const name of names) if ((owner || name !== 'OWNER_PRIVATE_KEY') && process.env[name] !== undefined) result[name] = process.env[name];
  const stream = createReadStream(path), lines = createInterface({ input: stream, crlfDelay: Infinity });
  try {
    for await (const line of lines) {
      const key = line.match(/^\s*(?:export\s+)?([A-Z_]+)\s*=/)?.[1];
      if (!key || !names.has(key) || (!owner && key === 'OWNER_PRIVATE_KEY') || result[key] !== undefined) continue;
      result[key] = parse(line)[key];
    }
  } catch (e) { if ((e as NodeJS.ErrnoException).code !== 'ENOENT') throw new Error('ENV_READ_FAILED'); }
  finally { lines.close(); stream.destroy(); }
  return result;
}
