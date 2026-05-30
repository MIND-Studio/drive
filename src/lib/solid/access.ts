"use client";

import { universalAccess } from "@inrupt/solid-client";
import { session } from "./session";

/**
 * Thin wrappers around @inrupt/solid-client's `universalAccess`. We use the
 * universal API rather than the WAC- or ACP-specific ones so a future switch
 * of CSS config (or moving to a hosted ESS pod) doesn't break sharing.
 *
 * Tradeoffs we accept in v0:
 *   - No time-bounded ACLs. "Expiring links" mean the sharer must revoke
 *     manually (or a future scheduled job removes the grant). WAC has no
 *     concept of expiry; ACP does, but CSS v7 defaults to WAC.
 *   - "Public" here is whatever universalAccess maps to — typically
 *     `acl:agentClass acl:PublicAgent` (anonymous read) for WAC.
 *   - We don't propagate grants to descendants of a container. Granting
 *     `read` on `/photos/` makes the *container listing* readable, not the
 *     individual photos (which need their own grants).
 */

export type AccessFlags = {
  read?: boolean;
  append?: boolean;
  write?: boolean;
  controlRead?: boolean;
  controlWrite?: boolean;
};

function authedFetch(): typeof fetch {
  return session().fetch as typeof fetch;
}

export async function getAgentAccess(
  resourceUrl: string,
  webId: string
): Promise<AccessFlags | null> {
  try {
    // Signature: (resourceUrl, webId, options) — see node_modules/@inrupt/
    //   solid-client/dist/universal/getAgentAccess.d.ts.
    const access = await universalAccess.getAgentAccess(resourceUrl, webId, {
      fetch: authedFetch(),
    });
    return access ?? null;
  } catch {
    return null;
  }
}

export async function setAgentRead(
  resourceUrl: string,
  webId: string,
  read: boolean
): Promise<void> {
  // Signature: (resourceUrl, webId, access, options). The argument order is
  //   webId BEFORE access — easy to flip and the SDK reports a confusing
  //   "Expected a valid URL" error when you do.
  await universalAccess.setAgentAccess(
    resourceUrl,
    webId,
    { read },
    { fetch: authedFetch() }
  );
}

export async function getPublicAccess(
  resourceUrl: string
): Promise<AccessFlags | null> {
  try {
    const access = await universalAccess.getPublicAccess(resourceUrl, {
      fetch: authedFetch(),
    });
    return access ?? null;
  } catch {
    return null;
  }
}

export async function setPublicRead(
  resourceUrl: string,
  read: boolean
): Promise<void> {
  await universalAccess.setPublicAccess(
    resourceUrl,
    { read },
    { fetch: authedFetch() }
  );
}
