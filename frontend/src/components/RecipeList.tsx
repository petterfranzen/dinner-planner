import { useState } from "react";
import { api } from "../api/client";
import type { Recipe, RecipeWithIngredients } from "../types";

interface Props {
  recipes: Recipe[];
  onChanged: () => void;
}

export function RecipeList({ recipes, onChanged }: Props) {
  const [expanded, setExpanded] = useState<Record<number, RecipeWithIngredients | undefined>>({});
  const [error, setError] = useState<string | null>(null);

  async function toggle(id: number) {
    if (expanded[id]) {
      setExpanded((prev) => ({ ...prev, [id]: undefined }));
      return;
    }
    try {
      const full = await api.getRecipe(id);
      setExpanded((prev) => ({ ...prev, [id]: full }));
    } catch (e) {
      setError((e as Error).message);
    }
  }

  async function remove(id: number) {
    if (!confirm("Delete this recipe? It will also disappear from any planned meals.")) return;
    try {
      await api.deleteRecipe(id);
      onChanged();
    } catch (e) {
      setError((e as Error).message);
    }
  }

  if (recipes.length === 0) {
    return <p>No recipes yet — add one manually or import from a URL below.</p>;
  }

  return (
    <div>
      {error && <p className="error">{error}</p>}
      <ul className="recipe-list">
        {recipes.map((r) => {
          const full = expanded[r.id];
          return (
            <li key={r.id} className="recipe-list-item">
              <div className="recipe-list-row">
                <button className="link-button" onClick={() => toggle(r.id)}>
                  {full ? "▾" : "▸"} {r.title}
                </button>
                <span className="recipe-meta">
                  {r.servings} servings · {r.ingredient_count ?? "?"} ingredients
                  {r.source_site ? ` · from ${r.source_site}` : ""}
                </span>
                <button className="danger" onClick={() => remove(r.id)}>
                  Delete
                </button>
              </div>
              {full && (
                <div className="recipe-detail">
                  <h4>Ingredients</h4>
                  <ul>
                    {full.ingredients.map((ing) => (
                      <li key={ing.id}>{ing.raw_text}</li>
                    ))}
                  </ul>
                  {full.instructions && (
                    <>
                      <h4>Instructions</h4>
                      <p className="instructions">{full.instructions}</p>
                    </>
                  )}
                  {full.source_url && (
                    <p className="source-link">
                      Source:{" "}
                      <a href={full.source_url} target="_blank" rel="noreferrer">
                        {full.source_url}
                      </a>
                    </p>
                  )}
                </div>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
