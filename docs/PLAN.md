# Plan — mind-drive-v0

Synthesis of [`RESEARCH.md`](RESEARCH.md) and [`FEATURES.md`](FEATURES.md) into an implementation roadmap.

## One-paragraph pitch

A web app where you log in with your Solid WebID and browse, upload, download, share, and search files that live in your own pod. No central server holds your bytes. Drag-and-drop upload with progress, thumbnail grid for images and PDFs, share links that expire, client-side encryption-at-rest, local full-text search — features no existing Solid file manager ships today. The privacy story is verifiable: the only network calls touching file content are between your browser and your pod.

## Architecture sketch

```
┌─────────────────────────────────────────────────────────────────┐
│  Browser (Next.js 16 / React 19, port 3060)                     │
│                                                                  │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────────────┐  │
│  │ UI (App      │  │ Web Worker:  │  │ better-sqlite3 FTS5  │  │
│  │  Router)     │  │  - crypto    │  │ (local search index, │  │
│  │              │  │  - thumbs    │  │  WASM in browser)    │  │
│  └──────┬───────┘  │  - PDF.js    │  └──────────────────────┘  │
│         │          └──────────────┘                              │
│         │                                                        │
│  ┌──────┴───────────────────────────────────────────────────┐  │
│  │ src/lib/solid/  — pod I/O wrappers                       │  │
│  │  pod-fs · auth · containers · metadata · access ·         │  │
│  │  notifications · capabilities · crypto · indexer          │  │
│  └──────┬───────────────────────────────────────────────────┘  │
│         │                                                        │
└─────────┼────────────────────────────────────────────────────────┘
          │
          │ Solid Protocol (LDP + WAC + Notifications)
          ▼
┌─────────────────────────────────────────────────────────────────┐
│  Community Solid Server v7 (Docker, port 3061)                  │
│  - Hosts alice, bob pods                                        │
│  - File backend → .css-data/ on disk                            │
│  - WAC enabled by default                                       │
│  - WebSocketChannel2023 for change notifications                │
└─────────────────────────────────────────────────────────────────┘
```

**Critical:** there is no application server holding files. The Next.js process serves UI + handles OIDC redirect, that's it. All file bytes flow browser ↔ pod.

## Pod layout

```
https://alice.pod/
├── profile/card                       (existing WebID document)
└── mind-drive/                        (our namespace, claimed at first login)
    ├── files/                         (user's actual files & folders)
    │   ├── photo.jpg
    │   ├── photo.jpg.meta             (Turtle sidecar: tags, description)
    │   ├── photo.jpg.thumb.webp       (client-generated thumbnail)
    │   └── reports/
    │       └── q4.pdf
    ├── .trash/                        (soft-deleted items + restore metadata)
    ├── .shares/                       (issued capability tokens + public verifier key)
    └── .private/                      (encrypted master keys, never shared)
```

Index data (better-sqlite3) lives **outside the pod**, in the browser's IndexedDB / OPFS — rebuildable on any device by re-crawling the pod.

## Milestones

### M1 — Walking skeleton (week 1)

Goal: log in, see a folder, see a file. No uploads yet.

- Next.js 16 scaffold matching sibling prototypes' shape.
- `docker-compose.yml` with CSS v7 on port 3061, seeded alice.
- `src/lib/solid/auth.ts` — WebID OIDC login.
- `src/lib/solid/pod-fs.ts` — port from `mind-os-v0`, adapted.
- `/drive/[...path]` route — breadcrumbs + folder listing.
- `scripts/seed-demo.ts` — alice + sample files at `/mind-drive/files/`.

**Exit criteria:** `npm run dev`, log in as alice, see seeded folder tree, click a file → 404 on detail page is fine.

### M2 — Tier 1 file CRUD (week 2)

Goal: a usable file manager. PodBrowser parity.

- Drag-and-drop upload with progress.
- Download file (authenticated fetch).
- Create folder.
- Rename (copy + delete).
- Delete (recursive for containers).
- Basic preview: image, PDF (browser-native), text.
- Storage usage readout (from server headers or `pim:storage`).

**Exit criteria:** can do round-trip: upload a folder of photos, rename one, delete one, download one. No data loss.

### M3 — Thumbnails + search (the visible differentiator) (week 3)

- Web Worker thumbnail generation for images, video frames, PDF first pages.
- Grid view vs list view toggle.
- `src/lib/solid/indexer.ts` — better-sqlite3 FTS5 (WASM in browser, persist to OPFS).
- Crawl pod on first login; subscribe to Notifications per-container for incremental updates.
- Search box: filename, mime-type filter, content for text/md/pdf.

**Exit criteria:** thumbnails appear within ~1s of upload; search finds a word inside a PDF you just dropped.

### M4 — Sharing (the headline) (week 4)

- `src/lib/solid/access.ts` — universalAccess wrapper.
- "Share with WebID" dialog — sets WAC grant on a resource or container.
- Expiring share links — capability token signed by per-pod private key (stored in `.private/`), verifier public key at a stable URL, view route at `/share/[token]`.
- "Shared with me" view — discover via inbox notifications.

**Exit criteria:** share a file with bob's WebID, bob sees it in his "shared with me." Generate a 24h public link, copy it, open in a private window → works. Wait past expiry → 403.

### M5 — Encryption-at-rest (the proof point) (week 5)

- `src/lib/solid/crypto.ts` — AES-GCM per-file in a Web Worker.
- Passphrase-derived KEK (Argon2id WASM); wrapped per-file keys in sidecar.
- Opt-in per folder ("encrypt this folder" toggle).
- Preview path: decrypt in browser before render.

**Exit criteria:** view raw pod contents in PodBrowser/curl → ciphertext. View in mind-drive with passphrase → plaintext. Lose the passphrase → unrecoverable (and the UI says so up front).

### Stretch / v0.2

Pod-to-pod sharing, trash bin sweeper, file-request links, multi-pod aggregation view, mobile responsive polish, PWA install.

## Open decisions (resolve before M1)

- **Demo persona names** — `alice`, `bob` (matches social-v0 / market-v0 convention) or something more drive-flavored? *Recommend: alice, bob.*
- **CSS config preset** — default WAC, or swap to ACP for forward-compat? *Recommend: WAC; matches CSS v7 default and `mind-codespaces-v0`.*
- **Index storage in browser** — IndexedDB (compatible everywhere) or OPFS (faster, Chromium-first)? *Recommend: OPFS with IndexedDB fallback.*
- **Authenticated fetch in Web Workers** — `solid-client-authn-browser` doesn't expose a fetch in workers directly; we need to either pass DPoP tokens in or proxy through the main thread. *Investigate during M2.*
- **Are we adding a second pod for sharing demos in M4** — yes / no. Affects docker-compose now or later. *Recommend: defer until M4, add second CSS service then on port 3062.*

## Risks & unknowns

- **`getFile` returns a Blob (no streaming)**. A 1 GB upload requires the user to have 1+ GB of browser memory. For v0 the demo files are small, but document the limit. Real fix: range-request chunked download (CSS supports it but spec doesn't require it across servers).
- **Notifications scale**. A pod with 500 containers = 500 WebSockets. For v0 demos with <20 containers this is fine. For real users we'll need a polling fallback or a "watch the top N most-recently-used" heuristic.
- **No atomic ops**. A rename that crashes mid-way leaves orphans. Need a recovery / GC pass we can document for the demo.
- **Encryption + search are in tension.** Once a file is encrypted, the indexer can't extract text from it without the key. Decision for M5: the search index lives in the browser, so it can hold plaintext extracted at encrypt-time. Document this clearly — "your index is as sensitive as your files" — and never sync it to the pod unencrypted.

## What "done for v0" looks like

A 90-second demo video where someone:
1. Opens `localhost:3030`, logs in as alice (Solid OIDC popup).
2. Sees the drive UI with seeded files + thumbnails.
3. Drags 5 photos in — thumbnails generate live.
4. Searches for a word that's inside a seeded PDF — finds it.
5. Clicks "share" on a file, generates a 24h link, opens in a private window — the file loads.
6. Toggles encryption on a folder, drops a file in, opens `localhost:3061/alice/mind-drive/...` in a separate tab — sees ciphertext.

Each step takes <3s. The whole story holds together.
