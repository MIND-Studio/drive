# Features — mind-drive-v0

Scope decisions for a single-developer privacy-first gdrive/dropbox prototype.

## Tier 1 — MVP must-haves

The minimum credible demo. Without these it isn't a Drive clone.

1. **WebID login (OIDC)** — `@inrupt/solid-client-authn-browser`. No app without identity.
2. **Pod root selection** — let the user pick their drive root container (default `/mind-drive/`). Pods aren't structured for us; claim a namespace.
3. **Folder tree browser** — left-rail collapsible tree, LDP container traversal.
4. **File list view** — current container's resources with name, size, mtime, mime-type icon.
5. **Drag-and-drop upload** — multi-file via `overwriteFile`. The gesture users expect.
6. **Download file** — authenticated fetch + stream to disk.
7. **Create folder** — POST a new LDP BasicContainer.
8. **Rename file/folder** — copy + delete (LDP has no native move).
9. **Delete file/folder** — recursive container delete with confirmation.
10. **Breadcrumb navigation + URL routing** — `/drive/[...path]` deep-linkable.
11. **Storage usage indicator** — read pod quota headers if exposed, else show "used" only.
12. **Basic file preview** — inline image / PDF / text via browser-native rendering.

## Tier 2 — Differentiators

What earns "privacy-first gdrive" framing beyond a prettier PodBrowser. Pick 3-4 for v0; defer the rest.

1. **Client-side encryption-at-rest** — AES-GCM per-file in a Web Worker, key wrapped by passphrase-derived KEK in a private pod container. Pod stores ciphertext only; pod operator sees nothing.
2. **Pod-to-pod share (no central server)** — write an ACL grant to the recipient's WebID + POST a notification to their Solid inbox. They see it in their drive's "shared with me" view.
3. **Expiring share links** — signed JWT in URL fragment, public-key verifier resource in the pod. Time-boxed access without permanent public exposure.
4. **Client-side thumbnails** — `OffscreenCanvas` + `pdf.js` in a Web Worker; store `<name>.thumb.webp` as sibling. Fast grid with zero server processing.
5. **Trash bin with retention** — soft-delete to `/.trash/` with sidecar recording original path + deletion time; client-side sweeper purges after N days.
6. **File request links** — public-write capability to a single drop-box container (`acl:Append` only, gated by capability token). Dropbox File Requests for Solid.
7. **Multi-pod aggregation view** — "shared with me" view aggregates inbox notifications across multiple pods the user is logged into.
8. **Local full-text search index** — better-sqlite3 FTS5 over filenames + extracted text from txt/md/pdf. Search without ever indexing on a server.

### Recommended v0 differentiator set (pick 3-4)

The smallest set that tells the privacy story end-to-end:

- (1) Client-side encryption — the headline.
- (3) Expiring share links — the gdrive feature people most miss in Solid.
- (4) Client-side thumbnails — the visible UX win that beats every existing Solid file manager.
- (8) Local full-text search — proves the indexer pattern and makes the demo navigable.

(2), (5), (6), (7) move to a v0.2 milestone.

## Tier 3 — Future / out-of-scope for v0

Real but deferred.

- Real-time collaborative editing (CRDT, own prototype).
- OCR / AI auto-tagging (local WASM models — fits the Mind ecosystem, but big scope).
- Native mobile apps (Solid auth UX on mobile is still rough).
- Background sync daemon (the real Dropbox UX — own project).
- Offline-first PWA with conflict resolution (service worker + IndexedDB mirror).
- Version history (every overwrite snapshots; needs a content-addressed store).
- End-to-end encrypted sharing (wrap file key to recipient's public key; key-discovery convention not yet standardized).

## Non-features

Explicit non-goals for v0.

- **No native or mobile clients.** Web only.
- **No multi-user-per-pod.** One WebID per session. Pods are inherently single-identity.
- **No server-side anything beyond CSS.** No thumbnail service, no search service, no transcode service. If the server can read it, it isn't privacy-first.
- **No proprietary file formats.** No "mind-drive native doc" type. Bytes in, bytes out, byte-identical.
- **No third-party cloud integrations.** No Google / Microsoft / Slack connectors.

## Comparison

|                       | Google Drive                          | Dropbox                               | mind-drive-v0                                  |
|-----------------------|---------------------------------------|---------------------------------------|------------------------------------------------|
| **Storage location**  | Google datacenters                    | Dropbox datacenters                   | User's chosen Solid pod                        |
| **Encryption**        | In transit + at rest, provider keys   | In transit + at rest, provider keys   | Client-side AES-GCM; pod stores ciphertext     |
| **Sharing model**     | Google-account ACLs + public links    | Dropbox-account ACLs + public links   | WAC grants by WebID + expiring capability links |
| **Vendor lock-in**    | High — proprietary API                | High — proprietary API                | None — pod is portable, files are plain bytes  |
| **Search**            | Full-text + OCR + AI (server-side)    | Full-text + OCR (server-side)         | Client-side FTS over filenames + text          |
| **Offline access**    | Mature desktop + mobile sync          | Mature desktop + mobile sync          | Browser session only in v0                     |

**The honest tradeoff:** Drive and Dropbox win on offline/sync UX and on search depth — decades of engineering. mind-drive-v0 wins on data sovereignty, encryption posture, and portability. The bet is that for a meaningful slice of users, *"nobody but me can read my files, and I can walk away tomorrow"* beats *"OCR finds the receipt from 2019."*
