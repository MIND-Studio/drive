/**
 * Populate alice's pod with a starter mind-drive/files/ tree so that the
 * Drive UI is not empty on first login.
 *
 * Usage:
 *   docker compose up -d     # CSS on :3061
 *   npm run seed:demo
 *
 * Idempotent — running it again just overwrites the seed files.
 */
import { Session } from "@inrupt/solid-client-authn-node";

const POD_BASE = process.env.POD_BASE_URL ?? "http://localhost:3011/";
const EMAIL = process.env.SEED_EMAIL ?? "alice@mind.local";
const PASSWORD = process.env.SEED_PASSWORD ?? "dev-only-do-not-use-in-prod";
const POD_NAME = process.env.SEED_POD ?? "alice";
const NAMESPACE = process.env.NEXT_PUBLIC_DRIVE_NAMESPACE ?? "mind-drive";

const ROOT = `${POD_BASE}${POD_NAME}/`;
const DRIVE_ROOT = `${ROOT}${NAMESPACE}/files/`;

async function mintCredentials() {
  const indexRes = await fetch(`${POD_BASE}.account/`);
  if (!indexRes.ok) {
    throw new Error(`CSS account index ${indexRes.status} — is CSS running?`);
  }
  const { controls } = (await indexRes.json()) as {
    controls: { password: { login: string }; account: { create: string } };
  };

  const loginRes = await fetch(controls.password.login, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email: EMAIL, password: PASSWORD }),
  });
  if (!loginRes.ok) {
    throw new Error(`Login failed: ${loginRes.status} ${await loginRes.text()}`);
  }
  const { authorization } = (await loginRes.json()) as { authorization: string };

  const accountRes = await fetch(`${POD_BASE}.account/`, {
    headers: { Authorization: `CSS-Account-Token ${authorization}` },
  });
  const account = (await accountRes.json()) as {
    controls: { account: { clientCredentials: string } };
  };

  const credRes = await fetch(account.controls.account.clientCredentials, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `CSS-Account-Token ${authorization}`,
    },
    body: JSON.stringify({
      name: "mind-drive-seed",
      webId: `${ROOT}profile/card#me`,
    }),
  });
  if (!credRes.ok) {
    throw new Error(
      `Credentials creation failed: ${credRes.status} ${await credRes.text()}`
    );
  }
  return (await credRes.json()) as { id: string; secret: string };
}

async function put(
  session: Session,
  url: string,
  body: string | Uint8Array,
  contentType: string
) {
  const res = await session.fetch(url, {
    method: "PUT",
    headers: { "Content-Type": contentType },
    body: body instanceof Uint8Array ? (body as BodyInit) : body,
  });
  if (!res.ok) {
    throw new Error(`PUT ${url} → ${res.status} ${await res.text()}`);
  }
  process.stdout.write(`  · wrote ${url}\n`);
}

async function ensureContainer(session: Session, url: string) {
  const res = await session.fetch(url, {
    method: "PUT",
    headers: {
      "Content-Type": "text/turtle",
      Link: '<http://www.w3.org/ns/ldp#BasicContainer>; rel="type"',
      "If-None-Match": "*",
    },
  });
  if (!res.ok && res.status !== 412 && res.status !== 205) {
    // 412 = already exists, fine. Anything else is real.
    if (res.status !== 409) {
      throw new Error(
        `Container PUT ${url} → ${res.status} ${await res.text()}`
      );
    }
  }
  process.stdout.write(`  · ensured ${url}\n`);
}

/** Tiny solid-color PNGs so the photos/ folder has visible thumbnails. */
function makeBluePng(): Uint8Array {
  const b64 =
    "iVBORw0KGgoAAAANSUhEUgAAABAAAAAQCAQAAAC1+jfqAAAAFElEQVR4nGNk+M9Qz0AEYBxVCAcAGYUBA1pwk8AAAAAASUVORK5CYII=";
  return new Uint8Array(Buffer.from(b64, "base64"));
}

/** A 64×64 SVG image — bigger so the grid thumbnail isn't pinprick-sized. */
function makeMapSvg(): string {
  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 200 200" width="200" height="200">
  <rect width="200" height="200" fill="#dce6f5"/>
  <circle cx="100" cy="100" r="60" fill="#2f5fa6"/>
  <path d="M 40 100 Q 100 30 160 100 T 200 100" stroke="#1d3f72" stroke-width="4" fill="none"/>
  <text x="100" y="180" text-anchor="middle" font-family="serif" font-size="18" fill="#1d3f72">My pod</text>
</svg>`;
}

function makeChartSvg(): string {
  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 200 200" width="200" height="200">
  <rect width="200" height="200" fill="#fbfaf6"/>
  <line x1="20" y1="180" x2="180" y2="180" stroke="#1f1d1a" stroke-width="2"/>
  <line x1="20" y1="180" x2="20" y2="20" stroke="#1f1d1a" stroke-width="2"/>
  <rect x="40"  y="120" width="20" height="60"  fill="#2f5fa6"/>
  <rect x="75"  y="80"  width="20" height="100" fill="#2f5fa6"/>
  <rect x="110" y="50"  width="20" height="130" fill="#2f5fa6"/>
  <rect x="145" y="30"  width="20" height="150" fill="#2f5fa6"/>
  <text x="100" y="18" text-anchor="middle" font-family="serif" font-size="14" fill="#1f1d1a">Pods grown</text>
</svg>`;
}

async function main() {
  console.log(`[seed] minting client credentials at ${POD_BASE}`);
  const { id, secret } = await mintCredentials();

  console.log(`[seed] logging in as ${EMAIL}`);
  const session = new Session();
  await session.login({
    clientId: id,
    clientSecret: secret,
    oidcIssuer: POD_BASE,
  });
  if (!session.info.isLoggedIn) throw new Error("login did not stick");
  console.log(`[seed] webId = ${session.info.webId}`);

  console.log(`[seed] seeding ${DRIVE_ROOT}`);

  await ensureContainer(session, `${ROOT}${NAMESPACE}/`);
  await ensureContainer(session, DRIVE_ROOT);
  await ensureContainer(session, `${DRIVE_ROOT}notes/`);
  await ensureContainer(session, `${DRIVE_ROOT}reports/`);
  await ensureContainer(session, `${DRIVE_ROOT}photos/`);

  await put(
    session,
    `${DRIVE_ROOT}welcome.md`,
    [
      "# Welcome to Mind Drive",
      "",
      "Every file you see here lives in your Solid pod. No central server sees the bytes.",
      "",
      "This file is at `" + `${DRIVE_ROOT}welcome.md` + "`.",
      "",
      "Sibling prototypes that share the same pod model:",
      "",
      "- Mind Market — privacy-first listings",
      "- Mind Codespaces — git → pod static hosting",
      "- Mind OS — Debian VM with pod as disk",
      "- Mind Social Network — posts, friends, DMs",
      "",
    ].join("\n"),
    "text/markdown"
  );

  await put(
    session,
    `${DRIVE_ROOT}notes/today.md`,
    `# Today (${new Date().toISOString().slice(0, 10)})\n\n- [ ] try uploading a photo from your desktop\n- [ ] make a new folder for tax docs\n- [ ] share a file with bob's WebID (coming in M4)\n`,
    "text/markdown"
  );

  await put(
    session,
    `${DRIVE_ROOT}notes/architecture.md`,
    [
      "# Architecture",
      "",
      "- Browser ↔ Solid pod, directly. No server in between.",
      "- LDP containers = folders. Binary resources = files.",
      "- Sharing flows through WAC grants and signed capability links.",
      "- Search and thumbnails are generated client-side and cached locally.",
      "",
      "Read `docs/PLAN.md` for the milestone breakdown.",
      "",
    ].join("\n"),
    "text/markdown"
  );

  await put(
    session,
    `${DRIVE_ROOT}reports/q4-summary.txt`,
    "Q4 numbers:\n- new pods: 1\n- bytes stored: a few KB\n- cloud servers used: 0\n",
    "text/plain"
  );

  await put(
    session,
    `${DRIVE_ROOT}data/sample.json`,
    JSON.stringify(
      {
        title: "Sample dataset",
        rows: [
          { id: 1, label: "alpha", value: 17 },
          { id: 2, label: "beta", value: 31 },
          { id: 3, label: "gamma", value: 53 },
        ],
      },
      null,
      2
    ),
    "application/json"
  );

  await put(session, `${DRIVE_ROOT}photos/blue-square.png`, makeBluePng(), "image/png");
  await put(session, `${DRIVE_ROOT}photos/my-pod.svg`, makeMapSvg(), "image/svg+xml");
  await put(session, `${DRIVE_ROOT}photos/pods-grown.svg`, makeChartSvg(), "image/svg+xml");

  console.log(`[seed] done.`);
  console.log(`[seed] open http://localhost:3060/`);
  console.log(`[seed] OIDC issuer = ${POD_BASE}`);
  await session.logout();
}

main().catch((err) => {
  console.error("[seed] failed:", err);
  process.exit(1);
});
