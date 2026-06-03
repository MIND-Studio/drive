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

## Stack & layout (as built — M1–M5 shipped)

- `package.json` — Next.js 16.2.6 + React 19.2.4 + `@inrupt/solid-client` ^3 + `@inrupt/solid-client-authn-browser` (+ `-authn-node` for scripts) + Tailwind v4 + `tsx`. Also consumes the shared `@mind-studio/core` (login card + app launcher) and `@mind-studio/ui` from GitHub Packages, plus `lucide-react` for icons. (No `better-sqlite3`: search is in-browser via `filterEntries` in `DriveBrowser.tsx`, no on-disk index.)
- **Design system:** the UI is built **entirely on `@mind-studio/ui`** (shadcn-native) on the default **Mind brand**. There is **no bespoke palette** — no `--paper/--ink/--accent` tokens, no custom fonts. `globals.css` only imports `@mind-studio/ui/dist/styles.css` + the dropzone utility; everything else uses semantic Tailwind tokens (`bg-background`, `text-muted-foreground`, `border`, `bg-primary`, `text-destructive`, …). `layout.tsx` wraps the app in `<ThemeProvider theme={mind} defaultTheme="dark" storageKey="mind-drive-theme">` and sets `data-mind-theme="mind"` on `<html>`; light/dark is driven by `useMindTheme()` in `ThemeToggle`. Use ui `Button/Input/Checkbox/Dialog/Tabs/ToggleGroup` rather than hand-rolled controls. (RSC gotcha: don't import `Card`/`Badge`/`cn` into server components — the landing/connect pages stay on plain markup + `Button asChild`.)
- `docker-compose.yml` — one CSS v7 service on port **3061**, persisting to `.css-data/`. Note: local dev defaults the issuer to the shared `:3011`/prod pod (`.env.local`), so the `:3061` CSS is opt-in.
- `src/lib/solid/` — pod I/O wrappers: `pod-fs.ts` (file I/O), `auth.ts`/`session.ts` (OIDC), `access.ts` (WAC), `crypto.ts` (PBKDF2-SHA256 envelope encryption).
- `src/app/` — Next.js App Router: `/drive/[[...path]]` (browser), `/drive/file/[...path]` (file view), `/connect`, `/login` + `/login/callback`. (No `/share/[token]` or `/api/notifications/*` — expiring capability links are deferred to v0.2; sharing is WAC public-link only.)
- `scripts/seed-demo.ts` — idempotent demo content under `/alice/drive/`.

## Never commit

- `.css-data/` — pod contents
- `.next/` — Next.js cache (wipe with `rm -rf .next` if Turbopack serves stale CSS)
- `node_modules/`

## Ask before doing

- Introducing a server-side persistence layer (DB, Redis, S3, anything). The pod is the only store.
- Adding any third-party SDK that phones home with file metadata.
- Implementing server-side thumbnail/transcoding. v0 is client-only generation.
- Touching sibling prototypes — they have their own `AGENTS.md`.
