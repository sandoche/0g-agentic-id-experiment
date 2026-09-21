# Hosting the interactive code tours

👉 [Open the tours](https://0g.san.cx/)

`index.html` is the self-contained player for the portfolio-manager and minimal
persistence-probe profiles. GitHub Pages serves it directly at the domain root;
there is no installation, server application, wallet connection or live agent call.

The tour is a **snapshot of commit `44c0216`**, not a live view of `main`.
Later changes, including configurable cycle intervals, are not reflected in it.
Source links remain pinned to that revision. Readers need repository access to
follow private GitHub links, but the embedded code excerpts are readable publicly.

## One-time GitHub setup

This repository can remain private. GitHub Pages for a private personal repository
requires GitHub Pro (or another eligible plan). The published HTML and its embedded
source excerpts will be public; never add credentials or private runtime data to it.

1. Open this repository's **Settings → Pages**.
2. Under **Build and deployment → Source**, select **GitHub Actions**.
3. Under **Custom domain**, enter `0g.san.cx` and save it **before adding DNS**.
4. Add the DNS record below, then enable **Enforce HTTPS** when GitHub makes it available.
5. Merge the hosting PR. In **Actions → Publish code tours**, confirm that the
   deployment succeeds. When setup happens after the initial workflow attempt,
   use **Run workflow** on `main` to publish again.

The `CNAME` file records the intended hostname in version control. With a custom
Actions deployment, GitHub does not use that file to configure the domain: the
**Custom domain** setting above is still required.

The workflow uses the `github-pages` environment. Its deployment protection rules
must allow `main`. No additional API key, personal access token or agent secret is
needed; deployment uses GitHub's short-lived workflow credentials.

## DNS for `san.cx`

Create this record at the provider managing the `san.cx` DNS zone:

| Type | Name / Host | Target / Value | TTL |
| --- | --- | --- | --- |
| CNAME | `0g` | `sandoche.github.io` | Provider default / Auto |

A provider asking for the complete name should receive `0g.san.cx` instead of `0g`.
Do not put `https://`, a slash or the repository name in the target.
Replace conflicting A/AAAA/CNAME records only for the exact `0g` hostname, and
leave `san.cx` itself and all other subdomains unchanged. Do not use a wildcard.

Check the result from PowerShell or another terminal:

```sh
nslookup -type=CNAME 0g.san.cx
```

The canonical name should be `sandoche.github.io`. DNS changes and HTTPS
certificate provisioning are not instantaneous; the Pages settings show their
status. GitHub also recommends verifying the domain in your account's Pages
settings; use the exact TXT name and value GitHub supplies, rather than guessing.

## What the workflow publishes

`.github/workflows/pages.yml` validates the embedded data for both tours and copies
only `index.html`, `CNAME` and an empty `.nojekyll` marker into `_site`.
**It never uploads the repository root.** Environment files, `.local`, application
source files, documentation, videos and ZIP archives are not part of the site.
The source excerpts already embedded in `index.html` are intentionally included.

Pull requests run validation and staging only. Pushes to `main` that change the
HTML, domain declaration or Pages workflow also publish the staged artifact.
The workflow can also be run manually on `main`. It does not run the agent,
install the portfolio dependencies or change either profile's runtime behavior.

## Updating or previewing the tour

Open `index.html` directly in a browser for an offline preview. To update the tour,
replace it with a newly exported combined HTML file and open a PR. Review the
embedded source excerpts before publishing and keep the snapshot revision accurate.
No build step or package installation is needed for the player.

## GitHub references

- [Custom Pages workflows](https://docs.github.com/en/pages/getting-started-with-github-pages/using-custom-workflows-with-github-pages)
- [Publishing source and Actions settings](https://docs.github.com/en/pages/getting-started-with-github-pages/configuring-a-publishing-source-for-your-github-pages-site)
- [Custom domains and DNS](https://docs.github.com/en/pages/configuring-a-custom-domain-for-your-github-pages-site/managing-a-custom-domain-for-your-github-pages-site)
- [Verifying a custom domain](https://docs.github.com/en/pages/configuring-a-custom-domain-for-your-github-pages-site/verifying-your-custom-domain-for-github-pages)
