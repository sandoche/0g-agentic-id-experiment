# 0g Agentic ID Experiment

🤖 An experiment with on-chain agent identities and OpenClaw in a secure runtime: test whether an agent can save its state, or try a portfolio bot with an encrypted strategy and its own wallet.

## 🗯️ Bot Paperwork: wallets, chains, and agents

<p align="center">
  <img src="docs/images/bot-paperwork.png" alt="Bot Paperwork: wallets, chains, and selling the robot" width="650">
</p>

## 🧪 Two modes

| Mode | Env file / `AGENT_PROFILE` | What it does | Deployed Agentic ID (trial, 0G mainnet) |
| --- | --- | --- | --- |
| Simple | `.env.minimal` / `minimal` | Tests native agent creation and state persistence, without trading. | **3680055** — runtime stopped after the issue below |
| Advanced | `.env` / `portfolio-manager` (default) | Runs a portfolio bot every five minutes; simulation by default. | **3670626** — portfolio experiment |

Both modes use `AGENTIC_ATTESTOR_URL` to select the identity network: `https://agenticid-mainnet.0g.ai` (mainnet, 16661) or `https://agenticid.0g.ai` (testnet, 16602).

> ⚠️ On 2026-09-21, the simple mainnet trial minted successfully but saving runtime state failed with `exceeds block gas limit`, before any test write; persistence remains unverified.
> More gas funding does not fix this error: the watcher can keep retrying and spending, so stop the affected runtime and confirm it is stopped using the [recovery instructions](docs/minimal-persistence.md#containment-and-recovery).

**🔁 Reproduce:** [Deploy a new simple agent on mainnet](docs/minimal-persistence.md#operator-commands), fund its native OG evolution gas, then run `npm run agent -- diagnostics --env .env.minimal --agent NEW_ID` during initial sync to look for `exceeds block gas limit`.

## 🚀 Quick setup

Prerequisites: Node.js **22+**, Git and APM; run this Bash block from the cloned repository (existing env files are preserved).

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

The last two commands run offline without keys. For deployment, fill in your selected env file with `OWNER_PRIVATE_KEY`, a private-inference `AGENT_API_KEY`, and the intended `AGENTIC_ATTESTOR_URL`; advanced mode also needs `ONEINCH_API_KEY`, your allocations and strategy. Keep these files private.

Follow the [simple deployment steps](docs/minimal-persistence.md#operator-commands) or [advanced deployment steps](docs/guide.md#-mint-and-activate); sandbox hosting, inference credit and native OG gas are separate costs, including when trading is simulated.

**💸 Advanced funding:** Run `npm run agent -- fund --env .env --agent YOUR_ID` to get the agent wallet and token contracts, then send USDC and ETH on Base (default) from your wallet or exchange on that exact network; also send native gas on each trading chain (ETH on Robinhood, BNB on BNB Chain), as detailed in the [funding guide](docs/guide.md#-investment-funding).

Live trading requires explicit `activate --live`; use your own newly deployed ID, not the trial IDs above. More details: [operator guide](docs/guide.md) · [persistence runbook](docs/minimal-persistence.md) · [verification](docs/verification.md).

## 📄 License

[MIT](LICENSE) © 2026 Sandoche. Bundled skills retain their [third-party licenses](THIRD-PARTY-LICENSES/).
