import { jest, describe, it, expect, beforeEach } from "@jest/globals";
import type { RecipeIngredientRow } from "../src/types.js";

// The DB module is mocked: these tests exercise the query wiring (which
// recipes are asked for, and how rows are handed to the aggregator), not
// sqlite itself. Native sqlite can't be built in every environment.
const all = jest.fn<() => unknown[]>();
const prepare = jest.fn<(sql: string) => { all: typeof all }>(() => ({ all }));

jest.unstable_mockModule("../src/db.js", () => ({ db: { prepare } }));

const { buildShoppingList } = await import("../src/services/shoppingList.js");

type Row = RecipeIngredientRow & { recipe_servings: number };

function ingredientRow(partial: Partial<Row> & { recipe_id: number; name: string }): Row {
  return {
    id: 1,
    position: 0,
    raw_text: partial.name,
    quantity: null,
    unit: null,
    category: "Other",
    recipe_servings: 2,
    ...partial,
  };
}

describe("buildShoppingList - query wiring", () => {
  beforeEach(() => {
    prepare.mockClear();
    all.mockReset();
  });

  it("asks the DB for each distinct recipe once", () => {
    all.mockReturnValue([
      ingredientRow({ recipe_id: 1, name: "eggs", quantity: 2, raw_text: "2 eggs" }),
    ]);

    buildShoppingList([
      { recipeId: 1, servingsOverride: null },
      { recipeId: 1, servingsOverride: null },
      { recipeId: 2, servingsOverride: null },
    ]);

    expect(prepare).toHaveBeenCalledTimes(1);
    const sql = prepare.mock.calls[0][0];
    expect(sql).toContain("WHERE ri.recipe_id IN (?,?)");
    expect(all).toHaveBeenCalledWith(1, 2);
  });

  it("counts a recipe planned in two meals twice (regression)", () => {
    all.mockReturnValue([
      ingredientRow({ recipe_id: 1, name: "eggs", quantity: 2, raw_text: "2 eggs", recipe_servings: 2 }),
    ]);

    const items = buildShoppingList([
      { recipeId: 1, servingsOverride: null },
      { recipeId: 1, servingsOverride: null },
    ]);

    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({ name: "eggs", quantity: 4 });
  });

  it("returns an empty list without touching the DB when nothing is planned", () => {
    expect(buildShoppingList([])).toEqual([]);
    expect(prepare).not.toHaveBeenCalled();
  });
});
