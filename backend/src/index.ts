import cors from "cors";
import express from "express";
import { Phase, setPhase } from "./phase.js";

setPhase(Phase.StartingUp, "applying schema");
import "./db.js"; // ensures schema is applied before routes touch it
import { recipesRouter } from "./routes/recipes.js";
import { mealPlanRouter } from "./routes/mealPlan.js";
import { shoppingListRouter } from "./routes/shoppingListRoute.js";

const app = express();
app.use(cors());
app.use(express.json({ limit: "1mb" }));

app.get("/api/health", (_req, res) => res.json({ status: "ok" }));

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
