@RTK.md

Read and follow the repository's `RTK.md` when running shell commands. Use
`rtk proxy <command>` for commands without a supported RTK filter, or when
unfiltered output is needed. For PowerShell builtins or pipelines, use
`rtk proxy powershell -NoProfile -Command "..."`.

If RTK is missing, follow the agent development setup in `README.md`; installation
and diagnostics may run without RTK until the executable is available.
