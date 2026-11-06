import { db } from "../db.js";
import { aggregateIngredients } from "./aggregator.js";
import type { PlannedRecipe, RecipeForAggregation } from "./aggregator.js";
import type { RecipeIngredientRow, ShoppingListItem } from "../types.js";

export type { PlannedRecipe } from "./aggregator.js";

/**
 * Builds the consolidated shopping list for a set of planned recipes.
 *
 * The merging rules (unit conversion, combining, rounding, servings
 * scaling, repeated meals) live in `aggregateIngredients`; this only loads
 * the ingredient rows for the planned recipes and hands them over.
 */
export function buildShoppingList(recipes: PlannedRecipe[]): ShoppingListItem[] {
  if (recipes.length === 0) return [];

  const ids = [...new Set(recipes.map((r) => r.recipeId))];
  const placeholders = ids.map(() => "?").join(",");
  const rows = db
    .prepare(
      `SELECT ri.*, r.servings AS recipe_servings
       FROM recipe_ingredient ri
       JOIN recipe r ON r.id = ri.recipe_id
       WHERE ri.recipe_id IN (${placeholders})
       ORDER BY ri.recipe_id, ri.position`,
    )
    .all(...ids) as (RecipeIngredientRow & { recipe_servings: number })[];

  const recipesById = new Map<number, RecipeForAggregation>();
  for (const row of rows) {
    let recipe = recipesById.get(row.recipe_id);
    if (!recipe) {
      recipe = { servings: row.recipe_servings, ingredients: [] };
      recipesById.set(row.recipe_id, recipe);
    }
    recipe.ingredients.push({
      id: row.id,
      recipe_id: row.recipe_id,
      position: row.position,
      raw_text: row.raw_text,
      quantity: row.quantity,
      unit: row.unit,
      name: row.name,
      category: row.category,
    });
  }

  return aggregateIngredients(recipes, recipesById);
}
