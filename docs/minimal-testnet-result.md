# Minimal 0G testnet trial — 2026-09-21

The minimal agent passed the state-update stage that failed on mainnet. Initial
sync and a later workspace update both produced successful on-chain receipts.
The runtime's signed proofs matched the current committed state. This does not
establish that the mainnet issue is fixed or prove file restoration.

## Environment

- Source: latest fetched `origin/main`, commit
  `44c0216ee611dca2671c64606c9d9247baf9317e`; trial branch `codex/minimal-testnet`.
- Attestor: `https://agenticid.0g.ai`; RPC verified chain ID **16602**.
- Registry: `0x34493302287308f565cf3409daadedf4c8895648`.
- Agent: **424**; sealed wallet: `0xe54f00ecf0838545769395f4294fad353e23e8c3`.
- SDK: `@0gfoundation/0g-agenticid-sdk` 0.1.6; native OpenClaw framework.
- Persona: 493 UTF-8 bytes; initial serialized iData plaintext: 1,359 bytes.
- Private local config: `.env.minimal.testnet`, excluded from Git.

No application source changes were needed. On this Windows machine, bundled
Node 24 required `--use-system-ca` to trust the system certificate store.
Certificate verification remained enabled.

## Observations

1. The owner received 0.5 testnet OG. A 0.2 OG sandbox deposit funded creation and
   hosting; the live preflight minimum was 0.18 OG for creation plus 30 minutes.
2. Agent 424 minted and reached the running phase. Two separate 0.01 OG transfers
   funded its native storage/evolution wallet, for 0.02 OG total.
3. Initial synchronization succeeded. Transaction
   `0xa566691f3ad526c53e7ab3e291cc9430b137ffeb15134983cb5556927109fc4a`
   succeeded in block **56062139**. The receipt matched the agent identity and
   then-current iData bindings.
4. Baseline observation reached `BASELINE_OBSERVED`: on-chain bindings remained
   stable for at least 60 seconds with verified runtime proofs. Unsigned watcher
   logs corroborated stable synchronization.
5. Exactly one owner-chat request asked the runtime to write the 85-byte
   `AGENTICID-PERSISTENCE-PROBE.md` file. The request returned successfully;
   the chat response was not used as proof of file contents.
6. A subsequent workspace update succeeded in transaction
   `0xf33375004030e292c937776e91b16f149944e198724604d7fbe157cf241b6816`,
   block **56062542**. Its receipt matched the agent identity and new current
   bindings. Runtime proofs verified against those bindings.

The `workspace/` commitment changed from
`0x7ac993e709c00a57bfe5f03b7105634085b9ec7ec826e42c11f386b092701703`
to `0xa2e7bddb6b8b11c03cc39f356f2227c20a20453db02fa52f5416f161f4adaa25`.
Framework and OpenClaw configuration commitments stayed unchanged across the
explicit write. The earlier receipt no longer matches current bindings because
the later transaction superseded them; its transaction still succeeded.

Startup logs included download retries. During the observed run, native
diagnostics reported no `exceeds block gas limit` or state-update failure.
Logs remain unsigned supporting evidence, separate from receipts and proofs.

The bounded confirmation finished with `INCONCLUSIVE`, specifically because the
API cannot authenticate the file-to-manifest binding. The runtime stop was
accepted and a subsequent owner-scoped status check confirmed **stopped**. No
second stop request was sent. Approximately **0.279055 OG** remained in the owner
wallet and **0.006829 OG** in the agent wallet at the last balance check. The
0.2 OG sandbox deposit is credit allocated to hosting, not a claim that all of
it was consumed. Private inference usage was not measured by this trial.

## Evidence limits

The native API still lacks an authenticated manifest entry binding this specific
file's content to the workspace commitment, and an authenticated fresh-session
filesystem read. The file persistence verdict therefore remains **INCONCLUSIVE**.
No recreation, reset, or restoration attempt is justified by these observations.
See the [persistence runbook](minimal-persistence.md#stages-and-evidence-limits).

Local deployment records, observations, receipts and signed-proof transcripts
are retained under:

```text
.local/deployments/minimal/16602-0x34493302287308f565cf3409daadedf4c8895648/
.local/proof-bindings/16602-0x34493302287308f565cf3409daadedf4c8895648-424.json
```

The run used the existing `preflight`, `topup-sandbox`, `deploy`, `topup-agent`,
`diagnostics`, `stop-runtime`, and `persistence-test` baseline/write/confirm commands with
`--env .env.minimal.testnet`. Mainnet agents were not modified.
