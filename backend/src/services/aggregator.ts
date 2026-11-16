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
  const groups = new Map<string, Bucket>();

  for (const entry of planned) {
    const recipe = recipesById.get(entry.recipeId);
    if (!recipe) continue; // planned slot pointing at a recipe with no rows

    const scale = servingsScale(entry.servingsOverride, recipe.servings);
    for (const row of recipe.ingredients) addRow(groups, row, scale);
  }

  const items = Array.from(groups.values(), toItem);
  items.sort((a, b) => a.category.localeCompare(b.category) || a.name.localeCompare(b.name));
  return items;
}

function isPositive(n: number | null): n is number {
  return n != null && n > 0;
}

/** How much to multiply a recipe's quantities by for one planned meal. */
function servingsScale(override: number | null, servings: number): number {
  if (!isPositive(override)) return 1;
  return servings > 0 ? override / servings : 1;
}

function conversionFor(unit: string | null): UnitConversion | undefined {
  return unit ? UNIT_CONVERSIONS[unit] : undefined;
}

/** Where a row goes and what it adds there. */
interface Contribution {
  key: string;
  /** Amount to add to the bucket; null when the row has no readable quantity. */
  quantity: number | null;
  /** Unit to record when the row joins an existing bucket (convertible rows only). */
  mergedUnit: string | null;
}

function contributionOf(row: RecipeIngredientRow, scale: number): Contribution {
  const name = normalizeIngredientName(row.name);
  if (row.quantity == null) {
    // No readable quantity: one bucket per distinct raw text.
    return { key: `${name}|noqty|${row.raw_text}`, quantity: null, mergedUnit: null };
  }
  const scaled = row.quantity * scale;
  const conversion = conversionFor(row.unit);
  if (conversion) {
    return { key: `${name}|${conversion.family}`, quantity: scaled * conversion.factor, mergedUnit: row.unit };
  }
  return { key: `${name}|${row.unit ?? ""}`, quantity: scaled, mergedUnit: null };
}

function addRow(groups: Map<string, Bucket>, row: RecipeIngredientRow, scale: number): void {
  const contribution = contributionOf(row, scale);
  const existing = groups.get(contribution.key);
  if (existing) {
    mergeInto(existing, row, contribution);
    return;
  }
  groups.set(contribution.key, openBucket(row, contribution));
}

function openBucket(row: RecipeIngredientRow, contribution: Contribution): Bucket {
  const tracksUnit = contribution.quantity != null && row.unit;
  return {
    name: row.name,
    category: row.category,
    unit: row.unit,
    baseQuantity: contribution.quantity,
    units: tracksUnit ? new Set([row.unit as string]) : new Set(),
    sources: new Set([row.raw_text]),
  };
}

function mergeInto(bucket: Bucket, row: RecipeIngredientRow, contribution: Contribution): void {
  bucket.sources.add(row.raw_text);
  if (contribution.quantity == null) return;
  bucket.baseQuantity = (bucket.baseQuantity ?? 0) + contribution.quantity;
  if (contribution.mergedUnit) bucket.units.add(contribution.mergedUnit);
}

/** The quantity and unit a bucket is reported in, before rounding. */
function reportedAmount(bucket: Bucket): { quantity: number | null; unit: string | null } {
  if (bucket.baseQuantity == null) return { quantity: null, unit: bucket.unit };
  const [first] = bucket.units;
  if (bucket.units.size > 1) {
    // Merged across units of one family: report in the family base unit.
    return { quantity: bucket.baseQuantity, unit: UNIT_CONVERSIONS[first].base };
  }
  const conversion = first ? UNIT_CONVERSIONS[first] : undefined;
  return {
    quantity: conversion ? bucket.baseQuantity / conversion.factor : bucket.baseQuantity,
    unit: first ?? bucket.unit,
  };
}

function toItem(bucket: Bucket): ShoppingListItem {
  const { quantity, unit } = reportedAmount(bucket);
  return {
    name: bucket.name,
    quantity: quantity != null ? Math.round(quantity * 100) / 100 : null,
    unit,
    category: bucket.category,
    sources: Array.from(bucket.sources),
  };
}
