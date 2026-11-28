import { Router } from "express";
import { db } from "../db.js";
import { isOptionalNumber, optionalText } from "../requestBody.js";
import { mondayOf, todayIso } from "../services/dateUtils.js";
import { MEAL_TYPES, type MealPlanEntryRow } from "../types.js";

export const mealPlanRouter = Router();

const WEEK_ERROR = "week must be a date (YYYY-MM-DD)";

/** The Monday of the given date, or null when it isn't a valid date. */
function mondayOrNull(raw: string): string | null {
  try {
    return mondayOf(raw);
  } catch {
    return null;
  }
}

function weekParam(req: { query: { week?: unknown } }): string | null {
  if (req.query.week === undefined) return mondayOf(todayIso());
  return typeof req.query.week === "string" ? mondayOrNull(req.query.week) : null;
}

// GET /api/meal-plan?week=YYYY-MM-DD
// Returns every entry for that week plus the recipe title/servings so the
// frontend doesn't need a second round trip per cell.
mealPlanRouter.get("/", (req, res) => {
  const week = weekParam(req);
  if (!week) return res.status(400).json({ error: WEEK_ERROR });
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

interface SlotParams {
  week: string;
  day: string;
  mealType: string;
}

/** The week/day/meal slot a `/:week/:day/:mealType` route addresses. */
function slotOf(params: SlotParams) {
  return { week: mondayOrNull(params.week), day: Number(params.day), mealType: params.mealType };
}

function isDayOfWeek(day: number): boolean {
  return Number.isInteger(day) && day >= 0 && day <= 6;
}

function slotError(week: string | null, day: number, mealType: string): string | null {
  if (!week) return WEEK_ERROR;
  if (!isDayOfWeek(day)) return "day must be 0 (Mon) through 6 (Sun)";
  if (!MEAL_TYPES.includes(mealType as (typeof MEAL_TYPES)[number])) {
    return `mealType must be one of: ${MEAL_TYPES.join(", ")}`;
  }
  return null;
}

interface UpsertBody {
  recipeId?: unknown;
  servingsOverride?: unknown;
  note?: unknown;
}

function upsertError(body: UpsertBody): string | null {
  if (!isOptionalNumber(body.recipeId)) return "recipeId must be a number";
  if (!isOptionalNumber(body.servingsOverride)) return "servingsOverride must be a number";
  if (typeof body.servingsOverride === "number" && !(body.servingsOverride > 0)) {
    return "servingsOverride must be positive";
  }
  if (body.note != null && typeof body.note !== "string") return "note must be a string";
  return null;
}

// PUT /api/meal-plan/:week/:day/:mealType
// Upserts a single day+meal slot. Shared state on purpose - there's no
// per-user ownership of a slot, so whichever of the two people saves last
// wins, same as editing a shared doc. Fine for two people on one household
// network; see README.
mealPlanRouter.put("/:week/:day/:mealType", (req, res) => {
  const { week, day, mealType } = slotOf(req.params);
  const error = slotError(week, day, mealType);
  if (error || !week) return res.status(400).json({ error });

  const body = req.body as UpsertBody;
  const bodyError = upsertError(body);
  if (bodyError) return res.status(400).json({ error: bodyError });

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
    recipeId: (body.recipeId as number | null | undefined) ?? null,
    servingsOverride: (body.servingsOverride as number | null | undefined) ?? null,
    note: optionalText(body.note),
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
  const { week, day, mealType } = slotOf(req.params);
  const error = slotError(week, day, mealType);
  if (error || !week) return res.status(400).json({ error });

  db.prepare(
    `DELETE FROM meal_plan_entry WHERE week_start_date = ? AND day_of_week = ? AND meal_type = ?`,
  ).run(week, day, mealType);

  res.status(204).send();
});
