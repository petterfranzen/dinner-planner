import type { MealPlanEntry, MealType, Recipe, RecipeWithIngredients, ShoppingListItem } from "../types";

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`/api${path}`, {
    headers: { "Content-Type": "application/json" },
    ...init,
  });
  if (!res.ok) {
    let message = `Request failed (${res.status})`;
    try {
      const body = await res.json();
      if (body?.error) message = body.error;
    } catch {
      // ignore - non-JSON error body
    }
    throw new Error(message);
  }
  if (res.status === 204) return undefined as T;
  return res.json() as Promise<T>;
}

export const api = {
  listRecipes: () => request<Recipe[]>("/recipes"),
  getRecipe: (id: number) => request<RecipeWithIngredients>(`/recipes/${id}`),
  createRecipe: (payload: {
    title: string;
    servings: number;
    instructions: string;
    ingredients: { rawText?: string; quantity: number | null; unit: string | null; name: string }[];
  }) => request<RecipeWithIngredients>("/recipes", { method: "POST", body: JSON.stringify(payload) }),
  importRecipe: (url: string) =>
    request<RecipeWithIngredients>("/recipes/import", { method: "POST", body: JSON.stringify({ url }) }),
  deleteRecipe: (id: number) => request<void>(`/recipes/${id}`, { method: "DELETE" }),

  getMealPlan: (week: string) =>
    request<{ weekStartDate: string; entries: MealPlanEntry[] }>(`/meal-plan?week=${week}`),
  setMealPlanSlot: (
    week: string,
    day: number,
    mealType: MealType,
    body: { recipeId: number | null; servingsOverride: number | null; note: string | null },
  ) =>
    request<MealPlanEntry>(`/meal-plan/${week}/${day}/${mealType}`, {
      method: "PUT",
      body: JSON.stringify(body),
    }),
  clearMealPlanSlot: (week: string, day: number, mealType: MealType) =>
    request<void>(`/meal-plan/${week}/${day}/${mealType}`, { method: "DELETE" }),

  getShoppingList: (week: string) =>
    request<{ weekStartDate: string; items: ShoppingListItem[] }>(`/shopping-list?week=${week}`),
  exportUrl: (week: string, format: "txt" | "csv") => `/api/shopping-list/export?week=${week}&format=${format}`,
};
