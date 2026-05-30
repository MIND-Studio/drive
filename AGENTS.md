# AGENTS.md — mind-drive-v0

Orientation rules for agents working in this prototype. **Read this before editing any file here.**

## Orientation

This is a privacy-first gdrive/dropbox clone built on Solid Pods. It is a **sibling** of `mind-market-v0`, `mind-codespaces-v0`, `mind-os-v0`, and `mind-social-network-v0` — independent app, own ports, own data, own docs. Do not unify with sibling prototypes.

The grandparent `/Users/heussers/develop/mind/CLAUDE.md` describes Mind Cube (a Raspberry Pi AI assistant). It is **not** relevant to anything here.

## NOT the Next.js you know

This prototype uses **Next.js 16.2.6** with **React 19.2.4**. APIs have shifted from training-cutoff knowledge. Before relying on what you "know" about `app/`, server actions, Turbopack, `cookies()`, etc., read `node_modules/next/dist/docs/` for the actual current API.

## NOT the Solid you know

Concrete constraints learned in research (see `docs/RESEARCH.md` for citations):

- **No atomic move/rename** in LDP — rename = copy + delete, and ACLs do not follow. Plan all "move" UI around this.
- **No atomic recursive delete** — `deleteContainer` returns 409 if non-empty; depth-first delete every descendant first.
- **`saveFileInContainer` slug is advisory** — server picks the final URL. Always read response `Location` (or `getSourceUrl(result)`) to learn the actual resource URL.
- **Default `Content-Type` is `application/octet-stream`** — always pass `contentType` explicitly or previews break.
- **CSS v7 defaults to WAC** (not ACP). Use `@inrupt/solid-client`'s `universalAccess` to stay portable.
- **ACL inheritance via `acl:default`** stops the moment a child resource gets its own `.acl`. "Share a folder" UI must either trust inheritance (don't write child ACLs) or recursively rewrite.
- **Notifications are per-resource, not recursive** — to watch a folder tree, you subscribe to every container individually, or poll. There is no glob.
- **No versioning, no trash, no full-text search** in CSS v7. We build these client-side.

## Privacy invariants — hard rules

1. **File bytes never leave the user's pod in plaintext.** No upload to our backend, ever. If we add server-side processing (thumbnails, transcoding, OCR), it stays out of v0.
2. **No central database of file metadata.** Indexers (better-sqlite3) are *local to the user's browser/device*, not server-shared. If you find yourself adding a Postgres for "user files," stop and ask.
3. **No telemetry on file contents or names.** Aggregate operation counts only, opt-in.
4. **Capability links must expire** — no permanent public URLs by default.

## Stack & layout (target — not yet implemented)

- `package.json` — Next.js 16 + React 19 + `@inrupt/solid-client` ^3 + `@inrupt/solid-client-authn-browser` + Tailwind v4 + better-sqlite3 (for local search index) + `tsx` for scripts.
- `docker-compose.yml` — one CSS v7 service on port **3061**, persisting to `.css-data/`.
- `src/lib/solid/` — pod I/O wrappers. Borrow `pod-fs.ts` from `mind-os-v0` (most mature file I/O) and `pod-client.ts` patterns from `mind-social-network-v0`.
- `src/app/` — Next.js App Router. `/drive/[...path]` for the browser, `/share/[token]` for capability links, `/api/notifications/*` for the Solid Notifications WebSocket relay if needed.
- `scripts/seed-demo.ts` — idempotent demo content under `/alice/drive/`.

## Never commit

- `.css-data/` — pod contents
- `.indexer-data/` — local search SQLite
- `.next/` — Next.js cache (wipe with `rm -rf .next` if Turbopack serves stale CSS)
- `node_modules/`

## Ask before doing

- Introducing a server-side persistence layer (DB, Redis, S3, anything). The pod is the only store.
- Adding any third-party SDK that phones home with file metadata.
- Implementing server-side thumbnail/transcoding. v0 is client-only generation.
- Touching sibling prototypes — they have their own `AGENTS.md`.
