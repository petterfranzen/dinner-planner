import { useCallback, useEffect, useState } from "react";
import { api } from "./api/client";
import { RecipeForm } from "./components/RecipeForm";
import { RecipeImport } from "./components/RecipeImport";
import { RecipeList } from "./components/RecipeList";
import { ShoppingList } from "./components/ShoppingList";
import { WeekPlanner } from "./components/WeekPlanner";
import { addDays, currentWeekStart } from "./dateUtils";
import type { Recipe } from "./types";

type Tab = "plan" | "recipes";

export default function App() {
  const [tab, setTab] = useState<Tab>("plan");
  const [weekStart, setWeekStart] = useState(currentWeekStart());
  const [recipes, setRecipes] = useState<Recipe[]>([]);
  const [recipesError, setRecipesError] = useState<string | null>(null);

  const loadRecipes = useCallback(() => {
    api
      .listRecipes()
      .then(setRecipes)
      .catch((e) => setRecipesError(e.message));
  }, []);

  useEffect(() => {
    loadRecipes();
  }, [loadRecipes]);

  const weekEnd = addDays(weekStart, 6);

  return (
    <div className="app">
      <header>
        <h1>🍽️ Dinner Planner</h1>
        <nav>
          <button className={tab === "plan" ? "active" : ""} onClick={() => setTab("plan")}>
            This week's plan
          </button>
          <button className={tab === "recipes" ? "active" : ""} onClick={() => setTab("recipes")}>
            Recipes
          </button>
        </nav>
      </header>

      {tab === "plan" && (
        <main>
          <section className="week-nav">
            <button onClick={() => setWeekStart(addDays(weekStart, -7))}>← Previous week</button>
            <strong>
              {weekStart} – {weekEnd}
            </strong>
            <button onClick={() => setWeekStart(addDays(weekStart, 7))}>Next week →</button>
            <button onClick={() => setWeekStart(currentWeekStart())}>Today</button>
          </section>

          <section>
            <h2>Meal plan</h2>
            {recipesError && <p className="error">{recipesError}</p>}
            <WeekPlanner weekStart={weekStart} recipes={recipes} />
          </section>

          <section>
            <h2>Shopping list</h2>
            <ShoppingList weekStart={weekStart} />
          </section>
        </main>
      )}

      {tab === "recipes" && (
        <main>
          <section>
            <h2>Your recipes</h2>
            <RecipeList recipes={recipes} onChanged={loadRecipes} />
          </section>
          <section className="add-recipe-section">
            <RecipeImport onImported={loadRecipes} />
            <RecipeForm onCreated={loadRecipes} />
          </section>
        </main>
      )}

      <footer>
        <p>
          Runs privately for your household — no accounts, shared by everyone who can reach this app on your
          network. See the README for details and limitations.
        </p>
      </footer>
    </div>
  );
}
