"use client";

import { createSolidClient } from "@mind-studio/core/solid";

/**
 * The Solid issuer used when the user hasn't picked one. Read from the app's
 * env here (core stays framework-agnostic) and handed to the shared client.
 */
export const DEFAULT_ISSUER =
  process.env.NEXT_PUBLIC_SOLID_ISSUER ??
  process.env.NEXT_PUBLIC_POD_BASE_URL ??
  "https://pods.mindpods.org/";

/**
 * The one shared Solid foundation for Mind Drive — session, the single-flight
 * OIDC redirect handler, the shell capability bridge (broker), and a pod fs.
 * Everything that used to live in `session.ts` / `auth.ts` / `broker.ts` /
 * `pod-fs.ts` now forwards to this instance; those files are thin re-export
 * shims.
 */
export const solid = createSolidClient({
  appName: "drive",
  clientName: "Mind Drive",
  defaultReturnPath: "/drive",
  defaultIssuer: DEFAULT_ISSUER,
});
