import { NextResponse } from "next/server";

/**
 * Solid-OIDC **Client Identifier Document** for Mind Drive.
 *
 * Why this exists: without a fixed `client_id`, the @inrupt browser SDK does a
 * fresh *dynamic* client registration on every login, minting a new client id
 * each time. CSS's "Remember this client" is keyed on the client id, so a new
 * id every load means the consent / Authorize screen reappears on every sign-in
 * — most visible when Drive is embedded in the shell and auto-signs-in.
 *
 * Pointing `login({ clientId })` at this stable, dereferenceable document gives
 * the app one durable identity: the IdP fetches it, recognises the same client
 * across sessions, and skips consent after the first Authorize.
 *
 * The document MUST be public JSON-LD whose `client_id` equals its own URL and
 * whose `redirect_uris` exactly match what we pass to `login()` (see
 * ConnectForm). Origin is derived from the request so the same code serves the
 * right URLs in every deploy (drive.mindpods.org in prod). NOTE: a containerised
 * dev IdP can't dereference a `localhost` URL, so the client only uses this in
 * production — see `startLogin` in ConnectForm.
 */
export const dynamic = "force-dynamic";

function publicOrigin(req: Request): string {
  const h = req.headers;
  const host = h.get("x-forwarded-host") ?? h.get("host");
  if (host) {
    const proto =
      h.get("x-forwarded-proto") ??
      (host.includes("localhost") || host.includes("127.0.0.1")
        ? "http"
        : "https");
    return `${proto}://${host}`;
  }
  return new URL(req.url).origin;
}

export async function GET(req: Request) {
  const origin = publicOrigin(req);
  const doc = {
    "@context": ["https://www.w3.org/ns/solid/oidc-context.jsonld"],
    client_id: `${origin}/api/client-id`,
    client_name: "Mind Drive",
    redirect_uris: [`${origin}/login/callback`],
    post_logout_redirect_uris: [`${origin}/`],
    grant_types: ["authorization_code", "refresh_token"],
    response_types: ["code"],
    scope: "openid webid offline_access",
    token_endpoint_auth_method: "none",
    application_type: "web",
  };
  return new NextResponse(JSON.stringify(doc, null, 2), {
    status: 200,
    headers: {
      "content-type": "application/ld+json",
      "cache-control": "public, max-age=3600",
    },
  });
}
