import { Router } from "express";
import { db } from "../db.js";
import { categorize, parseIngredientLine } from "../services/ingredientParser.js";
import { importRecipeFromUrl, RecipeImportError } from "../services/recipeImport.js";
import type { ParsedIngredient, RecipeIngredientRow, RecipeRow } from "../types.js";

export const recipesRouter = Router();

interface ManualIngredientInput {
  rawText?: string;
  quantity?: number | null;
  unit?: string | null;
  name: string;
}

/** What gets stored for one recipe, whether typed in or imported. */
interface NewRecipe {
  title: string;
  servings: number;
  instructions: string;
  ingredients: ParsedIngredient[];
  sourceUrl: string | null;
  sourceSite: string | null;
}

function insertRecipe(recipe: NewRecipe): number {
  const { title, servings, instructions, ingredients, sourceUrl, sourceSite } = recipe;
  const insertRecipeStmt = db.prepare(
    `INSERT INTO recipe (title, servings, instructions, source_url, source_site)
     VALUES (?, ?, ?, ?, ?)`,
  );
  const insertIngredientStmt = db.prepare(
    `INSERT INTO recipe_ingredient (recipe_id, position, raw_text, quantity, unit, name, category)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
  );

  const txn = db.transaction(() => {
    const info = insertRecipeStmt.run(title, servings, instructions, sourceUrl, sourceSite);
    const recipeId = Number(info.lastInsertRowid);
    ingredients.forEach((ing, index) => {
      insertIngredientStmt.run(
        recipeId,
        index,
        ing.rawText,
        ing.quantity,
        ing.unit,
        ing.name,
        ing.category,
      );
    });
    return recipeId;
  });

  return txn();
}

function getRecipeWithIngredients(id: number) {
  const recipe = db.prepare(`SELECT * FROM recipe WHERE id = ?`).get(id) as RecipeRow | undefined;
  if (!recipe) return null;
  const ingredients = db
    .prepare(`SELECT * FROM recipe_ingredient WHERE recipe_id = ? ORDER BY position`)
    .all(id) as RecipeIngredientRow[];
  return { ...recipe, ingredients };
}

recipesRouter.get("/", (_req, res) => {
  const recipes = db
    .prepare(
      `SELECT r.*, COUNT(ri.id) AS ingredient_count
       FROM recipe r
       LEFT JOIN recipe_ingredient ri ON ri.recipe_id = r.id
       GROUP BY r.id
       ORDER BY r.created_at DESC`,
    )
    .all();
  res.json(recipes);
});

recipesRouter.get("/:id", (req, res) => {
  const id = Number(req.params.id);
  const recipe = getRecipeWithIngredients(id);
  if (!recipe) return res.status(404).json({ error: "Recipe not found" });
  res.json(recipe);
});

interface ManualRecipeBody {
  title?: string;
  servings?: number;
  instructions?: string;
  ingredients?: ManualIngredientInput[];
}

function isBlank(text: string | undefined): text is undefined {
  return !text || !text.trim();
}

function manualRecipeError(body: ManualRecipeBody): string | null {
  if (isBlank(body.title)) return "title is required";
  if (!Array.isArray(body.ingredients)) return "at least one ingredient is required";
  if (body.ingredients.length === 0) return "at least one ingredient is required";
  return null;
}

function toParsedIngredient(ing: ManualIngredientInput): ParsedIngredient {
  if (isBlank(ing.name)) {
    throw Object.assign(new Error("each ingredient needs a name"), { status: 400 });
  }
  return {
    rawText: ing.rawText?.trim() || describeIngredient(ing),
    quantity: typeof ing.quantity === "number" ? ing.quantity : null,
    unit: ing.unit?.trim() || null,
    name: ing.name.trim(),
    category: categorize(ing.name),
  };
}

function servingsOrDefault(servings: number | undefined): number {
  return servings && servings > 0 ? servings : 4;
}

function manualRecipe(body: ManualRecipeBody, ingredients: ParsedIngredient[]): NewRecipe {
  return {
    title: (body.title as string).trim(),
    servings: servingsOrDefault(body.servings),
    instructions: body.instructions?.trim() ?? "",
    ingredients,
    sourceUrl: null,
    sourceSite: null,
  };
}

recipesRouter.post("/", (req, res) => {
  const body = req.body as ManualRecipeBody;
  const error = manualRecipeError(body);
  if (error) return res.status(400).json({ error });

  const ingredients = (body.ingredients as ManualIngredientInput[]).map(toParsedIngredient);

  try {
    const id = insertRecipe(manualRecipe(body, ingredients));
    res.status(201).json(getRecipeWithIngredients(id));
  } catch (err) {
    const status = (err as { status?: number }).status ?? 500;
    res.status(status).json({ error: (err as Error).message });
  }
});

function describeIngredient(ing: ManualIngredientInput): string {
  return [ing.quantity, ing.unit, ing.name].filter(Boolean).join(" ");
}

recipesRouter.post("/import", async (req, res) => {
  const url = (req.body as { url?: string }).url;
  if (isBlank(url)) {
    return res.status(400).json({ error: "url is required" });
  }
  try {
    const imported = await importRecipeFromUrl(url.trim());
    const id = insertRecipe(imported);
    res.status(201).json(getRecipeWithIngredients(id));
  } catch (err) {
    if (err instanceof RecipeImportError) {
      return res.status(err.status).json({ error: err.message });
    }
    console.error("Unexpected import error:", err);
    res.status(500).json({ error: "Unexpected error importing recipe." });
  }
});

recipesRouter.delete("/:id", (req, res) => {
  const id = Number(req.params.id);
  const info = db.prepare(`DELETE FROM recipe WHERE id = ?`).run(id);
  if (info.changes === 0) return res.status(404).json({ error: "Recipe not found" });
  res.status(204).send();
});

// Lets the manual-add form show a live preview of how a pasted free-text
// ingredient line ("2 dl mjölk") would be parsed, before the recipe is saved.
recipesRouter.post("/ingredients/parse-preview", (req, res) => {
  const text = (req.body as { text?: string }).text ?? "";
  res.json(parseIngredientLine(text));
});
