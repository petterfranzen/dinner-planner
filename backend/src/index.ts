import cors from "cors";
import express from "express";
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
app.listen(port, () => {
  console.log(`dinner-planner backend listening on :${port}`);
});
