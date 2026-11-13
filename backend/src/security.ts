import helmet from "helmet";
import type { CorsOptions } from "cors";
import type { NextFunction, Request, Response } from "express";

/**
 * Parses the CORS_ORIGINS env var: a comma-separated list of exact origins
 * (scheme + host + port). Empty or unset means no cross-origin access at all,
 * which is the household's normal case: the browser talks to nginx on the same
 * origin, so no CORS headers are needed. There is deliberately no "*" path.
 */
export function parseOrigins(raw: string | undefined): string[] {
  return (raw ?? "")
    .split(",")
    .map((value) => value.trim())
    .filter((value) => value.length > 0);
}

/**
 * Builds the cors() origin callback. A request with no Origin header
 * (same-origin fetch, curl, the container healthcheck) is always allowed.
 * A cross-origin request is allowed only when its Origin is on the allowlist;
 * anything else gets "not allowed", so cors() adds no CORS headers and the
 * browser blocks the response.
 */
export function corsOrigin(allowed: string[]): CorsOptions["origin"] {
  return (origin, callback) => {
    if (!origin) return callback(null, true);
    return callback(null, allowed.includes(origin));
  };
}

/**
 * Security headers for the JSON API. The SPA's own headers (and its CSP tuned
 * to the Vite build) are set by nginx; these cover the API responses: no
 * framing, no MIME sniffing, no referrer, and a locked-down CSP for a service
 * that only ever returns JSON.
 */
export const securityHeaders = () =>
  helmet({
    contentSecurityPolicy: {
      useDefaults: false,
      directives: {
        "default-src": ["'none'"],
        "frame-ancestors": ["'none'"],
      },
    },
    referrerPolicy: { policy: "no-referrer" },
    frameguard: { action: "deny" },
    crossOriginResourcePolicy: { policy: "same-origin" },
  });

/**
 * Sets `Vary: Origin` on every response. cors() only adds it on the paths where
 * it runs its header pass, so a rejected origin would otherwise go out without
 * it — and a caching proxy could then replay that no-CORS response to an
 * allowed origin. Setting it up front is safe: cors()'s own vary() call sees it
 * already present and does not duplicate it.
 */
export function varyOrigin(_req: Request, res: Response, next: NextFunction): void {
  res.setHeader("Vary", "Origin");
  next();
}
