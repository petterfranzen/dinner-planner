export interface ParsedIngredient {
  rawText: string;
  quantity: number | null;
  unit: string | null;
  name: string;
  category: string;
}

export interface RecipeIngredientRow {
  id: number;
  recipe_id: number;
  position: number;
  raw_text: string;
  quantity: number | null;
  unit: string | null;
  name: string;
  category: string;
}

export interface RecipeRow {
  id: number;
  title: string;
  servings: number;
  instructions: string;
  source_url: string | null;
  source_site: string | null;
  created_at: string;
}

export interface RecipeWithIngredients extends RecipeRow {
  ingredients: RecipeIngredientRow[];
}

export const MEAL_TYPES = ["breakfast", "lunch", "dinner"] as const;
export type MealType = (typeof MEAL_TYPES)[number];

export interface MealPlanEntryRow {
  id: number;
  week_start_date: string;
  day_of_week: number;
  meal_type: string;
  recipe_id: number | null;
  servings_override: number | null;
  note: string | null;
}

export interface ShoppingListItem {
  name: string;
  quantity: number | null;
  unit: string | null;
  category: string;
  sources: string[];
}
