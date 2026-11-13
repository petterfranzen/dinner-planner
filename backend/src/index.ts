import cors from "cors";
import express from "express";
import { Phase, setPhase } from "./phase.js";

setPhase(Phase.StartingUp, "applying schema");
import "./db.js"; // ensures schema is applied before routes touch it
import { createRateLimiter } from "./middleware/rateLimit.js";
import { createTokenGate } from "./middleware/tokenGate.js";
import { recipesRouter } from "./routes/recipes.js";
import { mealPlanRouter } from "./routes/mealPlan.js";
import { shoppingListRouter } from "./routes/shoppingListRoute.js";
import { corsOrigin, parseOrigins, securityHeaders, varyOrigin } from "./security.js";

const app = express();

// Behind nginx (in Docker) or a tunnel, the backend sees the proxy's address,
// not the client's. Trusting one hop lets the per-IP import limiter key on the
// real client via X-Forwarded-For, which nginx sends (see frontend/nginx.conf).
app.set("trust proxy", 1);

// Security headers on every API response. The SPA's own headers (and its CSP,
// tuned to the Vite build) are set by nginx; these cover the JSON API.
app.use(securityHeaders());

// Same-origin by default; CORS_ORIGINS is an explicit allowlist, never "*".
// varyOrigin runs first so even a rejected origin gets `Vary: Origin`.
app.use(varyOrigin);
app.use(cors({ origin: corsOrigin(parseOrigins(process.env.CORS_ORIGINS)) }));

app.use(express.json({ limit: "1mb" }));

// /api/health stays open (registered before the gate below) so the compose
// healthcheck keeps working even when a token is configured.
app.get("/api/health", (_req, res) => res.json({ status: "ok" }));

// Optional bearer-token gate. With no API_TOKEN it is a no-op, so the
// household's LAN behaviour is unchanged.
app.use("/api", createTokenGate(process.env.API_TOKEN));

// The URL importer is the one route that makes an outbound fetch, so it is the
// one place worth a per-IP cap. Other routes are cheap local reads/writes.
app.use(
  "/api/recipes/import",
  createRateLimiter({
    windowMs: Number(process.env.IMPORT_RATE_LIMIT_WINDOW_MS ?? 15 * 60 * 1000),
    max: Number(process.env.IMPORT_RATE_LIMIT_MAX ?? 10),
  }),
);

app.use("/api/recipes", recipesRouter);
app.use("/api/meal-plan", mealPlanRouter);
app.use("/api/shopping-list", shoppingListRouter);

// Centralized error handler as a last resort - individual routes already
// catch their own errors, this is just a safety net.
app.use((err: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  console.error(err);
  res.status(500).json({ error: "Internal server error" });
});

const port = Number(process.env.PORT ?? 4000);
const server = app.listen(port, () => {
  console.log(`dinner-planner backend listening on :${port}`);
  setPhase(Phase.Ready, `listening on :${port}`);
});

// Compose sends SIGTERM on `stop`, and docker-monitor's control API stops
// this stack when a demo's lease expires — so this is a routine shutdown,
// not an incident, and saying so keeps the dashboard from showing a
// half-stopped stack as simply broken. SIGINT covers Ctrl-C in dev.
for (const signal of ["SIGTERM", "SIGINT"] as const) {
  process.on(signal, () => {
    setPhase(Phase.ShuttingDown, `received ${signal}`);
    server.close(() => process.exit(0));
  });
}
