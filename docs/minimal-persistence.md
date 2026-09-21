# Minimal AgenticID persistence experiment

This profile isolates native AgenticID deployment, identity and persistence from
the portfolio worker. It does not repair agent **3670626** or establish the cause
of its gas-limit failures. Do not use that agent for this experiment.

## Configuration and network selection

The [2026-09-21 testnet trial](minimal-testnet-result.md) minted agent 424 and
verified successful initial and post-write workspace updates. The mainnet
gas-limit failure did not recur in that run; specific file persistence and
restoration remain unverified. The testnet runtime was stopped after the trial.

Use Node 22 or newer. Preserve `.env`; create `.env.minimal` from
`.env.minimal.example` only when that destination does not already exist. Supply:

```dotenv
AGENT_PROFILE=minimal
AGENTIC_ATTESTOR_URL=https://YOUR-EXPLICITLY-SELECTED-ATTESTOR
INFERENCE_MODEL=glm-5.3
AGENT_API_KEY=
OWNER_PRIVATE_KEY=
```

Choose **one** attestor deliberately: mainnet `https://agenticid-mainnet.0g.ai`
(16661, real OG) or testnet `https://agenticid.0g.ai` (16602). An absent/blank URL
retains the existing mainnet default. Profile selection never changes this URL.
Online commands resolve chain and registry from `/config` and check the RPC chain
ID; hostname guessing is not used. Offline checks explicitly say the environment
is unresolved. Testnet success would not establish that the mainnet incident is fixed.

`AGENT_PROFILE` accepts exactly `minimal` or `portfolio-manager`; absence defaults
to `portfolio-manager`. A profile is an application selection, **not an agent ID**.
Both use the existing OpenClaw framework and supported sealed image. Process
environment values take precedence over the selected file, including the profile.

Minimal needs no allocations, strategy, 1inch key, investment RPCs, or rebalancing
configuration. Those values are not validated or packaged. Offline check, native
status, diagnostics, baseline and confirmation need no owner or inference key.
Preflight uses the owner key locally to identify the balance to read. Deployment
requires owner and private-inference credentials. The explicit write requires the
owner key and an already provisioned runtime with inference credit.
Resuming an already accepted deployment does not require resupplying an inference
key, issuing another acknowledgment, or maintaining the creation funding minimum.

## Payload and upstream evidence

The application persona is **493 UTF-8 bytes**, with no worker archive,
dependencies, installer, service, custom image or background application loop.
The generated test Markdown is 85 bytes (UUID token and counter 1), under 1 KiB.
`check` reports persona bytes; deploy additionally reports the complete serialized
initial iData plaintext size. These are application measurements, **not the size
of OpenClaw or the sealed runtime**. Startup can still synchronize framework and
configuration state and consume evolution gas.

Inspected SDK: installed `@0gfoundation/0g-agenticid-sdk` 0.1.6. Inspected upstream
revision: `b58018d1c2efbed0d6905cbc4ddef6627d0947e1`:

- [OpenClaw workspace tracking](https://github.com/0gfoundation/0g-agentic-id/blob/b58018d1c2efbed0d6905cbc4ddef6627d0947e1/sealed/internal/framework/openclaw/evolution_paths.go): top-level nonempty `.md` files form the `workspace/` manifest.
- [Native HTTP surface](https://github.com/0gfoundation/0g-agentic-id/blob/b58018d1c2efbed0d6905cbc4ddef6627d0947e1/sealed/internal/proxy/proxy.go): `/hello` is signed; `/log` is unsigned.
- [OpenClaw routes](https://github.com/0gfoundation/0g-agentic-id/blob/b58018d1c2efbed0d6905cbc4ddef6627d0947e1/sealed/internal/framework/openclaw/routes_test.go): owner chat is unsigned; there is no exposed terminal/file-browser route.
- [Native uploader](https://github.com/0gfoundation/0g-agentic-id/blob/b58018d1c2efbed0d6905cbc4ddef6627d0947e1/sealed/internal/uploader/apply.go): upload precedes chain update; failed updates can be retried by the remote watcher.
- [Evolution probe](https://github.com/0gfoundation/0g-agentic-id/blob/b58018d1c2efbed0d6905cbc4ddef6627d0947e1/sdk/typescript/scripts/evolution-probe.cjs): inspected only; its automatic funding behavior was not executed or adopted.

Source inspection is not evidence of which image/version any live agent runs.

## Operator commands

Replace `NEW_ID` with the newly minted minimal agent ID. These commands are
documented operator actions, **not actions performed during local development**.

```sh
# Offline; no keys needed
npm run agent -- check --env .env.minimal

# Read-only balances, model catalog and environment resolution; no inference probe
npm run agent -- preflight --env .env.minimal

# Optional, deliberate deposit: replace 0.1 with your chosen exact amount
npm run agent -- topup-sandbox --env .env.minimal --amount 0.1

# Mints a NEW identity on the explicitly configured network
npm run agent -- deploy --env .env.minimal

# Optional evolution gas: replace 0.01 with your chosen exact amount
npm run agent -- topup-agent --env .env.minimal --agent NEW_ID --amount 0.01

# Native reads, never portfolio /api/status, /api/challenge or /api/events
npm run agent -- status --env .env.minimal --agent NEW_ID
npm run agent -- diagnostics --env .env.minimal --agent NEW_ID
npm run agent -- activate --env .env.minimal --agent NEW_ID
```

Minimal `activate` only checks native availability/proof: it starts no worker and
sends no inference. Minimal rejects trading `--live`, `simulate`, `fund`, `watch`,
portfolio `stop`, and direct `reset`/`retry`. `--execute` is separate from `--live`.
Private inference retains the 0G router private-trust header, TeeML attestation
and tool-support requirements; there is no weaker fallback.

Balance categories:

| Balance | Purpose | Preflight evidence |
| --- | --- | --- |
| Owner native OG | Explicit protocol transactions and deposits | Current native balance; no guarantee it covers future gas |
| Sandbox credit | Creation and runtime hosting | Available credit and create fee + 30 minutes estimate |
| Agent native OG | Autonomous native evolution/storage updates | Must be checked/funded separately for NEW_ID; no safe spending estimate |
| Inference credit | Private model requests | Not probed; check the inference provider account |

The examples do not prescribe a funding amount. The runner never tops up
automatically. A subsequent owner-authorized mainnet run created agent 3680055;
funding enabled storage uploads but the registry update failed with
`exceeds block gas limit`. Its runtime was stopped and the stopped phase confirmed.
See the [dated live result in the operator guide](guide.md#known-mainnet-bug-persistence-update-exceeds-block-gas-limit).

## Stages and evidence limits

```sh
# A: bounded read-only baseline; default deadline 120000 ms
npm run agent -- persistence-test --env .env.minimal --agent NEW_ID --phase baseline --timeout 120000

# B: explicit one-time owner-chat write of AGENTICID-PERSISTENCE-PROBE.md
npm run agent -- persistence-test --env .env.minimal --agent NEW_ID --phase write --execute

# C: bounded read-only observation and commitment assessment
npm run agent -- persistence-test --env .env.minimal --agent NEW_ID --phase confirm --timeout 120000

# D: explicit gates; currently BLOCKED and send NO reset or read-chat request
npm run agent -- persistence-test --env .env.minimal --agent NEW_ID --phase recreate --execute
npm run agent -- persistence-test --env .env.minimal --agent NEW_ID --phase restore --execute
```

Baseline verifies the local profile/environment record against current owner,
agent ID, seal ID and sealed wallet. It saves on-chain iData entries, checks signed
`/hello` against the complete committed bindings, and requires 60 seconds of stable
bindings plus advancing native logs whose latest watcher tick is stable. Framework
and configuration drift are recorded separately from workspace drift. Disk sync
is only corroborated by **UNVERIFIED** logs; this limitation is explicit in
`BASELINE_OBSERVED`. A failed/unavailable baseline blocks writing.

Write saves a fresh public UUID token, counter and mutation intent **before** one
owner-chat request. Native file writing via chat is nondeterministic. Its response
is not saved or accepted as persistence evidence. A timeout may leave the remote
task running. Repeating write never issues another request; use confirm to observe.

Confirmation records uploads as unsigned observations, compares the `workspace/`
role separately from `framework` and `openclaw.json`, and verifies normal proofs.
**The current native API cannot expose an authenticated decrypted manifest entry
binding this particular file to the committed iData. Therefore confirmation is
INCONCLUSIVE even if the workspace hash changes.** A receipt for that hash alone
would not resolve the missing file binding. When native logs supply transaction
hashes, diagnostics read up to three receipts and correlate successful updates with
the sealed sender, registry, agent ID and current iData bindings. These receipts
still cannot establish the file binding. No overall PASS is available in this native-only
implementation.

Consequently recreation and restoration intentionally remain BLOCKED. The SDK
provides `ag.agent.reset(sealId, { framework: "openclaw", apiKey })`, preserving
identity, but this runner will not invoke it without verifiable file commitment.
The API also lacks an authenticated fresh-session filesystem read. It would be
misleading to implement restore by asking the LLM to repeat the locally saved
token. Neither expected content, previous chat, initialization nor a local-file
restore is sent by these blocked stages. Supporting these stages requires a
supported authenticated file/manifest evidence surface; adding a service or a
custom runtime to bypass that limit is outside this minimal profile.

Output distinguishes runtime availability, mutation request, unsigned upload
observation, proof verification, relevant commitment and restoration. Exit 0
means that command's observation/request completed, **not overall persistence
PASS**. Exit 2 means blocked/inconclusive or unverified diagnostics; exit 1 is a
configuration/command failure. Deadlines accept 30000–300000 ms; polls are 15 seconds.

## Containment and recovery

On a detected `exceeds block gas limit` or recognized update failure, the test is
latched FAILED. It issues no further mutation, reset, paid retry or top-up. Logs
are reduced to allowlisted facts and a digest, never raw prompt/credential text.
Unsigned diagnostics can stop progress defensively but cannot authorize success.

**A CLI deadline is not a spending cap on the remote autonomous uploader.** It may
continue retrying after the CLI exits. The owner can explicitly stop the NEW runtime:

```sh
npm run agent -- stop-runtime --env .env.minimal --agent NEW_ID --execute
npm run agent -- diagnostics --env .env.minimal --agent NEW_ID
```

Stop checks profile, network, registry, owner, agent, seal and owner-listed sandbox,
saves intent, then invokes the SDK owner-signed runtime stop once. It reports
acceptance separately from a confirmed stopped phase. A repeated command only
reconciles status. If unconfirmed, inspect the owner tooling/provider; do not
assume retries ceased. The stop lock is separate from the poll lock so containment
can run while the test is polling. Portfolio `stop` only stops its worker and
does not guarantee the sealed runtime/uploader stopped.

Deployment intent and idempotency key are durable before submission. Repeat the
same deploy to resume; never delete the record to recover an ambiguous request.
Changing model/payload fails rather than replaying different content under a key.
Locks serialize concurrent deployments and probe mutations. Same-host dead-process
locks are recovered conservatively; live, foreign-host and malformed locks fail
closed. A process killed during lock acquisition may leave `operation.lock.guard`.
For that exceptional case, inspect the exact namespace, confirm no local process
is running the operation (and no other host uses that directory), preserve all
JSON records, then remove only the stale guard/lock and retry. Never recursively
remove `.local` or remove a live process's lock. Identity records and pending write
or stop intents must survive recovery.

## Storage layout, switching back and legacy records

```text
.local/deployments/PROFILE/CHAIN-REGISTRY/deployment.json
.local/deployments/PROFILE/CHAIN-REGISTRY/agents/ID/persistence.json
.local/deployments/PROFILE/CHAIN-REGISTRY/agents/ID/latest-diagnostics.json
.local/deployments/PROFILE/CHAIN-REGISTRY/agents/ID/proofs/
.local/deployments/PROFILE/CHAIN-REGISTRY/agents/ID/containment/intent.json
.local/proof-bindings/CHAIN-REGISTRY-ID.json
```

Proof/image pins deliberately remain bound to real chain/registry/agent identity
in the existing shared pin directory. Profile/evidence-directory changes cannot
reset them. Keep these records together and back them up privately. Current layout
selects one deployment per profile/environment; it does not automatically mint
another experiment over an existing record. Explicit `--agent` cannot bypass it.

To switch back, select the original `.env`, its original attestor, and:

```dotenv
AGENT_PROFILE=portfolio-manager
# Keep all existing portfolio settings and credentials unchanged.
```

Remove any shell-level `AGENT_PROFILE=minimal` override first (or set it to
`portfolio-manager`); then `--env .env` restores that profile's own records.
Do not change the attestor to match a numerically identical ID on another chain.

Legacy `.local/deployment.json` is never overwritten or automatically adopted
into minimal. Portfolio commands fail with
`LEGACY_DEPLOYMENT_REQUIRES_VERIFIED_MIGRATION` until explicitly migrated:

```sh
# Local metadata copy + public chain reads only; no transaction or agent mutation.
# Run only with the ORIGINAL environment and original owner key.
npm run agent -- migrate-legacy --env .env --agent EXISTING_PORTFOLIO_ID --execute
npm run agent -- status --env .env --agent EXISTING_PORTFOLIO_ID
```

Migration compares the legacy agent ID, seal ID and sealed wallet against that
chain/registry and checks current ownership against the local owner address. It
preserves the old idempotency key/capability checksum and the original file bytes.
An incomplete/pre-mint legacy record or mismatch is refused: recover the original
environment and identity through the original deployment/attestor tooling before
trying again. Never invent missing metadata. Migrated existing agents use status
and activation; a fresh `deploy` cannot silently rebuild an unknown legacy payload.
No migration or operation on agent 3670626 was performed for this task.

## Local validation

```sh
npm run typecheck
npm test -- --run
npm run build
npm run check
npm run agent -- check --env .env.minimal.example
npm run agent -- simulate --once --env .env.example
```

CI runs only local mocked tests, offline checks and paper simulation on Linux and
Windows. Funded lifecycle tests are not part of CI. Local verification on
2026-09-21 used Windows and bundled Node 24.19.0 because the default shell Node
18.13.0 is below the repository's supported version. Typecheck, build, formatting,
Biome CI checks, minimal offline configuration and portfolio paper simulation
passed. Lint exits successfully with warnings (64 in the local run), and the
1inch package emits missing-sourcemap warnings during tests. Linux CI was updated
but was not executed locally. In the subsequent authorized mainnet experiment,
deployment succeeded but initial persistence synchronization failed with
`exceeds block gas limit`, before a test write or paid inference request. The
runtime was stopped. Persistence and restoration remain unverified; the missing
authenticated file-evidence surfaces also remain unresolved.
