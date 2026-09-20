# 0g Agent Experiment

An experimental OpenClaw INFT with an encrypted portfolio policy, a deterministic
five-minute worker, 1inch swaps/Fusion+ transfers, and signed status proofs.
**Simulation is the default. Live trading requires `activate --live`.**

## 🚀 First run

Install Node 22 or newer, then:

```powershell
npm ci
if (!(Test-Path .env)) { Copy-Item .env.example .env }
npm run typecheck
npm test -- --run
npm run build
npm run agent -- check
npm run agent -- simulate --once
```

Keep your existing `.env`. The example contains demonstration weights and a sample
prompt. Put your own `PORTFOLIO_ALLOCATIONS` and `STRATEGY_PROMPT` in `.env`;
weights use basis points and must total 10000. Never commit this file.
Quoted multiline prompts and allocation JSON are supported; unclosed values fail.
Offline simulation uses synthetic $1 token prices, a paper ledger, and no API keys
or signatures. An empty paper account starts with 1000 funding-chain stablecoins.
Without `--once`, it repeats every five minutes until Ctrl+C.

## Development checks

Biome uses its default formatter and recommended lint rules for the TypeScript
source, tests, build scripts, and root configuration. Generated output, the npm
lockfile, and downloaded APM skills are excluded.

```sh
npm run check        # Check formatting, lint, and import ordering
npm run check:fix    # Apply formatting and safe fixes
npm run lint         # Lint only
npm run format      # Format files
npm run format:check # Check formatting without writing
```

`npm ci` installs Lefthook's pre-commit hook automatically. If install scripts were
disabled, run `npm run hooks:install` once. The hook checks staged source/config
files, applies formatting and safe fixes, and stages those fixes. Unfixable lint
errors block the commit. The configuration follows the
[Biome Git hooks recipe](https://biomejs.dev/recipes/git-hooks/).

GitHub Actions runs `biome ci .` (formatting, lint, and import ordering) on Linux
and Windows before typechecking, tests, the build, and offline simulation.

## 🔑 Keys and enclave inference

| Setting | Purpose |
| --- | --- |
| `ONEINCH_API_KEY` | [1inch Business](https://business.1inch.com/portal/) quotes, prices and order API |
| `AGENT_API_KEY` | [0G Private Computer](https://pc.0g.ai/dashboard/api-keys) inference key; choose **Private** trust mode |
| `INFERENCE_MODEL` | `glm-5.3`, checked for TeeML attestation and tool calling |
| `OWNER_PRIVATE_KEY` | Local INFT owner wallet, used only by explicit owner commands |

The first OpenClaw inference pins `X-0G-Provider-Trust-Mode: private`; there is no
Verified/Standard fallback. The API dialect is named `openai`, with its endpoint
fixed to the 0G router so the sealed adapter preserves the privacy header.
Read [0G's privacy modes](https://docs.0g.ai/developer-hub/building-on-0g/compute-network/router/privacy).

```powershell
npm run agent -- models
npm run agent -- check --online
```

The online check performs a small private inference request (up to 64 output
tokens), public RPC reads and authenticated quotes. It does not sign transactions
or place orders. It intentionally excludes the wallet private key when loading
`.env`. No command prints credentials or the private strategy. `--env PATH` selects
an existing environment file without copying or modifying it.

## 🪪 Mint and activate

The current default attestor uses **0G testnet, chain 16602**. Inference credit,
sandbox credit, owner gas, and the agent's evolution gas are separate balances.
Use the [0G testnet faucet](https://faucet.0g.ai/) for the owner wallet's testnet OG.
The CLI refuses protocol writes on an unexpected chain, including Ethereum mainnet.

```powershell
npm run agent -- preflight
# Only if needed; replace 0.1 with the exact OG amount you choose:
npm run agent -- topup-sandbox --amount 0.1
npm run agent -- deploy
# Use the agent ID returned above:
npm run agent -- topup-agent --agent 123 --amount 0.01
npm run agent -- activate --agent 123
npm run agent -- status --agent 123
npm run agent -- watch --agent 123
```

Preflight reports the available sandbox balance and an estimated minimum for
creation plus 30 minutes. Deposits are never automatic. Deployment acknowledges the
configured TEE trust components when needed and consumes existing prepaid sandbox
credit. The deployment ID is saved **before** submission; repeat `deploy` after a
lost response to resume that identity. Accepted, minted, running, and worker-ready
are distinct states. For a failed minted deployment, use `retry --agent 123`.

Activation packages generic worker code, the dependency lock and private policy
inside the encrypted persona. The owner chat launches a deterministic bootstrap
from local `SOUL.md`, installs locked production dependencies, and starts the worker
under `workspace/skills/portfolio/`. Strategy/state survive there through the sealed
workspace lifecycle. No private strategy is included in the activation message.
The 1inch key is sent separately through a one-use owner-signed configuration
endpoint and stays in memory. Restarting requires configuration again.
Configured attestor/RPC endpoints travel inside the encrypted capability. Dependency
installation is marked complete only after `npm ci` succeeds for the matching lock.

## 💸 Investment funding

| Network | Cash token | Gas token |
| --- | --- | --- |
| Base, 8453 (default funding) | USDC | ETH on Base |
| Arbitrum, 42161 (optional funding) | USDC | ETH on Arbitrum |
| Robinhood, 4663 | USDG, 6 decimals | ETH on Robinhood |
| BNB Chain, 56 | Binance-Peg USDT | BNB |

Run `fund --agent 123` to print the sealed agent wallet and exact cash contracts.
Send investment cash to that wallet on the selected funding network, and native
gas on every network it will use. You can also fund USDG on Robinhood and USDT on
BNB directly. An exchange withdrawal must support the **exact destination network**.
For manual bridging, use a currently quoted non-Ethereum route in the
[1inch app](https://app.1inch.io/); confirm both networks and token contracts before
submitting. The worker uses only allowlisted direct chain pairs and has no
Ethereum mainnet fallback. ETH used for L2 gas does not require an Ethereum-mainnet
transaction.

Positions are NVDA, MSFT, GOOGL, AMZN, AVGO and TAO on Robinhood, plus 0G and FET on
BNB. VIRTUAL and RENDER are omitted. Investment **0G on BNB** is distinct from
testnet OG used for the INFT. Target weights are global across chains.

After funding and reviewing the experiment:

```powershell
npm run agent -- activate --agent 123 --live
npm run agent -- watch --agent 123
npm run agent -- stop --agent 123
```

Live activation checks market metadata, quotes and gas balances. The worker checks
ownership before every signature, refuses stale/incomplete prices, and pauses stock
trades outside verified issuer sessions or during halts. Approvals are bounded;
unsupported router selectors are rejected. Some valid 1inch routes can therefore
be skipped. Gas is required; execution is not promised to be gasless.

Only one unresolved transaction or transfer is allowed. Signed bytes/order secrets
are journaled before submission. A timeout never causes a new spend. Fusion secrets
are disclosed only after checking paired escrows, recipients, amounts, confirmations
and timelocks. Partial fills stay reserved. Expiry is not a refund. Permitted public
escrow cancellation is simulated before signing; inaccessible recovery remains
pending for the resolver. Stopping prevents further signatures but cannot undo an
already submitted transaction or order. Keep monitoring unresolved orders.
Live recovery may rebroadcast the identical saved transaction bytes, preserving its
nonce and hash. Simulation leaves pending live execution reserved and performs no
recovery writes. Re-enable explicit live mode to resume it. Long-outage escrow scans
save their progress and continue in bounded pages.

## 🔁 Transfer, clone and reset

INFT ownership is read on-chain. A transfer clears the old owner's in-memory API key
and pauses trading until the new owner configures it. A cloned INFT has a new sealed
wallet; inherited trading state is quarantined rather than replayed. Fund that new
wallet separately. Use the [AgenticID SDK](https://github.com/0gfoundation/0g-agenticid-sdk)
or its official owner tooling for transfer/clone authorization and creation.
This project does not silently grant a buyer clone permission.

For an existing INFT, a new owner needs only their owner key and API keys locally:
`activate --agent ID` uses the policy already encrypted in the token. `reset --agent
ID` reprovisions the same identity with the inference key, then activate again.
Actual funded transfer/clone behavior is still a credential-dependent check; see
[verification results](docs/verification.md).

## 🧾 Logs and proofs

The sealed worker writes redacted JSONL events under its persisted skill state.
`status` and `watch` verify the sealed response signature against the on-chain agent,
expiry, the complete current iData set, the expected submitter, and the hash of the exact HTTP transcript. Verified response
bytes and proof metadata are saved under ignored `.local/proofs/`.
The first signed runtime measurement must be approved by the on-chain framework
registry; it is then pinned under `.local/proof-bindings/`. Later image changes fail
verification until that pin is reviewed and deliberately removed. The protocol has
no per-agent image getter: this first-use pin trusts the registry's approved set,
and is not an independent audit of the image or a separately pinned build digest.

```powershell
npm run agent -- verify-proof --file .local/proofs/FILE.json --agent 123
```

An expired or mismatched proof fails current verification. Mock tests and paper
events are not real TEE proofs. Proofs establish attribution, not investment
correctness or returns. Public trades expose holdings. Encryption at rest does not
guarantee that a language model will never disclose its prompt. Private inference
routing requires enclave model execution but alone is not proof of end-to-end
transport privacy. Mainnet trades use real money; issuer restrictions and live
liquidity can make a quoted strategy unavailable.

## 🛠 Agent development tools

Agent tooling is managed with [Microsoft APM](https://microsoft.github.io/apm/).
[Superpowers](https://github.com/obra/superpowers) v6.4.1 provides the project's
15 development skills, including planning, testing, debugging, and code review.
[Caveman](https://github.com/JuliusBrussee/caveman) v2.7.0 adds the core
`caveman` skill for concise responses. Invoke it with `/caveman` or ask for
"caveman mode"; use "normal mode" to stop.
[Codebase Memory](https://deusdata.github.io/codebase-memory-mcp/) provides
local code indexing and graph queries through MCP.

APM manages both skill dependencies and the Codebase Memory MCP configuration.
It also exposes the RTK setup and verification commands through `apm run`.
[RTK (Rust Token Killer)](https://github.com/rtk-ai/rtk) compresses shell output
for coding agents. The tracked `AGENTS.md` and `RTK.md` instruct Codex users of
this repository to use it, without a machine-specific instruction path.
This is instruction-based integration, not an automatic command-rewriting hook
or enforcement on human terminal commands.

The native Codebase Memory executable is a separate prerequisite, already
installed on the setup machine (verified version: 0.10.8). APM's self-defined
stdio entry configures this executable; it does not download or version-pin it.

## Setup (Windows)

Install APM using its official PowerShell installer:

```powershell
irm https://aka.ms/apm-windows | iex
```

Ensure `codebase-memory-mcp --version` succeeds. On a new Windows machine,
install the runtime using the [upstream installation guide](https://deusdata.github.io/codebase-memory-mcp/):

```powershell
irm https://raw.githubusercontent.com/DeusData/codebase-memory-mcp/main/install.ps1 | iex
```

Open a new terminal, then run from this repository:

```powershell
./scripts/setup-agent.ps1
apm audit --ci
```

Alternatively, when APM is on PATH, run `apm run setup`. The setup installs RTK
with `winget install --id rtk-ai.rtk --exact --source winget` if it is missing,
then verifies `rtk --version` and `rtk gain`. Windows App Installer supplies
Winget. If Winget is unavailable, follow the
[RTK installation guide](https://github.com/rtk-ai/rtk/blob/develop/INSTALL.md)
and rerun setup. The prebuilt Windows package needs no Rust compiler or Python.
RTK was verified here at 0.48.0; Winget selects its available release on a new
machine. RTK is a native prerequisite, not a pinned APM skill dependency.

After installation, restart the terminal and Codex desktop app so they inherit
the updated PATH, then verify:

```powershell
apm run rtk-check
apm run rtk-gain
rtk git status
```

On macOS/Linux, install RTK using its upstream guide and run `apm install --frozen`
after installing APM and Codebase Memory. The shared RTK instructions work across
platforms; `apm run setup` is the Windows PowerShell setup entry point.
Use `rtk proxy <command>` when a command needs unfiltered output or has no RTK
filter. For PowerShell builtins, wrap the shell itself, for example
`rtk proxy powershell -NoProfile -Command "Get-Location"`.

The setup was verified with APM 0.31.0. Git for Windows (including Bash) is
required for the upstream startup hook. Start a new Codex task/session after
setup to load the project skills and startup hook.
Trust this project in Codex so its project MCP configuration can load. Ask
"Index this project" after cloning; the initial index has already been created
on the setup machine. Graph data remains in the local Codebase Memory store.

## Files and maintenance

- `apm.yml` selects Codex, pins Superpowers and Caveman, and declares the MCP server.
- `apm.lock.yaml` pins the exact upstream commit and content hashes.
- `.agents/skills/` contains the installed skills and their supporting files.
- `.codex/hooks.json` and `.codex/hooks/` contain the startup hook.
- `.codex/config.toml` contains the APM-generated Codebase Memory MCP entry.
- `AGENTS.md` and `RTK.md` contain the shared Codex RTK instructions.
- `apm_modules/` is a generated dependency cache and is ignored by Git.

Keep the manifest, lockfile, deployed skills, and hooks in version control.
The setup script runs `apm install --frozen`, then copies the bootstrap skill
into the location expected by the upstream hook. This compensates for APM
0.31.0 deploying hooks and skills into separate directories. The bootstrap
copy is also tracked so the hook works immediately after cloning.

To upgrade Superpowers, choose a release and run
`apm install obra/superpowers#<release-tag>`, then run the setup script and
`apm audit --ci`. Review and commit the resulting changes together.

On Windows, the setup script uses the Windows certificate store for Git
when no process-level Git configuration has been supplied. It restores the
environment afterward and does not change global Git settings.

Superpowers is MIT licensed; see `THIRD-PARTY-LICENSES/Superpowers-LICENSE`.
The installed Caveman skill is MIT licensed; see `THIRD-PARTY-LICENSES/Caveman-LICENSE`.
This setup installs Caveman's core skill, not its separate proxy/runtime product.
