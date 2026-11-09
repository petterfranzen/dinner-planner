import { normalizeIngredientName } from "./ingredientParser.js";
import type { RecipeIngredientRow, ShoppingListItem } from "../types.js";

export interface PlannedRecipe {
  recipeId: number;
  servingsOverride: number | null;
}

/** A recipe as stored, with the ingredient rows to aggregate. */
export interface RecipeForAggregation {
  servings: number;
  ingredients: RecipeIngredientRow[];
}

interface UnitConversion {
  family: "mass" | "volume";
  base: string;
  factor: number;
}

/**
 * Compatible units, grouped into families with a base unit and a factor
 * (how many base units one of this unit is). Only units in the same family
 * are converted into each other - so "500 g" and "0.5 kg" now merge and sum,
 * and so do "2 msk" and "1 dl". Anything not listed here (cups, tbsp, oz,
 * "st", "port", ...) is deliberately left alone and only merges with itself:
 * a cup is not safely 240 ml in every kitchen, and a Swedish "msk" is not a
 * US "tbsp" (14.8 ml). Better a second line than a wrong number.
 */
const UNIT_CONVERSIONS: Record<string, UnitConversion> = {
  g: { family: "mass", base: "g", factor: 1 },
  kg: { family: "mass", base: "g", factor: 1000 },
  ml: { family: "volume", base: "ml", factor: 1 },
  cl: { family: "volume", base: "ml", factor: 10 },
  dl: { family: "volume", base: "ml", factor: 100 },
  l: { family: "volume", base: "ml", factor: 1000 },
  msk: { family: "volume", base: "ml", factor: 15 },
  tsk: { family: "volume", base: "ml", factor: 5 },
};

interface Bucket {
  name: string;
  category: string;
  /** Unit recorded on the first row that opened the bucket. */
  unit: string | null;
  /** Quantity in the family base unit when convertible; otherwise raw. */
  baseQuantity: number | null;
  /** Distinct canonical units seen, for convertible buckets. */
  units: Set<string>;
  sources: Set<string>;
}

/**
 * Merges the ingredient rows of a week's planned recipes into one shopping
 * list. Pure: it takes the plan entries and the recipes they point to, so it
 * can be tested without a database.
 *
 * Rules:
 *   - Rows are grouped by normalized ingredient name, then:
 *       - two rows of the same convertible unit family (g/kg, ml/cl/dl/l,
 *         msk/tsk) are converted to the family base unit and summed;
 *       - rows of any other unit only merge with the exact same unit;
 *       - rows with no readable quantity are kept one per distinct raw text,
 *         never summed (nothing is guessed).
 *   - A bucket that spans more than one unit is reported in the family base
 *     unit (g or ml); a bucket that used a single unit keeps that unit.
 *   - Quantities are rounded to two decimals.
 *   - A recipe planned in several meals contributes once per meal, with its
 *     `servingsOverride` scaling applied to each.
 */
export function aggregateIngredients(
  planned: PlannedRecipe[],
  recipesById: Map<number, RecipeForAggregation>,
): ShoppingListItem[] {
  if (planned.length === 0) return [];

  const groups = new Map<string, Bucket>();

  for (const entry of planned) {
    const recipe = recipesById.get(entry.recipeId);
    if (!recipe) continue; // planned slot pointing at a recipe with no rows

    const override = entry.servingsOverride;
    const scale =
      override != null && override > 0 && recipe.servings > 0
        ? override / recipe.servings
        : 1;

    for (const row of recipe.ingredients) {
      const normalizedName = normalizeIngredientName(row.name);
      const scaledQuantity = row.quantity != null ? row.quantity * scale : null;

      if (scaledQuantity == null) {
        // No readable quantity: one bucket per distinct raw text.
        const key = `${normalizedName}|noqty|${row.raw_text}`;
        const existing = groups.get(key);
        if (existing) {
          existing.sources.add(row.raw_text);
        } else {
          groups.set(key, {
            name: row.name,
            category: row.category,
            unit: row.unit,
            baseQuantity: null,
            units: new Set(),
            sources: new Set([row.raw_text]),
          });
        }
        continue;
      }

      const conversion = row.unit ? UNIT_CONVERSIONS[row.unit] : undefined;
      if (conversion && row.unit) {
        const key = `${normalizedName}|${conversion.family}`;
        const addend = scaledQuantity * conversion.factor;
        const existing = groups.get(key);
        if (existing) {
          existing.baseQuantity = (existing.baseQuantity ?? 0) + addend;
          existing.units.add(row.unit);
          existing.sources.add(row.raw_text);
        } else {
          groups.set(key, {
            name: row.name,
            category: row.category,
            unit: row.unit,
            baseQuantity: addend,
            units: new Set([row.unit]),
            sources: new Set([row.raw_text]),
          });
        }
      } else {
        const key = `${normalizedName}|${row.unit ?? ""}`;
        const existing = groups.get(key);
        if (existing) {
          existing.baseQuantity = (existing.baseQuantity ?? 0) + scaledQuantity;
          existing.sources.add(row.raw_text);
        } else {
          groups.set(key, {
            name: row.name,
            category: row.category,
            unit: row.unit,
            baseQuantity: scaledQuantity,
            units: row.unit ? new Set([row.unit]) : new Set(),
            sources: new Set([row.raw_text]),
          });
        }
      }
    }
  }

  const items: ShoppingListItem[] = [];
  for (const bucket of groups.values()) {
    let quantity: number | null = null;
    let unit: string | null = bucket.unit;

    if (bucket.baseQuantity != null) {
      if (bucket.units.size > 1) {
        // Merged across units of one family: report in the family base unit.
        const [first] = bucket.units;
        unit = UNIT_CONVERSIONS[first].base;
        quantity = bucket.baseQuantity;
      } else {
        const [only] = bucket.units;
        const conversion = only ? UNIT_CONVERSIONS[only] : undefined;
        quantity = conversion ? bucket.baseQuantity / conversion.factor : bucket.baseQuantity;
        unit = only ?? bucket.unit;
      }
    }

    items.push({
      name: bucket.name,
      quantity: quantity != null ? Math.round(quantity * 100) / 100 : null,
      unit,
      category: bucket.category,
      sources: Array.from(bucket.sources),
    });
  }

  items.sort((a, b) => a.category.localeCompare(b.category) || a.name.localeCompare(b.name));
  return items;
}
