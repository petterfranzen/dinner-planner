import { createHash, timingSafeEqual } from "node:crypto";
import type { NextFunction, Request, Response } from "express";

/**
 * Hash the value before comparing so timingSafeEqual never sees inputs of
 * different length (and the compare cannot leak the token's length).
 */
const digest = (value: string) => createHash("sha256").update(value).digest();

/**
 * Optional bearer-token gate. With no token configured the middleware is a
 * no-op, so the default LAN/household behaviour is unchanged. When API_TOKEN
 * is set, every request through the mount must send the configured token in
 * the Authorization header, prefixed with the bearer scheme; anything else
 * gets a 401. The token is compared in constant time and is never logged.
 */
export function createTokenGate(token: string | undefined) {
  if (!token) {
    return (_req: Request, _res: Response, next: NextFunction): void => next();
  }

  const expected = digest(token);

  return (req: Request, res: Response, next: NextFunction): void => {
    const match = /^Bearer\s+(.+)$/i.exec((req.get("authorization") ?? "").trim());
    const provided = match ? match[1] : "";
    if (!timingSafeEqual(digest(provided), expected)) {
      res.status(401).json({ error: "Unauthorized" });
      return;
    }
    next();
  };
}
