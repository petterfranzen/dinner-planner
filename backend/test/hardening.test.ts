import { afterAll, beforeAll, describe, expect, it } from "@jest/globals";
import cors from "cors";
import express from "express";
import type { Express } from "express";
import type { Server } from "node:http";
import { createRateLimiter } from "../src/middleware/rateLimit.js";
import { createTokenGate } from "../src/middleware/tokenGate.js";
import { corsOrigin, parseOrigins, securityHeaders, varyOrigin } from "../src/security.js";

const TOKEN = "correct-horse-battery-staple";
// The header name is held in a constant so it is spelled once.
const AUTH = "authorization";
const SCHEME = "Bearer";
const bearer = (value: string) => ({ [AUTH]: SCHEME + " " + value });

// Same shape as the repo's other route tests: a real express app on an
// ephemeral port, driven over fetch. No supertest dependency needed.
async function serve(app: Express): Promise<{ server: Server; base: string }> {
  const server = await new Promise<Server>((resolve) => {
    const s = app.listen(0, "127.0.0.1", () => resolve(s));
  });
  const address = server.address();
  const base =
    address && typeof address === "object" ? `http://127.0.0.1:${address.port}` : "";
  return { server, base };
}

const stop = (server: Server) => new Promise<void>((resolve) => server.close(() => resolve()));

describe("parseOrigins", () => {
  it("returns no origins when CORS_ORIGINS is unset or blank", () => {
    expect(parseOrigins(undefined)).toEqual([]);
    expect(parseOrigins("")).toEqual([]);
    expect(parseOrigins("   ")).toEqual([]);
  });

  it("splits, trims and drops empties", () => {
    expect(parseOrigins(" http://a.example ,http://b.example , ")).toEqual([
      "http://a.example",
      "http://b.example",
    ]);
  });
});

describe("CORS allowlist", () => {
  let server: Server;
  let base: string;

  beforeAll(async () => {
    const app = express();
    app.use(varyOrigin);
    app.use(cors({ origin: corsOrigin(["http://allowed.example"]) }));
    app.get("/api/health", (_req, res) => res.json({ status: "ok" }));
    ({ server, base } = await serve(app));
  });

  afterAll(() => stop(server));

  it("sends no CORS headers to a disallowed origin", async () => {
    const res = await fetch(`${base}/api/health`, {
      headers: { origin: "http://evil.example" },
    });
    expect(res.status).toBe(200);
    expect(res.headers.get("access-control-allow-origin")).toBeNull();
  });

  it("marks the response Vary: Origin even when the origin is rejected", async () => {
    const rejected = await fetch(`${base}/api/health`, {
      headers: { origin: "http://evil.example" },
    });
    expect(rejected.headers.get("vary")).toContain("Origin");

    const allowed = await fetch(`${base}/api/health`, {
      headers: { origin: "http://allowed.example" },
    });
    expect(allowed.headers.get("vary")).toContain("Origin");
  });

  it("echoes an allowlisted origin", async () => {
    const res = await fetch(`${base}/api/health`, {
      headers: { origin: "http://allowed.example" },
    });
    expect(res.headers.get("access-control-allow-origin")).toBe("http://allowed.example");
  });

  it("allows a same-origin request that carries no Origin header", async () => {
    const res = await fetch(`${base}/api/health`);
    expect(res.status).toBe(200);
  });
});

describe("import rate limit", () => {
  let server: Server;
  let base: string;

  beforeAll(async () => {
    const app = express();
    app.use(express.json());
    const limit = createRateLimiter({ windowMs: 60_000, max: 3 });
    app.post("/api/recipes/import", limit, (_req, res) => res.status(201).json({ ok: true }));
    ({ server, base } = await serve(app));
  });

  afterAll(() => stop(server));

  it("allows N calls, then returns 429 with a generic body", async () => {
    for (let i = 0; i < 3; i += 1) {
      const ok = await fetch(`${base}/api/recipes/import`, { method: "POST" });
      expect(ok.status).toBe(201);
    }
    const blocked = await fetch(`${base}/api/recipes/import`, { method: "POST" });
    expect(blocked.status).toBe(429);
    expect(await blocked.json()).toEqual({ error: "Too many requests" });
    expect(blocked.headers.get("retry-after")).toBeTruthy();
  });
});

describe("optional bearer-token gate", () => {
  it("is a no-op when no token is configured", async () => {
    const app = express();
    app.use("/api", createTokenGate(undefined));
    app.get("/api/recipes", (_req, res) => res.json([]));
    const { server, base } = await serve(app);
    try {
      const res = await fetch(`${base}/api/recipes`);
      expect(res.status).toBe(200);
    } finally {
      await stop(server);
    }
  });

  it("returns 401 without a token and 200 with it", async () => {
    const app = express();
    app.use("/api", createTokenGate(TOKEN));
    app.get("/api/recipes", (_req, res) => res.json([]));
    const { server, base } = await serve(app);
    try {
      const without = await fetch(`${base}/api/recipes`);
      expect(without.status).toBe(401);
      expect(await without.json()).toEqual({ error: "Unauthorized" });

      const withToken = await fetch(`${base}/api/recipes`, { headers: bearer(TOKEN) });
      expect(withToken.status).toBe(200);
    } finally {
      await stop(server);
    }
  });

  it("rejects a wrong, truncated or scheme-less token", async () => {
    const app = express();
    app.use("/api", createTokenGate(TOKEN));
    app.get("/api/recipes", (_req, res) => res.json([]));
    const { server, base } = await serve(app);
    try {
      const wrong = await fetch(`${base}/api/recipes`, { headers: bearer("nope") });
      expect(wrong.status).toBe(401);

      const truncated = await fetch(`${base}/api/recipes`, {
        headers: bearer(TOKEN.slice(0, -1)),
      });
      expect(truncated.status).toBe(401);

      const noScheme = await fetch(`${base}/api/recipes`, {
        headers: { [AUTH]: TOKEN },
      });
      expect(noScheme.status).toBe(401);
    } finally {
      await stop(server);
    }
  });
});

describe("security headers", () => {
  it("sets nosniff, a referrer policy, frame denial and a CSP", async () => {
    const app = express();
    app.use(securityHeaders());
    app.get("/api/health", (_req, res) => res.json({ status: "ok" }));
    const { server, base } = await serve(app);
    try {
      const res = await fetch(`${base}/api/health`);
      expect(res.headers.get("x-content-type-options")).toBe("nosniff");
      expect(res.headers.get("referrer-policy")).toBe("no-referrer");
      expect(res.headers.get("x-frame-options")).toBe("DENY");
      expect(res.headers.get("content-security-policy")).toContain("frame-ancestors 'none'");
    } finally {
      await stop(server);
    }
  });
});
