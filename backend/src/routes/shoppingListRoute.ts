import { Router } from "express";
import { db } from "../db.js";
import { mondayOf, todayIso } from "../services/dateUtils.js";
import { buildShoppingList } from "../services/shoppingList.js";
import { toCsv, toPlainText } from "../services/icaExport.js";

export const shoppingListRouter = Router();

function plannedRecipesForWeek(week: string) {
  return db
    .prepare(
      `SELECT recipe_id AS recipeId, servings_override AS servingsOverride
       FROM meal_plan_entry
       WHERE week_start_date = ? AND recipe_id IS NOT NULL`,
    )
    .all(week) as { recipeId: number; servingsOverride: number | null }[];
}

// GET /api/shopping-list?week=YYYY-MM-DD
shoppingListRouter.get("/", (req, res) => {
  const week = mondayOf(typeof req.query.week === "string" ? req.query.week : todayIso());
  const planned = plannedRecipesForWeek(week);
  const items = buildShoppingList(planned);
  res.json({ weekStartDate: week, items });
});

// GET /api/shopping-list/export?week=YYYY-MM-DD&format=txt|csv
// The realistic "export to ICA": see README for why this isn't a real ICA
// API integration (ICA has none, publicly) - this is a clean, categorized,
// downloadable list meant to be pasted into notes or worked from while
// searching item-by-item in the ICA app.
shoppingListRouter.get("/export", (req, res) => {
  const week = mondayOf(typeof req.query.week === "string" ? req.query.week : todayIso());
  const format = req.query.format === "csv" ? "csv" : "txt";
  const planned = plannedRecipesForWeek(week);
  const items = buildShoppingList(planned);

  if (format === "csv") {
    res.setHeader("Content-Type", "text/csv; charset=utf-8");
    res.setHeader("Content-Disposition", `attachment; filename="shopping-list-${week}.csv"`);
    res.send(toCsv(items));
  } else {
    res.setHeader("Content-Type", "text/plain; charset=utf-8");
    res.setHeader("Content-Disposition", `attachment; filename="shopping-list-${week}.txt"`);
    res.send(toPlainText(items));
  }
});
