# drive

A privacy-first Google Drive / Dropbox clone built on [Solid Pods](https://solidproject.org).

File data lives in the user's pod as LDP binary resources. Sharing flows through WAC/ACP and pod-to-pod notifications. No central server ever sees plaintext bytes — the only backend is the user's own Solid storage.

**Status:** All five v0 milestones (M1–M5) implemented and validated end-to-end in Playwright.

## Shared packages (GitHub Packages)

This app installs `@mind-studio/core` and `@mind-studio/ui` from **GitHub Packages**.
A committed `.npmrc` scopes `@mind-studio` to that registry; before installing, export
a GitHub token with `read:packages` (`export NODE_AUTH_TOKEN=<PAT>`).

## Quickstart

```bash
cd drive
docker compose up -d            # CSS on :3061
npm install
npm run seed:demo               # populate alice + bob pods
npm run dev                     # Next.js on :3060
# open http://localhost:3060/connect → log in as alice@mind-drive.local
```

## What works (v0.1)

- **M1**: WebID OIDC login, /drive routing, breadcrumb navigation, folder traversal.
- **M2**: drag-drop upload, download, create folder, rename file (copy+delete), recursive delete, inline image/PDF/text/video/audio preview.
- **M3**: list/grid view toggle (persisted), image thumbnails in grid, filename search.
- **M4**: share with WebID (universalAccess WAC grant), public link toggle, revoke; auth state probed via `WAC-Allow` header.
- **M5**: client-side AES-GCM-256 encryption on opt-in upload, passphrase-derived KEK (PBKDF2-SHA256, 250k iter, per-file salt), per-file random key wrapped in a `<name>.enc.json` sidecar. Pod stores only ciphertext.

## Known limits in v0.1

- Hard refresh / direct deep-link loses the in-memory Solid session — user has to click "Connect" again. We deliberately don't use `restorePreviousSession: true` because CSS's silent OIDC is a full redirect, which infinite-loops. A persistent-session fix is v0.2 work.
- No expiring share links — WAC has no time-bounded ACLs and CSS v7 doesn't ship ACP by default. v0.2 idea: a sidecar JSON with `expiresAt` + a scheduled revoke job.
- No "Shared with me" view — would need LDN inbox notifications.
- No version history, no trash bin, no PDF first-page thumbnails, no recursive search, no full-text content search.
- Browser-only; refreshing keeps you signed out unless you go through `/connect` again.

## What this is

Sibling prototype to [`codespaces`](https://github.com/MIND-Studio/codespaces). Same stack, different problem space. The bet: a meaningful slice of users will trade away gdrive/dropbox's OCR-quality search and decade-old sync clients in exchange for *nobody but me can read my files, and I can walk away tomorrow*.

## Ports (planned)

| Service     | Port |
|-------------|------|
| Next.js dev | 3060 |
| CSS pod #1  | 3061 |
| CSS pod #2  | 3062 (only if multi-pod sharing demo) |

## Planning docs

- [`docs/PLAN.md`](docs/PLAN.md) — synthesis: scope, architecture, milestones
- [`docs/RESEARCH.md`](docs/RESEARCH.md) — what Solid gives us, what existing tools do, what we should reuse
- [`docs/FEATURES.md`](docs/FEATURES.md) — MVP tier / differentiators / non-features / comparison table

## Read before editing

- `AGENTS.md` in this directory for prototype-specific constraints (once code lands).
