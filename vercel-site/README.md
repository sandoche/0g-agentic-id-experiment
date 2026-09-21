# Vercel static site

This directory is intentionally self-contained.

- `index.html` is the combined Portfolio manager + Persistence probe code tour.
- `vercel.json` contains only static-site routing/headers.
- No application source, environment files, runtime state, or agent credentials are included.

When importing this repository into Vercel, set **Root Directory** to `vercel-site`
and **Framework Preset** to **Other**. No build command, install command, or
environment variables are required.

The tour is a static snapshot pinned to source revision `44c0216`.
