import { Router } from "express";
import { db } from "../db.js";
import { mondayOf, todayIso } from "../services/dateUtils.js";
import { MEAL_TYPES, type MealPlanEntryRow } from "../types.js";

export const mealPlanRouter = Router();

function weekParam(req: { query: { week?: unknown } }): string {
  const raw = typeof req.query.week === "string" ? req.query.week : todayIso();
  return mondayOf(raw);
}

// GET /api/meal-plan?week=YYYY-MM-DD
// Returns every entry for that week plus the recipe title/servings so the
// frontend doesn't need a second round trip per cell.
mealPlanRouter.get("/", (req, res) => {
  const week = weekParam(req);
  const entries = db
    .prepare(
      `SELECT mpe.*, r.title AS recipe_title, r.servings AS recipe_servings
       FROM meal_plan_entry mpe
       LEFT JOIN recipe r ON r.id = mpe.recipe_id
       WHERE mpe.week_start_date = ?`,
    )
    .all(week);
  res.json({ weekStartDate: week, entries });
});

interface UpsertBody {
  recipeId?: number | null;
  servingsOverride?: number | null;
  note?: string | null;
}

// PUT /api/meal-plan/:week/:day/:mealType
// Upserts a single day+meal slot. Shared state on purpose - there's no
// per-user ownership of a slot, so whichever of the two people saves last
// wins, same as editing a shared doc. Fine for two people on one household
// network; see README.
mealPlanRouter.put("/:week/:day/:mealType", (req, res) => {
  const week = mondayOf(req.params.week);
  const day = Number(req.params.day);
  const mealType = req.params.mealType;

  if (!Number.isInteger(day) || day < 0 || day > 6) {
    return res.status(400).json({ error: "day must be 0 (Mon) through 6 (Sun)" });
  }
  if (!MEAL_TYPES.includes(mealType as (typeof MEAL_TYPES)[number])) {
    return res.status(400).json({ error: `mealType must be one of: ${MEAL_TYPES.join(", ")}` });
  }

  const body = req.body as UpsertBody;

  if (body.recipeId != null) {
    const exists = db.prepare(`SELECT 1 FROM recipe WHERE id = ?`).get(body.recipeId);
    if (!exists) return res.status(400).json({ error: "recipeId does not exist" });
  }

  db.prepare(
    `INSERT INTO meal_plan_entry (week_start_date, day_of_week, meal_type, recipe_id, servings_override, note)
     VALUES (@week, @day, @mealType, @recipeId, @servingsOverride, @note)
     ON CONFLICT (week_start_date, day_of_week, meal_type)
     DO UPDATE SET recipe_id = @recipeId, servings_override = @servingsOverride, note = @note`,
  ).run({
    week,
    day,
    mealType,
    recipeId: body.recipeId ?? null,
    servingsOverride: body.servingsOverride ?? null,
    note: body.note?.trim() || null,
  });

  const entry = db
    .prepare(
      `SELECT mpe.*, r.title AS recipe_title, r.servings AS recipe_servings
       FROM meal_plan_entry mpe
       LEFT JOIN recipe r ON r.id = mpe.recipe_id
       WHERE mpe.week_start_date = ? AND mpe.day_of_week = ? AND mpe.meal_type = ?`,
    )
    .get(week, day, mealType) as MealPlanEntryRow | undefined;

  res.json(entry);
});

mealPlanRouter.delete("/:week/:day/:mealType", (req, res) => {
  const week = mondayOf(req.params.week);
  const day = Number(req.params.day);
  const mealType = req.params.mealType;

  db.prepare(
    `DELETE FROM meal_plan_entry WHERE week_start_date = ? AND day_of_week = ? AND meal_type = ?`,
  ).run(week, day, mealType);

  res.status(204).send();
});
