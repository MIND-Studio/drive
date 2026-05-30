# Research notes — mind-drive-v0

Compiled from four parallel research passes on 2026-05-26. The takeaways below are the surprising / load-bearing constraints; the source agents have more depth and citations.

## 1. What Solid gives us (and doesn't)

### LDP as a filesystem

A pod is a tree of **LDP Containers** (URLs ending in `/`) holding **LDP Resources**. Containment is represented as `ldp:contains` triples in the container's Turtle. Walking a directory:

```ts
const dataset = await getSolidDataset(containerUrl, { fetch });
const childUrls = getContainedResourceUrlAll(dataset);
```

One level deep. Recursion is your problem. `isContainer()` / `isRawData()` distinguish folders from files.

### Binary file handling

- `overwriteFile(url, blob, { fetch, contentType })` — PUTs to a target URL. Guarantees the URL. Also auto-creates intermediary containers (so a typo creates real folders). **Preferred for known paths.**
- `saveFileInContainer(container, blob, { fetch, contentType, slug })` — POSTs to container with a `Slug` header. **Server may ignore the slug.** Must read `getSourceUrl(result)` to learn the actual URL.
- Default `contentType` is `application/octet-stream` — always pass it explicitly.
- `getFile(url)` returns a `Blob` — no streaming. A 1 GB video means buffering 1 GB.
- CSS has no built-in upload size limit, but the reverse proxy will. Plan for chunked client-side uploads.
- `Range` requests work in CSS's file backend but aren't spec-guaranteed across servers.

### What's missing in the protocol

| Feature                      | Status in CSS v7 / LDP                     | What we have to do |
|------------------------------|--------------------------------------------|--------------------|
| Atomic move / rename         | Doesn't exist                              | Copy + delete; lose ACLs |
| Atomic recursive delete      | `deleteContainer` 409s if non-empty       | Depth-first delete |
| Server-side copy             | No                                         | Client downloads + re-uploads |
| Thumbnails / previews        | No                                         | Generate client-side, store as sibling |
| Version history              | No (spec issue #280 references Memento)   | Build snapshot scheme in pod |
| Trash / restore              | No                                         | `/.trash/` container + sweeper |
| Full-text search             | No (ESS has it; CSS doesn't)              | better-sqlite3 FTS5 client-side |
| Recursive notifications      | No (subscriptions are per-container)      | Subscribe per container or poll |

### Sharing: WAC vs ACP

- **CSS v7 ships WAC by default.** ACP requires a different config preset.
- Use `@inrupt/solid-client`'s `universalAccess` API for portability.
- `acl:default` predicates on a container's `.acl` apply to descendants **that lack their own `.acl`**. The moment a child gets its own ACL, inheritance for that child stops. "Share a folder" UI must either (a) trust inheritance and never write child ACLs, or (b) recursively rewrite all descendants.
- No groups out of the box. `acl:agentGroup` exists but requires hosting a separate `vcard:Group` resource.

### Metadata

Three places, none ideal:

1. **Server headers** — `Last-Modified`, `Content-Type`, `Content-Length`. Read-only.
2. **`.meta` sidecars** — every non-RDF resource gets a paired RDF description resource (`foo.jpg` → `foo.jpg.meta`). Mutate with **PATCH** (SPARQL Update), never PUT. Good for tags, descriptions, "original filename", custom timestamps.
3. **App-private index** — many apps keep a separate Turtle or SQLite index because querying across thousands of `.meta` files is slow.

No standard schema. Pick: `dc:title`, `dc:created`, `dc:modified`, `nfo:fileName`, `schema:keywords`.

### Solid Notifications Protocol

W3C-track (June 2024 draft). CSS supports `WebSocketChannel2023` and `WebhookChannel2023`.

Discovery flow:
1. `HEAD` any resource → read `Link` header with `rel="http://www.w3.org/ns/solid/terms#storageDescription"`.
2. `GET` the storage description → find subscription services.
3. `POST` a subscription `{ type, topic }` → receive a WebSocket URL.

**Per-resource subscriptions.** A container subscription fires when its containment list changes. To watch a whole drive tree, you subscribe to every container — could be hundreds of sockets. Polling is a legitimate fallback.

## 2. Existing Solid file managers — the graveyard

| Project          | Status                              | Verdict                                  |
|------------------|-------------------------------------|------------------------------------------|
| **PodBrowser**   | Sunset March 2024, repo archived    | Inrupt walked away. No successor.        |
| **Penny**        | Maintained sporadically             | Triple-store debugger, not a file manager. |
| **Solid Filemanager** (Otto-AA) | Unmaintained, brittle  | Material-UI v3 era; auth often broken on modern CSS. |
| **SolidOS / mashlib** | Active (TimBL's stack) but low velocity | 2005-era UX; no drag-drop, no thumbnails, no mobile. |
| **Solid IDE / Solside** | Quiet | Built on deprecated `solid-file-client`; Vue 2. |
| **NextGraph**    | Active (not Solid, adjacent)        | The bar to match for offline + collab; Rust + Svelte. |

**Verdict: the Solid file-manager space is a graveyard with one slow heartbeat (SolidOS).** Anything modern (drag-drop, thumbnails, share-links, mobile) immediately becomes the best in the ecosystem.

### Gaps no one has filled

1. Drag-and-drop upload with progress and chunking.
2. Thumbnail grid for images/video with inline preview.
3. Share-link generation with expiry (the Dropbox UX, not raw WebID grants).
4. Mobile-first responsive UI.
5. Full-text + metadata search across the pod.
6. Multi-pod federation in one pane.
7. Offline-first sync with conflict resolution.
8. AI-assisted tagging / semantic search (uniquely on-brand for the Mind ecosystem).
9. File-request links (Dropbox "drop box" inboxes).

## 3. Sibling prototype patterns to reuse

### Repo skeleton — match this exactly

```
mind-drive-v0/
├── AGENTS.md
├── README.md
├── CLAUDE.md         (one-liner: @AGENTS.md)
├── package.json
├── docker-compose.yml
├── next.config.ts
├── postcss.config.mjs
├── tsconfig.json
├── .env.example
├── docs/
├── infra/css/        (seed.json, CSS configs)
├── scripts/          (seed-demo.ts, smoke-db.ts, etc — all tsx)
└── src/
    ├── app/          (Next.js App Router)
    └── lib/
        └── solid/    (pod I/O wrappers — 8–12 files)
```

### Solid wrapper layout

Borrow from two prototypes:

- **`mind-os-v0/src/lib/pod-fs.ts`** — the cleanest file I/O abstraction: `readdir`, `readFileText`, `writeFileText`, `getFile`, `overwriteFile`, `createContainer`, `deleteFile`. **Treats the pod as a filesystem.** This is the foundation.
- **`mind-social-network-v0/src/lib/solid/pod-client.ts`** — generic CRUD + Turtle metadata + image upload via `overwriteFile`.

Expect 8–12 files in `src/lib/solid/`:
- `pod-fs.ts` — filesystem abstraction (from os-v0)
- `auth.ts` — OIDC login / session (from codespaces-v0 patterns)
- `containers.ts` — create / list / delete LDP containers
- `metadata.ts` — `.meta` sidecar PATCH helpers
- `access.ts` — universalAccess wrapper
- `notifications.ts` — Solid Notifications subscription helpers
- `capabilities.ts` — signed share-link tokens
- `crypto.ts` — client-side AES-GCM (for the encryption-at-rest tier)
- `indexer.ts` — better-sqlite3 FTS5 index over filenames + text content

### Port allocation

| Prototype       | Dev port | CSS ports |
|-----------------|----------|-----------|
| market-v0       | 3000     | 3001, 3002 |
| codespaces-v0   | 3010     | 3011 |
| os-v0           | 3020     | 3021 |
| agents-v0       | 3041     | — |
| codespaces-ide-v0 | 3041   | — *(known collision with agents-v0)* |
| social-v0       | 3050     | 3051, 3052 |
| **drive-v0**    | **3060** | **3061** (and 3062 if multi-pod) |

### Seed script

`scripts/seed-demo.ts` — idempotent, ~50–80 lines. Mint alice (and optionally bob) via CSS's `.account` API, create `/alice/drive/` container, drop a few demo files (text, image, PDF, nested folder). Re-running updates in place, doesn't fail.
