import { describe, it, expect } from "@jest/globals";
import { aggregateIngredients } from "../src/services/aggregator.js";
import type { PlannedRecipe, RecipeForAggregation } from "../src/services/aggregator.js";
import type { RecipeIngredientRow } from "../src/types.js";

let nextId = 1;
function row(partial: Partial<RecipeIngredientRow> & { name: string }): RecipeIngredientRow {
  return {
    id: nextId++,
    recipe_id: partial.recipe_id ?? 1,
    position: 0,
    raw_text: partial.name,
    quantity: null,
    unit: null,
    category: "Other",
    ...partial,
  };
}

function recipe(ingredients: RecipeIngredientRow[], servings = 4): RecipeForAggregation {
  return { servings, ingredients };
}

function recipesById(entries: [number, RecipeForAggregation][]): Map<number, RecipeForAggregation> {
  return new Map(entries);
}

describe("aggregateIngredients - unit conversion", () => {
  it("merges grams and kilograms into the base unit", () => {
    const items = aggregateIngredients(
      [{ recipeId: 1, servingsOverride: null }],
      recipesById([
        [1, recipe([
          row({ name: "flour", quantity: 500, unit: "g", category: "Bakery" }),
          row({ name: "flour", quantity: 0.5, unit: "kg", category: "Bakery" }),
        ])],
      ]),
    );
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({ name: "flour", quantity: 1000, unit: "g" });
  });

  it("keeps a single metric unit as written", () => {
    const items = aggregateIngredients(
      [{ recipeId: 1, servingsOverride: null }],
      recipesById([[1, recipe([row({ name: "flour", quantity: 1.5, unit: "kg" })])]]),
    );
    expect(items[0]).toMatchObject({ quantity: 1.5, unit: "kg" });
  });

  it("converts ml, dl, l, msk and tsk into ml when they are mixed", () => {
    const items = aggregateIngredients(
      [{ recipeId: 1, servingsOverride: null }],
      recipesById([
        [1, recipe([
          row({ name: "milk", quantity: 1, unit: "dl" }),
          row({ name: "milk", quantity: 100, unit: "ml" }),
          row({ name: "milk", quantity: 2, unit: "msk" }),
          row({ name: "milk", quantity: 4, unit: "tsk" }),
        ])],
      ]),
    );
    // 100 + 100 + 30 + 20 = 250 ml
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({ quantity: 250, unit: "ml" });
  });

  it("keeps a lone spoon unit as written", () => {
    const items = aggregateIngredients(
      [{ recipeId: 1, servingsOverride: null }],
      recipesById([[1, recipe([row({ name: "olive oil", quantity: 2, unit: "msk" })])]]),
    );
    expect(items[0]).toMatchObject({ quantity: 2, unit: "msk" });
  });

  it("does not merge units from different families or unknown units", () => {
    const items = aggregateIngredients(
      [{ recipeId: 1, servingsOverride: null }],
      recipesById([
        [1, recipe([
          row({ name: "flour", quantity: 100, unit: "g" }),
          row({ name: "flour", quantity: 1, unit: "cup" }),
          row({ name: "flour", quantity: 50, unit: "ml" }),
        ])],
      ]),
    );
    const units = items.map((i) => i.unit).sort();
    expect(units).toEqual(["cup", "g", "ml"]);
    expect(items).toHaveLength(3);
  });
});

describe("aggregateIngredients - merging by name", () => {
  it("sums rows of the same ingredient and unit", () => {
    const items = aggregateIngredients(
      [{ recipeId: 1, servingsOverride: null }],
      recipesById([
        [1, recipe([
          row({ name: "onion", quantity: 1, unit: null, category: "Produce" }),
          row({ name: "onion", quantity: 2, unit: null, category: "Produce" }),
        ])],
      ]),
    );
    expect(items).toEqual([
      { name: "onion", quantity: 3, unit: null, category: "Produce", sources: ["onion"] },
    ]);
  });

  it("merges singular and plural names", () => {
    const items = aggregateIngredients(
      [{ recipeId: 1, servingsOverride: null }],
      recipesById([
        [1, recipe([
          row({ name: "Onions", quantity: 2, unit: null }),
          row({ name: "onion", quantity: 1, unit: null }),
          row({ name: "Tomatoes", quantity: 2, unit: null }),
          row({ name: "tomato", quantity: 3, unit: null }),
        ])],
      ]),
    );
    const byName = Object.fromEntries(items.map((i) => [i.name, i.quantity]));
    // first row's spelling is kept as the display name
    expect(byName["Onions"]).toBe(3);
    expect(items.filter((i) => i.name.toLowerCase().includes("tomato"))[0].quantity).toBe(5);
    expect(items).toHaveLength(2);
  });

  it("does not merge different ingredients", () => {
    const items = aggregateIngredients(
      [{ recipeId: 1, servingsOverride: null }],
      recipesById([
        [1, recipe([
          row({ name: "onion", quantity: 1 }),
          row({ name: "spring onion", quantity: 1 }),
        ])],
      ]),
    );
    expect(items).toHaveLength(2);
  });

  it("keeps rows with no quantity apart, one per distinct raw text, never summed", () => {
    const items = aggregateIngredients(
      [{ recipeId: 1, servingsOverride: null }],
      recipesById([
        [1, recipe([
          row({ name: "salt", raw_text: "salt", quantity: null, unit: null }),
          row({ name: "salt", raw_text: "salt", quantity: null, unit: null }),
          row({ name: "salt", raw_text: "a pinch of salt", quantity: null, unit: null }),
        ])],
      ]),
    );
    expect(items).toHaveLength(2);
    const pinch = items.find((i) => i.sources.includes("a pinch of salt"))!;
    expect(pinch.quantity).toBeNull();
    const plain = items.find((i) => i.sources.length === 1 && i.sources[0] === "salt")!;
    expect(plain.quantity).toBeNull();
  });

  it("collects every source line that fed a merged item", () => {
    const items = aggregateIngredients(
      [{ recipeId: 1, servingsOverride: null }],
      recipesById([
        [1, recipe([
          row({ name: "carrot", raw_text: "2 carrots", quantity: 2 }),
          row({ name: "carrot", raw_text: "1 carrot", quantity: 1 }),
        ])],
      ]),
    );
    expect(items[0].sources.sort()).toEqual(["1 carrot", "2 carrots"]);
  });
});

describe("aggregateIngredients - servings scaling", () => {
  it("scales a recipe's quantities to its servings override", () => {
    const items = aggregateIngredients(
      [{ recipeId: 1, servingsOverride: 2 }],
      recipesById([[1, recipe([row({ name: "egg", quantity: 4, unit: null })], 4)]]),
    );
    expect(items[0].quantity).toBe(2);
  });

  it("leaves quantities alone when there is no override", () => {
    const items = aggregateIngredients(
      [{ recipeId: 1, servingsOverride: null }],
      recipesById([[1, recipe([row({ name: "egg", quantity: 4, unit: null })], 4)]]),
    );
    expect(items[0].quantity).toBe(4);
  });
});

describe("aggregateIngredients - repeated meals (regression)", () => {
  it("counts a recipe planned for several meals once per meal", () => {
    const items = aggregateIngredients(
      [
        { recipeId: 1, servingsOverride: null },
        { recipeId: 1, servingsOverride: null },
      ],
      recipesById([[1, recipe([row({ name: "egg", quantity: 2, unit: null })], 2)]]),
    );
    expect(items).toHaveLength(1);
    expect(items[0].quantity).toBe(4);
  });

  it("applies each meal's own servings override", () => {
    const items = aggregateIngredients(
      [
        { recipeId: 1, servingsOverride: 2 },
        { recipeId: 1, servingsOverride: 6 },
      ],
      recipesById([[1, recipe([row({ name: "egg", quantity: 4, unit: null })], 4)]]),
    );
    // 4 * (2/4) + 4 * (6/4) = 2 + 6 = 8
    expect(items[0].quantity).toBe(8);
  });

  it("scales each meal independently across different recipes", () => {
    const items = aggregateIngredients(
      [
        { recipeId: 1, servingsOverride: null },
        { recipeId: 2, servingsOverride: 2 },
      ],
      recipesById([
        [1, recipe([row({ name: "flour", quantity: 1, unit: "kg", category: "Bakery" })], 4)],
        [2, recipe([row({ name: "flour", quantity: 250, unit: "g", category: "Bakery" })], 4)],
      ]),
    );
    // 1000 g + 250 * (2/4) = 1000 + 125 = 1125 g
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({ quantity: 1125, unit: "g" });
  });
});

describe("aggregateIngredients - rounding and edges", () => {
  it("rounds floating point sums to two decimals", () => {
    const items = aggregateIngredients(
      [{ recipeId: 1, servingsOverride: null }],
      recipesById([
        [1, recipe([
          row({ name: "stock", quantity: 0.1, unit: null }),
          row({ name: "stock", quantity: 0.2, unit: null }),
        ])],
      ]),
    );
    expect(items[0].quantity).toBe(0.3);
  });

  it("rounds repeating decimals", () => {
    const items = aggregateIngredients(
      [{ recipeId: 1, servingsOverride: null }],
      recipesById([
        [1, recipe([
          row({ name: "apple", quantity: 1 / 3, unit: null }),
          row({ name: "apple", quantity: 1 / 3, unit: null }),
          row({ name: "apple", quantity: 1 / 3, unit: null }),
        ])],
      ]),
    );
    expect(items[0].quantity).toBe(1);
  });

  it("returns an empty list for an empty plan", () => {
    expect(aggregateIngredients([], new Map())).toEqual([]);
  });

  it("skips a planned slot whose recipe has no ingredient rows", () => {
    const items = aggregateIngredients([{ recipeId: 99, servingsOverride: null }], new Map());
    expect(items).toEqual([]);
  });

  it("sorts by category then name", () => {
    const items = aggregateIngredients(
      [{ recipeId: 1, servingsOverride: null }],
      recipesById([
        [1, recipe([
          row({ name: "onion", quantity: 1, category: "Produce" }),
          row({ name: "milk", quantity: 1, category: "Dairy" }),
          row({ name: "apple", quantity: 1, category: "Produce" }),
        ])],
      ]),
    );
    expect(items.map((i) => `${i.category}/${i.name}`)).toEqual([
      "Dairy/milk",
      "Produce/apple",
      "Produce/onion",
    ]);
  });

  it("does not mangle a singular word that merely ends in s", () => {
    const items = aggregateIngredients(
      [{ recipeId: 1, servingsOverride: null }],
      recipesById([
        [1, recipe([
          row({ name: "Asparagus", quantity: 1 }),
          row({ name: "asparagus", quantity: 1 }),
        ])],
      ]),
    );
    expect(items).toHaveLength(1);
    expect(items[0].name).toBe("Asparagus");
    expect(items[0].quantity).toBe(2);
  });
});
