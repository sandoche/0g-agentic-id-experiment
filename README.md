# 0g Agent Experiment

Agent tooling is managed with [Microsoft APM](https://microsoft.github.io/apm/).
[Superpowers](https://github.com/obra/superpowers) v6.4.1 provides the project's
15 development skills, including planning, testing, debugging, and code review.

## Setup (Windows)

Install APM using its official PowerShell installer:

```powershell
irm https://aka.ms/apm-windows | iex
```

Open a new terminal, then run from this repository:

```powershell
./scripts/setup-agent.ps1
apm audit --ci
```

The setup was verified with APM 0.31.0. Git for Windows (including Bash) is
required for the upstream startup hook. Start a new Codex task/session after
setup to load the project skills and startup hook.

## Files and maintenance

- `apm.yml` selects Codex and pins Superpowers to a release.
- `apm.lock.yaml` pins the exact upstream commit and content hashes.
- `.agents/skills/` contains the installed skills and their supporting files.
- `.codex/hooks.json` and `.codex/hooks/` contain the startup hook.
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
