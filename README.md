# 0g Agentic ID Experiment

> 🤖 An experiment with 0g Agentic ID for minting a portfolio-manager agent as iNFT (running with openclaw on an TEE enclave).

## 🗯️ Bot Paperwork: wallets, chains, and agents

<p align="center">
  <img src="docs/images/bot-paperwork.png" alt="Bot Paperwork: wallets, chains, and selling the robot" width="650">
</p>

## 🚀 Quick start guide

Prerequisites: Node.js **22+**, Git and APM; run this Bash block from the cloned repository (existing env files are preserved).

**1. Install dependencies and try it offline.**

```bash
apm install --frozen
npm ci
if [ ! -e .env ]; then cp .env.example .env; fi
if [ ! -e .env.minimal ]; then cp .env.minimal.example .env.minimal; fi
npm run check
npm run typecheck
npm test -- --run
npm run build
npm run agent -- check --env .env.minimal
npm run agent -- simulate --once --env .env
```

For PowerShell, replace the two Bash copy lines with:

```powershell
if (!(Test-Path .env)) { Copy-Item .env.example .env }
if (!(Test-Path .env.minimal)) { Copy-Item .env.minimal.example .env.minimal }
```

**2. Configure your mode.** The last two commands in step 1 run offline without keys. Choose `.env.minimal` (simple) or `.env` (advanced), then fill in `OWNER_PRIVATE_KEY`, a private-inference `AGENT_API_KEY`, and the intended `AGENTIC_ATTESTOR_URL`; advanced mode also needs `ONEINCH_API_KEY`, your allocations and strategy. Keep these files private.

**3. Preflight, fund and deploy.** Replace `ENV_FILE` with your chosen file and run each command separately; replace `NEW_ID` with the ID returned by deployment and `OG_AMOUNT` with your chosen deposit amount. Fund the owner wallet with native OG on the selected 0G network and add inference credit separately; mainnet deployment and top-ups spend real OG even in simulation. Read the [known persistence issue below](#-two-modes) before deploying.

```bash
npm run agent -- preflight --env ENV_FILE
# Only if sandbox credit is needed, using the preflight estimate:
npm run agent -- topup-sandbox --env ENV_FILE --amount OG_AMOUNT
npm run agent -- deploy --env ENV_FILE
# Fund the new agent's native evolution/storage gas separately:
npm run agent -- topup-agent --env ENV_FILE --agent NEW_ID --amount OG_AMOUNT
npm run agent -- activate --env ENV_FILE --agent NEW_ID
npm run agent -- status --env ENV_FILE --agent NEW_ID
```

Simple `activate` only checks runtime availability/proofs; advanced `activate` starts the portfolio worker in simulation. For simple-mode diagnostics, run `npm run agent -- diagnostics --env .env.minimal --agent NEW_ID`; if an update fails, follow [containment and recovery](docs/minimal-persistence.md#containment-and-recovery) before continuing.

**4. Advanced mode: fund and run live (optional).** Use your own deployed advanced agent ID in place of `NEW_ID`.

```bash
npm run agent -- fund --env .env --agent NEW_ID
# Send investment funds and gas to the printed wallet before continuing.
npm run agent -- activate --env .env --agent NEW_ID --live
npm run agent -- watch --env .env --agent NEW_ID
# When ready to stop trading, exit watch with Ctrl+C, then:
npm run agent -- stop --env .env --agent NEW_ID
```

**💸 Funding:** `fund` prints the agent wallet and token contracts; send USDC and ETH on Base (default) from your wallet or exchange on that exact network, plus native gas on each trading chain (ETH on Robinhood, BNB on BNB Chain), as detailed in the [funding guide](docs/guide.md#-investment-funding).

`stop` stops the portfolio worker, not the native runtime or its hosting costs. More details: [operator guide](docs/guide.md) · [persistence runbook](docs/minimal-persistence.md) · [verification](docs/verification.md).

## 🧪 Two modes

| Mode | Env file / `AGENT_PROFILE` | What it does | Deployed Agentic ID (trial) |
| --- | --- | --- | --- |
| Simple | `.env.minimal` / `minimal` | Tests native agent creation and state persistence, without trading. | Testnet **424** — state updates verified; runtime stopped. Mainnet **3680055** — stopped after the issue below |
| Advanced | `.env` / `portfolio-manager` (default) | Runs a portfolio bot every five minutes; simulation by default. | Mainnet **3670626** — portfolio experiment; advanced testnet trial pending |

Both modes use `AGENTIC_ATTESTOR_URL` to select the identity network: `https://agenticid-mainnet.0g.ai` (mainnet, 16661) or `https://agenticid.0g.ai` (testnet, 16602).

**✅ Simple mode works on 0G testnet for deployment and state updates.** On 2026-09-21, agent **424** completed initial sync and a workspace update after a test-file write request, with successful on-chain receipts and verified runtime proofs. The mainnet gas-limit error did not recur. The runtime was stopped after the trial. Specific file contents and restoration remain **unverified** because the native API cannot authenticate them; the file-persistence verdict is still `INCONCLUSIVE`. See the [testnet results](docs/minimal-testnet-result.md).

> ⚠️ On 2026-09-21, the simple mainnet trial minted successfully but saving runtime state failed with `exceeds block gas limit`, before any test write; persistence remains unverified.
> More gas funding does not fix this error: the watcher can keep retrying and spending, so stop the affected runtime and confirm it is stopped using the [recovery instructions](docs/minimal-persistence.md#containment-and-recovery).

**🔁 Reproduce:** [Deploy a new simple agent on mainnet](docs/minimal-persistence.md#operator-commands), fund its native OG evolution gas, then run `npm run agent -- diagnostics --env .env.minimal --agent NEW_ID` during initial sync to look for `exceeds block gas limit`.

## 📄 License

[MIT](LICENSE) © 2026 Sandoche. Bundled skills retain their [third-party licenses](THIRD-PARTY-LICENSES/).
