# Verification — 2026-09-20

## Local, without real wallet keys

Strict TypeScript checks pass. The tests exercise bigint allocation, stale/missing
prices, transaction validation, durable recovery, partial-fill secret gating,
owner transfer/replay, bounded HTTP endpoints, encrypted payload checksums,
idempotent deployment, proof transcript binding and offline simulation.

The production worker bundle starts in an integration fixture and rejects a second
worker process. Activation fixtures cover first activation, repeated activation,
and reconstruction after reset. These fixtures are **not a deployed TEE**.
Windows exercises a real named-pipe sign-socket transport. Linux CI exercises
a real Unix socket. CI is configured for Node 22 on Windows and Linux; remote CI
results are reported separately from local execution.

## Worker service-registration repair

Live diagnosis of agent `3670626` found a running container with no portfolio
services and HTTP 404 on `/api/status`. The worker exited with
`SERVICE_REGISTRATION_FAILED`: the runtime rejected its bare service array with
HTTP 400 and required `{ "services": [...] }`. Registration now uses that envelope.
Startup logs preserve allowlisted error codes and registration HTTP status while
discarding arbitrary exception text and upstream bodies.

The regression fixture rejects the old request over a real local socket and accepts
the corrected request. Local validation: 151 tests passed with `--maxWorkers=2`,
typecheck, build, and offline simulation passed. The initial unrestricted parallel
test run timed out in the bundled-worker startup fixture; that test passed alone
and in the bounded-concurrency full run. Biome passed with existing warnings; the
1inch dependency also emits existing missing-sourcemap warnings.

The existing sealed agent refused an externally authored repair script under its
attestation policy. A subsequent request to use its supported self-update workflow
failed with `402 Insufficient balance`; a direct private inference probe using
`AGENT_API_KEY` independently returned HTTP 402. The last status check still found
no ready worker. The source fix is verified locally, but repair and live activation
of this existing deployment remain unverified. The local deployment checksum was
not changed, and no new agent was minted.

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

## Independent review

One fresh-context review covered `0feed15..51e5710`, with no private environment
access. Its eight Important findings were reproduced and addressed in one fix pass:

- Simulation leaves existing live orders reserved without invoking recovery.
- Pending transactions can rebroadcast identical saved bytes, with the current-owner guard.
- Interrupted dependency installs retry until a matching lockfile completion marker exists.
- Escrow terminal-event scans persist bounded progress across long outages/restarts.
- Proofs require the entire current data set, expected submitter and a registry-approved
  framework measurement; the first verified measurement is pinned for future checks.
- Stop invalidates earlier configuration; shutdown drains active work before unlocking.
- The encrypted runtime restores configured attestor/RPC endpoints.
- Selected multiline dotenv values are preserved; unterminated values fail explicitly.

No Minor findings were reported. The reviewer deferred actual funded execution to
its separate credential-dependent check. It found no practical bypass of escrow
identity using the existing official factory events and deterministic addresses;
the bytecode check itself remains a substring check, not a full runtime fingerprint.

The clean-install CI initially caught a missing optional websocket peer in the lock.
After regenerating that entry with npm 10, Windows and Linux Node 22 both passed
installation, typecheck, tests, build and offline CLI simulation at `3d46809`.
The final code revision `3475dc0` also passed every CI step on both operating systems:
[GitHub Actions result](https://github.com/sandoche/0g-agent-experiment/actions/runs/35479629642).

Final local verification after all eight fixes: **143 passed, 1 Linux-only test
skipped on Windows**, strict typecheck, production build, offline CLI simulation,
and whitespace checks passed. The opaque private-policy comparison passed for
all source-controlled candidate files; no private key value was selected or printed.
See [implementation decisions](implementation-decisions.md) for the preserved ledger.
