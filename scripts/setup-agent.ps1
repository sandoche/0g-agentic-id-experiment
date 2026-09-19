# Restore the pinned agent dependencies and the Superpowers hook bootstrap.
$ErrorActionPreference = 'Stop'
Push-Location (Split-Path $PSScriptRoot -Parent)
try {
    $apmCommand = Get-Command apm -ErrorAction SilentlyContinue
    if ($apmCommand) {
        $apmExecutable = $apmCommand.Source
    } else {
        $apmExecutable = Join-Path $env:LOCALAPPDATA 'Programs/apm/current/apm.exe'
        if (-not (Test-Path -LiteralPath $apmExecutable)) {
            throw 'Install Microsoft APM first: https://microsoft.github.io/apm/getting-started/installation/'
        }
    }

    # Use Windows certificate trust for this process only; retain TLS verification.
    $savedGitConfig = @{}
    foreach ($key in @('GIT_CONFIG_COUNT', 'GIT_CONFIG_KEY_0', 'GIT_CONFIG_VALUE_0')) {
        $savedGitConfig[$key] = [Environment]::GetEnvironmentVariable($key, 'Process')
    }
    try {
        # Do not override any caller-supplied Git configuration.
        if (-not $env:GIT_CONFIG_COUNT) {
            $env:GIT_CONFIG_COUNT = '1'
            $env:GIT_CONFIG_KEY_0 = 'http.sslBackend'
            $env:GIT_CONFIG_VALUE_0 = 'schannel'
        }
        & $apmExecutable install --frozen
        if ($LASTEXITCODE -ne 0) { throw "APM install failed ($LASTEXITCODE)." }
    } finally {
        foreach ($key in $savedGitConfig.Keys) {
            [Environment]::SetEnvironmentVariable($key, $savedGitConfig[$key], 'Process')
        }
    }

    # APM 0.31.0 deploys hooks separately from skills, but the upstream hook
    # reads its bootstrap skill relative to its own directory.
    $bootstrapDirectory = '.codex/hooks/superpowers/skills/using-superpowers'
    New-Item -ItemType Directory -Force -Path $bootstrapDirectory | Out-Null
    Copy-Item -LiteralPath '.agents/skills/using-superpowers/SKILL.md' -Destination "$bootstrapDirectory/SKILL.md" -Force
    Write-Host 'Agent setup complete: pinned Superpowers skills and startup bootstrap installed.'
} finally {
    Pop-Location
}
