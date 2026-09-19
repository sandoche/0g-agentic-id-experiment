# Agentic portfolio experiment — proposed design

Status: proposed for user review. Implementation has not started.

## Intended result

A small TypeScript CLI mints an AgenticID INFT, starts its sealed OpenClaw
runtime, and initializes a portfolio worker inside that runtime. The worker
invests the agent wallet's funded balance using 1inch and checks the portfolio
every five minutes. The strategy and executable capability travel with the
encrypted INFT, including after supported reset, transfer, and clone operations.

The exact seven assets and percentage weights come from the user's private
objective. They must not be copied into public documentation, fixtures, logs,
or source control. There is no fixed dollar budget. Store the real prompt and
allocations in ignored `.env` variables; `.env.example` contains only sample
values and a sample prompt. Use synthetic allocations in tests.

The deliverable includes offline tests and a runnable integration path, an
emoji README with short copy/paste steps, `.env.example`, and an ignored `.env`
with empty credentials. The user will provide keys after local verification.
Live minting, funded execution, and real TEE proof retrieval cannot be reported
as tested until credentials and funds are supplied.

## Network choices

The user explicitly selected Robinhood Chain for stock tokens and allowed the
implementation to select the easiest initial funding chain.

- Identity, minting, sandbox deposits, and evolution gas: the chain advertised
  by the AgenticID attestor, currently 0G Galileo testnet (16602).
- Initial investment balance: native USDC on Base (8453).
- Five stock exposures: canonical Robinhood stock tokens on Robinhood Chain
  (4663), with addresses verified against Robinhood's official asset registry.
- VIRTUAL: official Robinhood token, verified against issuer documentation and
  the live chain. FET is omitted: no official Base/Robinhood deployment was
  verified, and the user authorizes omitting unavailable crypto positions.
- Portfolio settlement cash: USDG on Robinhood. Convert incoming Base USDC to
  Robinhood USDG through 1inch before investing; rebalance locally on Robinhood.
- Ethereum mainnet is explicitly forbidden. Do not use it for trading, funding,
  bridging, or fallback routes. Trading networks are limited to Base and Robinhood.

Resolve crypto token addresses from issuer
sources and require matching chain, deployed bytecode, and decimals before
enabling a route. Omit FET during initial strategy preparation and proportionally
normalize the remaining requested weights to 100%; report this adjustment
explicitly. Never
substitute another asset. Once minted, a temporarily unavailable route must
skip the trade without changing that frozen strategy. Missing stock tokens
remain an error. Live route availability requires the user's 1inch API key.

## Chosen approach and alternatives

Recommended: OpenClaw installs and supervises a small deterministic worker;
the worker computes allocations and executes 1inch transactions. This keeps
money arithmetic testable and avoids paying for an LLM decision every cycle.

An LLM-only cron agent is smaller initially but harder to verify for repeatable
allocation math, partial fills, and recovery. A custom sealed image would allow
deterministic startup directly, but requires additional image registration and
attestation infrastructure. Neither is necessary for this experiment.

## Deployment and secret handling

Use `@0gfoundation/0g-agenticid-sdk` with `AgenticID.fromAttestor()` and
`framework: openclaw`. Read model choices from the attestor/model catalog.
Use a stable locally persisted deployment idempotency key and save the seal ID
as soon as accepted; resume polling or retry the existing deployment after a
timeout rather than minting again.

Mint explicit `framework` and `persona` iData. The encrypted persona carries
the private strategy and a self-contained bootstrap payload for the worker.
OpenClaw extracts that payload locally into a skill subdirectory and starts the
Node worker; it does not reproduce secret bytes in chat. Keep the reusable
worker and strategy under `workspace/skills/portfolio/`, which the sealed
adapter persists. Bootstrap verifies the payload checksum, avoids duplicate
processes, and verifies the registered service before reporting success.

The CLI sends an owner-authenticated initialization message and checks readiness;
the presence of a minted token alone is not a successful runtime deployment.
After reset or transfer, the new owner can run the same activation command.
The encrypted capability remains available without the original author's local
strategy environment variables. A clone gets its own agent wallet and must be funded separately.

Do not put private keys or the 1inch key in the persona, skill source, logs,
or public service metadata. The owner key stays in the local `.env`; the SDK
provisions the inference key through its sandbox field. Provision per-owner
trading credentials to a narrowly scoped configuration endpoint authenticated
with a signed, time-limited, nonce-bound message checked against current on-chain
ownership. Keep these credentials in runtime memory; require reconfiguration
after restart. The endpoint accepts settings, not arbitrary code, transactions,
destinations, signatures, or strategy changes.

The agent wallet signs through the SDK's `sealAccount()` adapter and
`SEAL_SIGN_SOCK`. No agent private key is exported. Check ownership before each
cycle and before submitting a trade; pause if the owner changed.

Encryption protects stored agent data; it is not a guarantee that an LLM cannot
disclose its prompt. Model providers may receive agent context, and public
trades can reveal portfolio composition. Explain these limits accurately.

## Rebalancing and 1inch

Use integer token units and fixed-point USD values, never floating-point token
amounts. Read current balances and prices on the portfolio chain. Settle incoming
Base USDC into Robinhood USDG first. Include USDG as unallocated investment cash;
exclude native gas reserves from investable
value. Preserve the sealed target percentages, including any explicitly reported
proportional normalization after an authorized initial crypto omission.

Each five-minute tick refreshes holdings, identifies overweight assets, sells
them into Robinhood USDG, then buys deficits from settled USDG. Use the 1inch
Classic Swap API for same-chain swaps and the official Cross-Chain SDK for
cross-chain funding orders from Base. Receiver is always the agent's own address. A cycle cannot
overlap another, and unresolved orders prevent duplicate spending.

Use configurable slippage, a minimum trade value, and a drift threshold. The
five-minute requirement means a check every five minutes, not a promise of fills
when stock markets are closed or routes unavailable. Report skips and leave
cash unspent when trading is unavailable. Retry rate limits with bounded backoff.

Check allowances and approve only the required amount to the verified 1inch
spender. Validate API transaction targets, sender, receiver, chain, and amounts
before signing. Do not blindly sign arbitrary calldata returned by an API.

Persist cross-chain order state and hashlock secrets before submission in the
sealed skill's state directory. Reconcile ready fills and escrow conditions
using the official SDK flow before revealing each corresponding secret. Track
partial fills, expiry, cancellation/recovery eligibility, and final balances.
Timeout means pending until reconciled, never assumed failure or automatic
resubmission. On restart, recover unresolved orders before starting a new cycle.
A cloned agent must not replay another agent wallet's order state.

Provide a simulation mode with no signatures or network writes, plus explicit
live activation. Both use the same allocation engine. Simulation output must
be labeled and must never contain fabricated protocol proofs.

## Logs and proofs

The worker binds a loopback HTTP server and registers exact `/api/*` services
with the sealed runtime through `POST /services` on its Unix socket. It exposes
read-only cycle status/results, and the narrowly authenticated configuration
operation. No generic exec, sign, proxy, or transaction endpoint.

Collect `X-Agent-Proof` with the SDK from the signed status/result service.
Verify proof signatures, on-chain data binding, expiry, identity, and request/
response binding wherever supported. Store the response and proof together as
JSON files, and show a local file link plus relevant chain explorer links.
Do not substitute an unsigned chat response for an execution proof.

Write structured JSONL logs to a local ignored `logs/` directory and concise
terminal summaries. Redact credentials, strategy weights, payloads, signatures
used for authentication, and pending hashlock secrets. Preserve timestamps,
cycle IDs, order IDs, transaction hashes, failures, and proof verification state.
Proofs establish attribution; they do not prove investment correctness or returns.

## CLI and setup experience

Keep one CLI with commands for configuration checks, model listing, mint/deploy,
activation, status, watch/logs, proof verification, sandbox top-up, agent gas
top-up, and stopping the runtime. Show clear recovery commands after failures.

The README distinguishes:

1. Owner 0G testnet gas, obtained from the faucet.
2. Prepaid sandbox balance via `ag.deposit()` (currently minimum 0.1 OG at deploy).
3. Agent 0G gas via `topUpAgentSeal()` for encrypted state updates.
4. Inference credit and API key from 0G Private Computer.
5. Investment USDC deposited to the agent address on Base.
6. Native ETH on trading chains for approvals or any non-gasless execution.

Document direct funding, exchange withdrawal to the correct chain/address, and
manual swap/bridge funding options. Do not imply 0G testnet tokens buy mainnet
stocks. Give exact API-key pages for 0G inference and 1inch, and distinguish an
RPC URL from an API key. Never claim all Fusion+ flows are gasless: current
1inch Robinhood documentation gives conflicting gas guidance.

## Verification and completion gates

- Use Superpowers TDD: a failing behavior test precedes each implementation.
- TypeScript typecheck, unit tests, and a CLI smoke test pass on a supported Node version.
- Allocation tests cover exact weights, rounding, deposits, sells before buys,
  no overlap, stale prices, unavailable routes, market closures, and gas exclusion.
- 1inch adapter tests cover allowance checks, transaction validation, partial
  fills, secret release, pending recovery, and no duplicate submission.
- AgenticID tests cover exact iData, idempotent deploy/resume, bootstrap integrity,
  owner authentication, transfer/clone behavior, and no key export.
- Local integration tests exercise worker startup, actual HTTP endpoints,
  scheduling with a controlled clock, log redaction, and proof verification
  failures using a simulated sealed service clearly labeled as a fixture.
- Verify `.env`, logs, and credentials are excluded from Git, and `.env.example`
  contains only example allocations and an example prompt.
- Record which checks are offline, read-only live probes, and credential-dependent.
- Commit and push reviewed implementation changes, preserving the prior user instruction.

## Sources inspected

- [AgenticID TypeScript guide](https://github.com/0gfoundation/0g-agentic-id/blob/main/sdk/typescript/GUIDE.md)
- [AgenticID trust model](https://github.com/0gfoundation/0g-agentic-id/blob/main/sealed/TRUST_MODEL.md)
- [OpenClaw persona ingestion](https://github.com/0gfoundation/0g-agentic-id/blob/main/sealed/internal/framework/openclaw/ingest.go)
- [OpenClaw persistent paths](https://github.com/0gfoundation/0g-agentic-id/blob/main/sealed/internal/framework/openclaw/platformtext.go)
- [Runtime service registration](https://github.com/0gfoundation/0g-agentic-id/blob/main/sealed/internal/platform/context.go)
- [TEE wallet adapter](https://github.com/0gfoundation/0g-agentic-id/blob/main/sdk/typescript/src/seal.ts)
- [Live attestor configuration](https://agenticid.0g.ai/config)
- [1inch Robinhood cross-chain integration](https://business.1inch.com/whats-new/robinhood-cross-chain-swaps)
- [1inch Robinhood limitations](https://help.1inch.com/en/articles/16799830-robinhood-chain-on-1inch-what-s-supported-today)
- [Robinhood networks](https://docs.robinhood.com/chain/add-network-to-wallet/)
- [Robinhood canonical token registry](https://docs.robinhood.com/chain/contracts/)
- [1inch API keys](https://business.1inch.com/portal/documentation/overview/getting-started)
- [0G inference onboarding](https://build.0g.ai/compute)
- [Robinhood live stock metadata](https://api.robinhood.com/rhj/assets)
- [VIRTUAL official contract addresses](https://whitepaper.virtuals.io/info-hub/important-links-and-resources/virtuals-protocol-contract-addresses)
- [FET official supported networks](https://superintelligence.io/asi-token-fet/)
