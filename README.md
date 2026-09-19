# 0g Agent Experiment

Agent tooling is managed with [Microsoft APM](https://microsoft.github.io/apm/).
[Superpowers](https://github.com/obra/superpowers) v6.4.1 provides the project's
15 development skills, including planning, testing, debugging, and code review.
[Caveman](https://github.com/JuliusBrussee/caveman) v2.7.0 adds the core
`caveman` skill for concise responses. Invoke it with `/caveman` or ask for
"caveman mode"; use "normal mode" to stop.
[Codebase Memory](https://deusdata.github.io/codebase-memory-mcp/) provides
local code indexing and graph queries through MCP.

APM manages both skill dependencies and the Codebase Memory MCP configuration.
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
