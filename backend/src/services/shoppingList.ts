import { db } from "../db.js";
import { normalizeIngredientName } from "./ingredientParser.js";
import type { RecipeIngredientRow, ShoppingListItem } from "../types.js";

interface PlannedRecipe {
  recipeId: number;
  servingsOverride: number | null;
}

/**
 * Builds the consolidated shopping list for a set of planned recipes.
 *
 * Combining strategy (best-effort, not perfect - see README "Known
 * limitations"):
 *   - Ingredients are grouped by a normalized name AND their unit. Two
 *     lines for the same ingredient in the same unit (e.g. two recipes
 *     both calling for "onion", no unit) are summed into one line.
 *   - Different units for the same ingredient (e.g. "2 cups flour" vs
 *     "100g flour") are NOT converted into each other - there's no unit
 *     conversion table. They show up as separate lines under the same
 *     name so nothing is silently lost or wrongly combined.
 *   - Ingredients with no parsed quantity (quantity is null - the parser
 *     couldn't confidently read one) are listed once per distinct raw
 *     text rather than summed.
 */
export function buildShoppingList(recipes: PlannedRecipe[]): ShoppingListItem[] {
  if (recipes.length === 0) return [];

  const placeholders = recipes.map(() => "?").join(",");
  const rows = db
    .prepare(
      `SELECT ri.*, r.servings AS recipe_servings
       FROM recipe_ingredient ri
       JOIN recipe r ON r.id = ri.recipe_id
       WHERE ri.recipe_id IN (${placeholders})
       ORDER BY ri.recipe_id, ri.position`,
    )
    .all(...recipes.map((r) => r.recipeId)) as (RecipeIngredientRow & { recipe_servings: number })[];

  const servingsOverrideByRecipe = new Map(
    recipes.map((r) => [r.recipeId, r.servingsOverride] as const),
  );

  // key -> accumulator
  const groups = new Map<
    string,
    { name: string; unit: string | null; quantity: number | null; category: string; sources: Set<string> }
  >();

  for (const row of rows) {
    const override = servingsOverrideByRecipe.get(row.recipe_id) ?? null;
    const scale =
      override && row.recipe_servings > 0 ? override / row.recipe_servings : 1;

    const normalizedName = normalizeIngredientName(row.name);
    const scaledQuantity = row.quantity != null ? row.quantity * scale : null;

    // Ingredients with no readable quantity can't be safely summed, so
    // each distinct raw text gets its own bucket instead of merging blind.
    const key =
      scaledQuantity == null
        ? `${normalizedName}|noqty|${row.raw_text}`
        : `${normalizedName}|${row.unit ?? ""}`;

    const existing = groups.get(key);
    if (existing) {
      if (scaledQuantity != null && existing.quantity != null) {
        existing.quantity += scaledQuantity;
      }
      existing.sources.add(row.raw_text);
    } else {
      groups.set(key, {
        name: row.name,
        unit: row.unit,
        quantity: scaledQuantity,
        category: row.category,
        sources: new Set([row.raw_text]),
      });
    }
  }

  const items: ShoppingListItem[] = Array.from(groups.values()).map((g) => ({
    name: g.name,
    quantity: g.quantity != null ? Math.round(g.quantity * 100) / 100 : null,
    unit: g.unit,
    category: g.category,
    sources: Array.from(g.sources),
  }));

  items.sort((a, b) => a.category.localeCompare(b.category) || a.name.localeCompare(b.name));
  return items;
}
