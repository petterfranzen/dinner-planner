export interface Ingredient {
  id: number;
  recipe_id: number;
  position: number;
  raw_text: string;
  quantity: number | null;
  unit: string | null;
  name: string;
  category: string;
}

export interface Recipe {
  id: number;
  title: string;
  servings: number;
  instructions: string;
  source_url: string | null;
  source_site: string | null;
  created_at: string;
  ingredient_count?: number;
}

export interface RecipeWithIngredients extends Recipe {
  ingredients: Ingredient[];
}

export const MEAL_TYPES = ["breakfast", "lunch", "dinner"] as const;
export type MealType = (typeof MEAL_TYPES)[number];

export const DAY_NAMES = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

export interface MealPlanEntry {
  id: number;
  week_start_date: string;
  day_of_week: number;
  meal_type: MealType;
  recipe_id: number | null;
  recipe_title: string | null;
  recipe_servings: number | null;
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
