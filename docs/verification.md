# Verification — 2026-09-20

## Local, without real wallet keys

Strict TypeScript checks pass. The tests exercise bigint allocation, stale/missing
prices, transaction validation, durable recovery, partial-fill secret gating,
owner transfer/replay, bounded HTTP endpoints, encrypted payload checksums,
idempotent deployment, proof transcript binding and offline simulation.

The production worker bundle starts in an integration fixture and rejects a second
worker process. Activation fixtures cover first activation, repeated activation,
and reconstruction after reset. These fixtures are **not a deployed TEE**.
Windows exercises an injected sign-socket transport. Linux CI additionally exercises
a real Unix socket. CI is configured for Node 22 on Windows and Linux; remote CI
results are reported separately from local execution.

## Read-only live checks

- `glm-5.3`: public catalog reports TeeML, attestation, TDX and tool calling.
- A small real completion returned HTTP 200 with the exact model and
  `X-0G-Provider-Trust-Mode: private`; no weaker-tier fallback was attempted.
- Token code, symbols, decimals and chain IDs passed for the configured 11 assets.
  Robinhood USDG is **6 decimals**, covered by a regression test.
- Authenticated 1inch token prices returned for all 11 configured assets.
- Same-chain $100 quote probes returned for USDG → NVDA/MSFT/GOOGL/AMZN/AVGO/TAO
  on Robinhood, and USDT → 0G/FET on BNB.
- Fusion+ quote probes returned for Base USDC → Robinhood USDG and Base USDC → BNB
  USDT. These probes used a dummy public address and did not create orders.

Quote availability is a point-in-time result. It does not establish that generic
router calldata will pass the worker's validator or that execution will succeed.
The conservative stock-session guard still pauses weekend stock trading. Arbitrum
is an allowed alternative funding network; its quotes were not part of this Base
configuration's live probe.

## Not established by these checks

Funded minting/provisioning, real sealed worker activation, live swap/Fusion
settlement, real response-proof capture, and actual ownership transfer/clone/reset
still need their own funded execution evidence. No wallet private key was inspected,
and no investment transaction was signed or broadcast during the read-only probes.
The explicit `activate --live` command is required before investment execution.

Source and workflow decisions are documented in the implementation plan and the
code. The final independent review and any material fixes are recorded with the
commits that implement them.
