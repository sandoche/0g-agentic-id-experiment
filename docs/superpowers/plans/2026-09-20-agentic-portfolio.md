# Agentic Portfolio Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Deliver a locally tested TypeScript CLI that deploys a sealed OpenClaw portfolio capability, rebalances across Robinhood and BNB through 1inch, and records attributable results.

**Architecture:** A small deterministic worker runs inside the AgenticID sealed runtime. The owner CLI handles deployment, authenticated activation, funding guidance, logs, and proofs; the worker owns portfolio arithmetic, exchange adapters, durable execution state, and a loopback HTTP service. The private strategy is read from ignored `.env`, encrypted in the INFT, and restored with the worker's skill directory.

**Tech Stack:** Node.js 22 LTS, TypeScript with strict checking, Vitest, viem, `@0gfoundation/0g-agenticid-sdk` 0.1.6, `@1inch/cross-chain-sdk` 2.2.4, dotenv, esbuild. Pin installed versions in `package-lock.json`; no database, frontend, or custom smart contracts.

**Spec:** [Approved design and subsequent user amendments](../specs/2026-09-19-agentic-portfolio-design.md).

**Status:** Tasks 1–8 implemented. Independent whole-branch review completed; regression fixes and verification are recorded in `docs/verification.md`.

## Global Constraints

- Ethereum mainnet is explicitly forbidden. Do not use it for trading, funding, bridging, or fallback routes.
- Trading networks are limited to Base, Arbitrum, Robinhood, and BNB.
- The portfolio spans Robinhood and BNB; Base is the default funding network, with Arbitrum available as an option.
- Actual weights and the real prompt must not be copied into public documentation, fixtures, logs, or source control.
- Store the real prompt and allocations in ignored `.env` variables; `.env.example` contains only sample values and a sample prompt.
- VIRTUAL and RENDER: removed at the user's request. Do not search for substitutes.
- Enclave-hosted model inference is mandatory: use the `private` trust tier on every request, with no TeeTLS or Standard fallback.
- The assistant must not inspect or display the user's private keys. Do not read the entire local `.env` for debugging.
- Use integer token units and fixed-point USD values, never floating-point token amounts.
- Receiver is always the agent's own address.
- A cycle cannot overlap another, and unresolved orders prevent duplicate spending.
- The agent wallet signs through the SDK's `sealAccount()` adapter and `SEAL_SIGN_SOCK`. No agent private key is exported.
- Use Superpowers TDD: a failing behavior test precedes each implementation.
- Commit and push after each verified milestone, as requested by the user.
- Live minting, funded execution, and real TEE proof retrieval cannot be reported as tested until credentials and funds are supplied.

## Review Focus

1. Chain-wide RPC failure must suspend the entire valuation; it must not turn missing balances into zero and trigger buys (Tasks 2 and 3).
2. A transaction or order accepted just before a lost response must survive restart without a second spend (Tasks 4 and 5).
3. An NFT transfer during a cycle must prevent subsequent signing by the old configured owner; a clone must not resume another wallet's orders (Tasks 4 and 6).
4. Bootstrap size, interrupted dependency installation, and repeated activation must not produce a minted-but-nonfunctional success message (Task 7).
5. A valid signature over a different response is not proof of the displayed result; persisted raw response bytes must match the task hash (Task 8).

## Boundaries and Files

| Files | Responsibility |
| --- | --- |
| `src/config.ts`, `src/types.ts`, `src/assets.ts` | Typed configuration, allowed chains, verified asset registry; no live credentials in registry |
| `src/portfolio.ts` | Pure valuation and next-action selection across chains |
| `src/market.ts`, `src/rpc.ts` | Bounded HTTP requests, stock metadata, prices, chain and balance reads |
| `src/state.ts`, `src/log.ts` | Atomic journal, process lock, redacted JSONL and terminal events |
| `src/swap.ts`, `src/fusion.ts` | Same-chain transaction validation and Fusion+ order lifecycle |
| `src/worker.ts`, `src/server.ts`, `src/auth.ts` | Five-minute scheduler, owner checks, bounded service endpoints |
| `src/bootstrap.ts`, `src/agent.ts` | Encrypted capability packaging, mint/resume, OpenClaw activation |
| `src/proof.ts`, `src/cli.ts` | Proof capture/verification and owner commands |
| `tests/*.test.ts`, `tests/fixtures.ts` | Synthetic tests; never load the user's `.env` |
| `scripts/build.ts` | Portable CLI build and worker payload generation |
| `.env.example`, `.gitignore`, `README.md` | Example configuration, private-file exclusions, easy setup |

Use one CLI and one worker entry point. External packages remain normal dependencies; do not reimplement cryptography, EVM transaction serialization, SDK order formats, or SDK proof signatures.

## Task 1: Validated Configuration and Asset Registry

**Files:** Create `package.json`, `package-lock.json`, `tsconfig.json`, `vitest.config.ts`, `.nvmrc`, `src/types.ts`, `src/config.ts`, `src/assets.ts`, `tests/config.test.ts`. Preserve existing `.env`; modify `.env.example` only when a documented setting is necessary.

**Interfaces:**

```ts
export type TradingChain = 56 | 4663 | 8453 | 42161;
export type Address = `0x${string}`;
export type Asset = {
  id: string; symbol: string; chainId: TradingChain; address: Address;
  decimals: number; kind: 'position' | 'cash'; source: string;
};
export type Target = { assetId: string; weightBps: bigint };
export type Strategy = {
  prompt: string; targets: Target[]; fundingChain: 8453 | 42161;
  intervalMs: number; slippageBps: bigint; driftBps: bigint;
  minTradeUsd: bigint; // USD scaled by 10^8
};
export type Config = {
  strategy: Strategy; mode: 'simulation' | 'live';
  rpcUrls: Record<TradingChain, string>; attestorUrl: string; model: string;
  credentials: { oneinch?: string; inference?: string; ownerKey?: Address };
};
export function readConfig(env: Record<string, string | undefined>): Config;
export function requireTradingChain(chainId: number): TradingChain;
export function parseUsd(value: string): bigint;
export const assets: readonly Asset[];
```

- [ ] Create the toolchain with Node 22, ESM, strict TypeScript, `noUncheckedIndexedAccess`, and scripts `test`, `typecheck`, `build`, and `agent`. Use `npm test -- --run` for non-watch tests. Pin the SDK versions above; verify their published type signatures rather than assuming GitHub main equals the package. Use the local bundled Node runtime or install a verified official Node 22 runtime if PATH still resolves Node 18.
- [ ] Write configuration behavior tests before `readConfig` exists. This sample uses only invented weights:

```ts
import { expect, test } from 'vitest';
import { readConfig, requireTradingChain, parseUsd } from '../src/config.js';

const input = {
  STRATEGY_PROMPT: 'Synthetic allocation test.', FUNDING_CHAIN_ID: '42161',
  PORTFOLIO_ALLOCATIONS: JSON.stringify([
    { symbol: 'TAO', chainId: 4663, weightBps: 6000 },
    { symbol: '0G', chainId: 56, weightBps: 4000 },
  ]),
};
test('uses private input without requiring credentials for simulation', () => {
  const config = readConfig(input);
  expect(config.mode).toBe('simulation');
  expect(config.strategy.fundingChain).toBe(42161);
  expect(config.strategy.targets.map(t => t.weightBps)).toEqual([6000n, 4000n]);
});
test('rejects forbidden networks and nondecimal money', () => {
  expect(() => requireTradingChain(1)).toThrow('CHAIN_NOT_ALLOWED');
  expect(() => readConfig({ ...input, FUNDING_CHAIN_ID: '1' })).toThrow();
  expect(() => parseUsd('1e3')).toThrow();
  expect(parseUsd('5.25')).toBe(525000000n);
});
```

- [ ] Run `npm test -- --run tests/config.test.ts`; confirm failure from the missing behavior, then implement parsing. Reject duplicate assets, unknown symbols/contracts, negative/fractional weights, weights not totaling 10000, empty prompts, nonpositive interval/trade thresholds, malformed keys, and slippage outside 1–500 bps. Parse decimal strings by splitting the decimal point and padding, never `Number(value) * scale`. Require the interval to remain 300000 ms for the user-facing configuration; tests inject their clock instead of changing the strategy.
- [ ] Populate `assets` from the design sources, using lowercase addresses as identifiers `${chainId}:${address}`. Confirm stock addresses against `https://api.robinhood.com/rhj/assets`; store issuer provenance. TAO on 4663 is `0xf3081494b87e8d5fb7960f066e931d1d0e6e3d67`; 0G on 56 is `0x4b948d64de1f71fcd12fb586f4c776421a35b3ee`; FET on 56 is `0x031b41e504677879370e9dbcf937283a8691fa7f`. Each has 18 decimals. Include native Base/Arbitrum USDC, Robinhood USDG, and Binance-Peg USDT on BNB; label the latter as pegged, not native USDC. Verify BNB settlement contract provenance and on-chain metadata before enabling it.
- [ ] Add rejection tests for every parsing rule, a test that removed assets are rejected, and a test that exception messages never include supplied secret values. Default `INFERENCE_MODEL` to `glm-5.3`. Keep selective environment loading in the CLI only; library tests receive literal objects. Read-only commands do not load `OWNER_PRIVATE_KEY`. Preserve the user's populated `.env` and never output it or inspect key values. Run targeted tests and typecheck, then commit and push `feat: validate private portfolio configuration and allowed assets`.

## Task 2: Pure Multi-Chain Allocation Engine

**Files:** Create `src/portfolio.ts`, `tests/portfolio.test.ts`; extend `src/types.ts`.

**Interfaces:**

```ts
export type Holding = {
  asset: Asset; units: bigint; priceUsd: bigint; observedAt: number;
};
export type Snapshot = { holdings: Holding[]; now: number; complete: boolean };
export type Action =
  | { kind: 'swap'; from: Asset; to: Asset; amount: bigint }
  | { kind: 'transfer'; from: Asset; to: Asset; amount: bigint }
  | { kind: 'idle'; reason: string };
export function holdingValue(holding: Holding): bigint;
export function nextAction(strategy: Strategy, snapshot: Snapshot): Action;
```

- [ ] Write arithmetic tests and confirm they fail before implementation:

```ts
import { expect, test } from 'vitest';
import { holdingValue } from '../src/portfolio.js';
import type { Asset } from '../src/types.js';
const token: Asset = {
  id: 'sample', symbol: 'SAMPLE', chainId: 56,
  address: '0x0000000000000000000000000000000000000001',
  decimals: 18, kind: 'position', source: 'test fixture',
};
test('keeps amounts beyond Number precision exact', () => {
  expect(holdingValue({ asset: token, units: 9007199254740993000n,
    priceUsd: 123456789n, observedAt: 1 }))
    .toBe(9007199254740993000n * 123456789n / 10n ** 18n);
});
```

- [ ] Implement valuation with `units * priceUsd / 10n ** BigInt(decimals)`. Reject negative amounts, zero/negative prices, stale observations older than 60 seconds, missing configured assets or cash tokens, and incomplete snapshots. Do not include native gas tokens in `holdings`.
- [ ] Add concrete `nextAction` fixtures: synthetic 60/40 targets on different chains, $1000 total with $800/$200 positions selects the first overweight sale; $600/$400 returns idle; $1000 funding cash selects a cash transfer; cash already on the correct chain selects a local purchase. Test 6-decimal USDC, 18-decimal settlement assets, stablecoin prices other than $1, added deposits, rounding dust, minimum trade thresholds, and missing BNB data causing an error instead of a purchase.
- [ ] Implement one action at a time: compute global target values by basis points; sell largest eligible overweight position into its chain's cash token; then transfer surplus cash to the largest underfunded chain; then buy its largest deficit. Preserve enough local cash for that chain's own deficits before exporting cash. Sort ties by asset ID for deterministic tests. Limit trade size by available units and local cash; round down. The worker refreshes the entire snapshot after each settled action. No speculative execution plan with stale balance assumptions.
- [ ] Use this implementation core and test its boundaries:

```ts
const targetUsd = totalUsd * target.weightBps / 10000n;
const deltaUsd = targetUsd - currentUsd;
const driftBps = totalUsd === 0n ? 0n :
  (deltaUsd < 0n ? -deltaUsd : deltaUsd) * 10000n / totalUsd;
const units = spendUsd * 10n ** BigInt(asset.decimals) / priceUsd;
```

- [ ] Run `npm test -- --run tests/portfolio.test.ts` and typecheck. Commit and push `feat: calculate portfolio allocations across chains`.

## Task 3: Read-Only Market Preflight and Valuation

**Files:** Create `src/rpc.ts`, `src/market.ts`, `tests/market.test.ts`; extend `src/types.ts`.

**Interfaces:**

```ts
export type Market = {
  preflight(): Promise<void>;
  snapshot(wallet: Address): Promise<Snapshot>;
  tradable(asset: Asset): Promise<boolean>;
};
export function createMarket(config: Config, fetcher?: typeof fetch): Market;
export function requestJson<T>(url: URL, init: RequestInit,
  fetcher?: typeof fetch): Promise<T>;
```

- [ ] Write a failing retry test with real `Response` objects:

```ts
import { expect, test, vi } from 'vitest';
import { requestJson } from '../src/market.js';
test('does not turn an authorization error into empty market data', async () => {
  const fetcher = vi.fn<typeof fetch>().mockResolvedValue(
    new Response('{"error":"unauthorized"}', { status: 401 }));
  await expect(requestJson(new URL('https://api.1inch.com/test'), {}, fetcher))
    .rejects.toThrow('HTTP_401');
  expect(fetcher).toHaveBeenCalledTimes(1);
});
```

- [ ] Implement GET-only retries: maximum three attempts, 10-second timeout per attempt, exponential 250/500 ms backoff or bounded `Retry-After`, honor cancellation; never retry writes through this helper. Reject cross-origin redirects for credential-bearing requests. Log status codes and sanitized host/path only, never authorization headers or raw server bodies.
- [ ] Implement viem public clients for the four allowed chains. Preflight calls `getChainId`, `getBytecode`, ERC-20 `decimals` and `symbol`; exact contract identity comes from the curated registry, never ticker search results. A configured RPC reporting chain 1 fails before any signing. Query the Robinhood live registry and halt/trading-capability metadata; missing mandatory stock deployments are errors. Return a skip when a market is closed or a route is temporarily unavailable, not a changed strategy.
- [ ] Use 1inch's documented Spot Price API for USD prices per exact token address and validate complete positive numeric results. Robinhood stock quotes may be used only with their `currentMultiplier` applied exactly; raw underlying share prices are not token prices. Record fetch time and reject stale vendor timestamps. Do not silently assume settlement assets are worth $1.
- [ ] Add tests for 429 followed by success, bounded 503 failures, malformed JSON, missing token price, RPC chain mismatch, missing bytecode, decimals mismatch, stock trading halt, stock multiplier adjustment, and an RPC failure on one portfolio chain. Use an HTTP stub/injected fetch, never credentials or the live wallet.
- [ ] Run market tests and typecheck. With supplied API keys, run read-only preflight and quote probes only; these do not authorize funded orders. Commit and push `feat: verify portfolio assets and read market data`.

## Task 4: Durable Journal, Safe Logging, and Same-Chain Execution

**Files:** Create `src/state.ts`, `src/log.ts`, `src/swap.ts`, `tests/state.test.ts`, `tests/swap.test.ts`, `tests/log.test.ts`; extend `src/types.ts`.

**Interfaces:**

```ts
export type Journal = {
  wallet: Address; owner: Address; sequence: number;
  pending?: { kind: 'transaction' | 'fusion'; id: string; payload: unknown };
};
export type Store = { load(): Promise<Journal>; save(value: Journal): Promise<void> };
export function createStore(directory: string, wallet: Address): Store;
export type Event = { type: string; time: number; cycleId?: string;
  chainId?: TradingChain; txHash?: string; orderHash?: string; code?: string };
export function emitEvent(event: Event): void;
export type ExecutionResult = 'settled' | 'pending' | 'skipped';
export type Execution = {
  execute(action: Exclude<Action, {kind: 'idle'}>): Promise<ExecutionResult>;
  reconcile(): Promise<ExecutionResult>;
};
```

- [ ] Write filesystem tests using temporary directories: atomic save/load, corrupt JSON halts execution, wallet mismatch quarantines inherited state without replay, and two processes cannot hold the same wallet lock. Write log tests that pass secret-like extras and assert none reach disk or stdout. Confirm failures before implementation.
- [ ] Implement versioned JSON with decimal strings for bigint fields; write a temporary sibling with mode `0600`, flush, then atomically rename. Acquire an exclusive lock file; verify stale PID/process ownership before recovery. Keep local CLI state under `.local/`; sealed runtime journal lives under `workspace/skills/portfolio/state/`. Never print journal payloads.
- [ ] Implement a strict event allowlist so arbitrary error/request/config objects cannot be logged. Emit matching JSONL file and concise terminal event; generate explorer URLs from the allowed chain registry, not API response URLs.
- [ ] Write transaction validation tests before implementation. Build a legitimate encoded AggregationRouter `swap` test using the published ABI, then mutate the receiver, chain ID, source amount, spender, destination token, and minimum output independently. Each mutation must fail before the fake signer is called. Also test an unrecognized selector and a nonzero native value on an ERC-20 swap.
- [ ] Fetch Classic Swap v6.1 quote and swap transaction, requesting supported generic router calldata (`disableEstimate` is not a substitute for validation; use documented routing flags to avoid unsupported optimized selectors). Decode ABI and accept only reviewed selectors. Verify pinned router code/address per chain, verified approval spender, from/receiver equal to agent, input token/amount, output token, minimum output consistent with configured slippage, zero extra native value, and no permit/unsafe flags. Reject unsupported calldata with a clear skip/error rather than signing it.
- [ ] Approve only the exact required amount, using zero-reset when needed; confirm receipt before swap. Check owner and balances again immediately before signing. Build/sign each transaction once, persist the signed transaction and deterministic hash before broadcast, and wait/reconcile by hash after timeouts. Re-broadcasting identical bytes is allowed; creating a second transaction for uncertain status is not. Require successful receipts and fresh balances before returning `settled`.
- [ ] Test revert, approval failure, insufficient native gas, nonce conflict, broadcast timeout after acceptance, restart recovery, and logging redaction. Run all tests through Task 4 and typecheck, then commit and push `feat: journal and validate same-chain portfolio swaps`.

## Task 5: Fusion+ Transfers and Recovery

**Files:** Create `src/fusion.ts`, `tests/fusion.test.ts`; reuse state and execution contracts.

**Interfaces:** `createFusionExecution` returns `Execution`. Its inputs are `Config`, a viem `Account`, `Store`, current-owner reader, and chain-scoped public clients. Production uses `sealAccount()`; tests use an isolated deterministic test key and local fixtures only.

- [ ] Write failing lifecycle tests for persisted-before-submit state, unknown submission result, partial fills, wrong secret index, missing destination escrow, mismatched receiver/chain/token/amount, expired timelocks, and restart. Assert secrets are never submitted before the paired escrow checks pass.
- [ ] Implement the SDK's provider connector using the viem account's `signTypedData`; no `PrivateKeyProviderConnector` in the worker. Validate the typed-data domain chain, limit-order contract, maker, assets, amounts, expiry, hashlock, and receiver against the prepared intent before requesting a signature. Use only allowlisted chain pairs, with no intermediate Ethereum route.
- [ ] Follow the published SDK split creation/submission flow so order identity exists before network writes:

```ts
const quote = await sdk.getQuote({ srcChainId, dstChainId,
  srcTokenAddress, dstTokenAddress, amount: amount.toString(),
  walletAddress: account.address, enableEstimate: true });
const preset = quote.recommendedPreset;
const secrets = Array.from({ length: quote.presets[preset].secretsCount },
  () => `0x${randomBytes(32).toString('hex')}`);
const secretHashes = secrets.map(secret => HashLock.hashSecret(secret));
const hashLock = secrets.length === 1
  ? HashLock.forSingleFill(secrets[0]!)
  : HashLock.forMultipleFills(HashLock.getMerkleLeaves(secrets));
const prepared = sdk.createOrder(quote, {
  walletAddress: account.address, preset, hashLock, secretHashes,
});
// Persist hash, serializable SDK order, quoteId, secrets, intended pair,
// maker, owner, and reserved amount atomically before submitOrder.
await sdk.submitOrder(quote.srcChainId, prepared.order,
  prepared.quoteId, secretHashes);
```

The comment specifies journal fields, not permission to omit persistence. Reject zero/excessive `secretsCount` and use cryptographically random secrets. Reconstruct SDK objects using the installed package's serializer/constructor, with a round-trip fixture test before relying on recovery.

- [ ] Poll `getOrderStatus` and `getReadyToAcceptSecretFills` with bounded intervals. Use SDK escrow immutables/factory utilities and RPC receipts/code/balances to verify the source and destination escrows, exact secret hash, fill index/amount, maker/recipient, token, chain, confirmations, and remaining timelocks. Only then call `submitSecret` for that fill. API readiness alone is insufficient. Persist disclosure status; do not log secrets.
- [ ] Model prepared, submission-unknown, pending, partially-filled, executed, expired, cancelled, and refunded outcomes. Expired is not refunded: keep funds reserved until on-chain reconciliation confirms their state. Implement SDK cancellation call data and permitted escrow recovery transactions when their conditions hold; never treat absence from the API as proof an order never existed. Limit automatic retries to reads and idempotent same-order actions.
- [ ] Enforce at most one unresolved transfer for the experiment; while it exists the worker only reconciles and reports status. Rebuild the global snapshot after settlement; never include both escrowed source funds and credited destination funds as spendable cash.
- [ ] Run Fusion+ tests, existing execution tests, and typecheck; commit and push `feat: transfer portfolio cash with recoverable Fusion orders`.

## Task 6: Owner-Controlled Worker and Scheduler

**Files:** Create `src/worker.ts`, `src/auth.ts`, `src/server.ts`, `tests/worker.test.ts`, `tests/auth.test.ts`, `tests/server.test.ts`.

**Interfaces:**

```ts
export type Worker = {
  tick(): Promise<void>; stop(): Promise<void>;
  status(): { mode: string; state: string; lastCycleId?: string; pendingId?: string };
};
export function createWorker(strategy: Strategy, market: Market,
  execution: Execution, store: Store, readOwner: () => Promise<Address>): Worker;
export function configureOwner(body: unknown): Promise<void>;
export function startServer(worker: Worker): Promise<{ port: number; close(): Promise<void> }>;
```

- [ ] Use controlled-clock tests to prove a 300000 ms schedule, no overlapping cycles, pending reconciliation before new action, refreshed snapshots between actions, and stop preventing later actions. A rejected price read or transfer must produce an event, not terminate the scheduler permanently or trigger immediate unbounded retries.
- [ ] Implement each tick under an in-process busy guard plus the journal's process lock. Check configured owner on-chain at cycle start and immediately before each approval/order/transaction signature. Owner lookup failure pauses signing. On owner change erase in-memory API keys, pause trading, and require fresh owner configuration; allow only already-authorized recovery steps that protect outstanding funds and are demonstrably safe, otherwise expose pending state for the new owner.
- [ ] Bind HTTP to `127.0.0.1` only. Expose exact endpoints `GET /api/status`, `GET /api/events?after=<sequence>`, `GET /api/challenge`, `POST /api/configure`, and `POST /api/stop`. Public responses contain only allowed status/event fields; never targets, prompts, secrets, raw calldata, or configuration. Enforce bounded bodies, bounded event pagination, method checks, and reject unknown fields.
- [ ] Authenticate configure/stop through a current-owner EIP-191 signature over a fixed canonical message containing action, agent ID, seal address, runtime instance ID, fresh challenge nonce, issue/expiry time, and SHA-256 of the exact JSON payload. A challenge expires in 60 seconds and is consumed once. Include the credential payload in the signed hash but never in the challenge response. Require HTTPS on the CLI-to-agent connection. Keys remain memory-only; no arbitrary URL, code, destination, token, or strategy mutation endpoint.
- [ ] Add tests for replay, expired/future timestamp, wrong agent, wrong owner, altered body, old runtime nonce, owner transfer between challenge and submission, body overflow, unknown routes, and configure failure with no secret echo.
- [ ] Register the exact endpoints using Node HTTP over `SEAL_SIGN_SOCK`, `POST /services`, with each backend `http://127.0.0.1:<port>` and no backend path. Re-register after restart. Tests use a real local HTTP server and a temporary mock Unix socket where supported; Windows tests exercise the injected socket transport and Linux CI exercises the real Unix path.
- [ ] Simulation uses the same engine and a labeled paper ledger, with no signing or network writes. Native gas remains outside it. Run worker/auth/server tests and typecheck; commit and push `feat: run owner-controlled sealed portfolio worker`.

## Task 7: Encrypted Capability, Minting, and Activation

**Files:** Create `src/bootstrap.ts`, `src/agent.ts`, `scripts/build.ts`, `tests/bootstrap.test.ts`, `tests/agent.test.ts`; update package scripts.

**Interfaces:**

```ts
export type Capability = { systemPrompt: string; sha256: string; bytes: number };
export function buildCapability(strategy: Strategy, workerFiles: Record<string, string>): Capability;
export function mintOrResume(config: Config): Promise<{ agentId: bigint; sealId: string; url: string }>;
export function activate(config: Config, agentId: bigint): Promise<void>;
```

- [ ] Write packaging tests before implementation: payload round-trip, checksum corruption rejected, path traversal rejected, secrets not included, and bootstrap re-run does not duplicate a worker. Test a synthetic prompt only. The bundle test must build and start the real worker entry point against fixtures; testing a string constant is insufficient.
- [ ] Package compiled generic worker source, exact production dependency manifest/lock, and private strategy into a deterministic compressed payload. Put it inside the encrypted persona, with concise OpenClaw instructions to extract from its local `SOUL.md` using a deterministic Node bootstrap, never reproduce payload or strategy in chat. Keep dependencies external to the compiled worker when bundling them would exceed model context; install pinned production dependencies with `npm ci --omit=dev --ignore-scripts` inside the sealed skill directory. Network/install failures leave an explicit not-ready state.
- [ ] Validate decompressed size, file allowlist, per-file checksum, final package checksum, runtime Node version, and the selected model's context capacity before minting. Reject oversized payloads with a clear diagnosis; do not silently truncate. Keep payload and strategy files only in ignored local build state and `workspace/skills/portfolio/` inside the sealed runtime. The build must not inline the local `.env` into generic public artifacts.
- [ ] Test the first OpenClaw inference against a local HTTP fixture using synthetic credentials. Assert `X-0G-Provider-Trust-Mode: private`, the configured model, and no retries to another host or weaker trust tier. Check the live catalog for `verifiability: TeeML` and tool calling before minting. Fail if unavailable; do not silently choose a replacement. Test restored/reset configuration retains the header.
- [ ] Initialize SDK from the attestor and construct explicit iData. The `openai` provider label below selects the API dialect, while the endpoint is fixed to 0G. This avoids the sealed adapter's `0g-compute` augmentation overwriting custom headers:

```ts
const ag = await AgenticID.fromAttestor(config.attestorUrl,
  { account: config.credentials.ownerKey });
const openclawConfig = {
  agents: { defaults: { model: { primary: `openai/${config.model}` } } },
  models: { providers: { openai: {
    baseUrl: 'https://router-api.0g.ai/v1', api: 'openai-completions',
    apiKey: { source: 'env', provider: 'default', id: 'OPENAI_API_KEY' },
    headers: { 'X-0G-Provider-Trust-Mode': 'private' },
    models: [{ id: config.model, name: config.model, reasoning: true,
      input: ['text'], contextWindow: 1179648, maxTokens: 32768,
      compat: { requiresStringContent: true, supportsStore: false,
        supportsDeveloperRole: false, supportsReasoningEffort: false,
        supportsUsageInStreaming: false, supportsStrictMode: false,
        maxTokensField: 'max_tokens' } }],
  } } },
};
const iData = [
  { role: 'framework', plaintext: { name: 'openclaw', schema_version: 1 }, extra: {} },
  { role: 'openclaw.json', plaintext: openclawConfig, extra: {} },
  { role: 'persona', plaintext: { system_prompt: capability.systemPrompt,
    inference: { provider: 'openai', model: config.model } }, extra: {} },
];
const accepted = await ag.agent.deploy({ name: 'Portfolio experiment',
  description: 'Sealed multi-chain portfolio worker', framework: 'openclaw',
  iData, sandbox: { apiKey: config.credentials.inference }, idempotencyKey });
```

`idempotencyKey` belongs in the deployment parameters, as shown. Persist it before submission, and `sealId`/agent wallet immediately after acceptance. Poll the same deployment to minted/running; use the SDK retry path on a failed existing deployment. Never create a new identity after an uncertain response. Verify this configuration against the OpenClaw version advertised by the sealed image, including context/output limits and environment-secret support.

- [ ] Preflight protocol acknowledgments, sandbox minimum balance, selected model, supported `openclaw` image, and owner 0G balance. Display required funding actions with SDK cost estimates; do not automatically deposit arbitrary amounts. Activate using the owner-capable `ag.agent.client(agentId)` chat, then poll `/api/status` for the expected payload checksum, wallet/agent identity and readiness. Bootstrap makes the worker locally persistent; fresh activation after reset reconstructs and starts it. Configure the owner API key through the signed endpoint, not chat/persona.
- [ ] Test mint accepted/minted/running distinctions, lost response idempotency, failure recovery, two activations, reset without local strategy variables, and clone with new wallet and cleared inherited pending state. Do not claim an actual transfer/clone succeeds solely from fixtures; leave that in the credential-dependent report.
- [ ] Run build, bootstrap/agent tests, all prior tests, and typecheck. Commit and push `feat: mint and activate encrypted OpenClaw capability`.

## Task 8: Owner CLI, Proofs, Documentation, and Final Verification

**Files:** Create `src/proof.ts`, `src/cli.ts`, `tests/proof.test.ts`, `tests/cli.test.ts`, `tests/integration.test.ts`, `.github/workflows/verify.yml`; update `README.md` and `.env.example` only as needed.

**Interfaces:**

```ts
export type Transcript = {
  method: string; requestUri: string; requestBody: Uint8Array;
  responseBody: Uint8Array; status: number;
};
export function transcriptHash(value: Transcript): `0x${string}`;
export function captureStatus(config: Config, agentId: bigint): Promise<string>;
export function runCli(args: string[], env: Record<string, string | undefined>): Promise<number>;
```

- [ ] Write a proof test that changes one response byte and must change the task hash. Implement the current sealed proxy's exact construction:

```ts
import { concat, keccak256, toBytes } from 'viem';
export function transcriptHash(t: Transcript) {
  return keccak256(concat([
    toBytes(t.method), toBytes(t.requestUri),
    toBytes(keccak256(t.requestBody)), toBytes(keccak256(t.responseBody)),
    toBytes(String(t.status)),
  ]));
}
```

- [ ] Use `agent.fetchWithProof('/api/status')` and consume exact raw response bytes before JSON parsing. Verify `ag.reputation.verifyProof(proof)` result `ok`, expected agent ID/seal, current data/framework binding, expiry, submitter if set, and the transcript hash. Persist the request metadata, raw response bytes, parsed response, proof, verification result, and timestamp under ignored `proofs/`; print a local file link plus explorer links. Never present a missing, expired, mismatched, or mock proof as verified. Test all of those cases.
- [ ] Implement these commands with Node's `parseArgs`; all failures return nonzero and sanitized actionable errors:

```text
npm run agent -- check [--online]
npm run agent -- models
npm run agent -- simulate [--once]
npm run agent -- deploy
npm run agent -- activate --agent <id> [--live]
npm run agent -- status --agent <id>
npm run agent -- watch --agent <id>
npm run agent -- verify-proof --file <path>
npm run agent -- fund --agent <id>
npm run agent -- topup-sandbox --amount <OG>
npm run agent -- topup-agent --agent <id> --amount <OG>
npm run agent -- stop --agent <id>
```

`check` without `--online` is offline. `--online` does read-only protocol/market/route probes. `simulate` does not need wallet/API keys. `activate --live` must be explicit and pass protocol, owner, market, route, and gas checks; merely inserting keys into `.env` does not start funded trading. Top-ups are exact user-requested amounts and display the chain and resulting transaction. `fund` only prints chain-specific addresses, token contracts, and funding instructions. Do not implement automatic bridge-to-Ethereum fallbacks.

- [ ] Write CLI tests that spawn the built entry point with synthetic environment and temporary directories. Verify missing config guidance, offline simulation exits successfully without keys, unknown commands fail, existing `.env` is never overwritten, live mode cannot be accidentally enabled, and `watch` handles Ctrl+C. Run an integration fixture with the real worker HTTP server, scheduler, SDK adapter seams, two-chain paper ledger, and proof verifier. A mock sealed service must be visibly labeled.
- [ ] Write an emoji README with a short first-run path: Node 22, `npm ci`, preserve/copy `.env`, `npm test -- --run`, offline simulation, add `ONEINCH_API_KEY` and `AGENT_API_KEY`, use default `glm-5.3`, set the inference key's Trust Mode to Private, online check, 0G owner faucet and sandbox deposit, deploy, separate agent evolution gas, investment funding, activate, watch, stop. Link the 0G inference key page and 1inch Business Portal. Explain Base/Arbitrum funding, Robinhood ETH gas, BNB gas, direct local cash funding, exchange withdrawal, and permitted manual bridge options. Distinguish 0G testnet funding from investment 0G on BNB. Keep existing APM setup documented.
- [ ] Describe limits in ordinary language: mainnet investments cost real money; issuer/market restrictions affect stock routes; 1inch quotes require authenticated availability checks; stored encryption is not a prompt nondisclosure guarantee; public trades reveal holdings; private routing requires sealed model execution but does not alone prove end-to-end transport privacy; proofs establish attribution, not investment correctness. Do not promise gasless execution.
- [ ] Add CI on Node 22 for Windows and Linux, with no real credentials: `npm ci`, `npm run typecheck`, `npm test -- --run`, `npm run build`, synthetic CLI simulation. Ensure runtime state, `.env`, logs and proofs remain ignored. Audit tracked files and staged changes for actual allocation/prompt values using a local comparison that reports only filenames/pass-fail, not secret text.
- [ ] Run the full verification once after the final changes. Record offline, read-only live, and funded/credential-dependent results separately in `docs/verification.md`. Run `git diff --check`, inspect the final diff, then obtain the chosen workflow's code review and address material findings. Commit and push `feat: add portfolio CLI proofs and testing guide`.

## Completion Evidence

The implementation is ready for the user's funded experiment when strict typecheck, behavioral tests, production build, and offline end-to-end CLI flow pass; private values remain untracked; and the README reproduces those commands. Read-only live checks must state which assets and routes were actually checked. Funded minting, transfer/clone, live rebalances, and real proof capture require their own evidence and must remain explicitly unverified until executed with the required credentials and funds.

The user's early API-key entry permits configuration and read-only checks. It is not a reason to start unattended funded trading before the implementation is reviewed and the explicit live command is selected.

## Self-Review

- Spec sections map to Tasks 1–8: configuration/networks (1–3), trading/recovery (2–5), privacy/ownership/runtime (4, 6–7), protocol lifecycle (7), proofs/CLI/funding/docs (8).
- Each task has a failing-test step, a bounded implementation, a verification command, and a commit/push milestone.
- Shared public types are defined above; adapters implement the same `Execution` contract.
- Review Focus conditions have owning tests and no real weights or prompt are present in this plan.
- Exact SDK type compatibility and live route/escrow data are checked during implementation and preflight; they are not assumed from example snippets.
