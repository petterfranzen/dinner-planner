import { describe, it, expect } from "@jest/globals";
import {
  parseIngredientLine,
  normalizeIngredientName,
  categorize,
} from "../src/services/ingredientParser.js";

describe("parseIngredientLine - quantity, unit and name", () => {
  it("parses a no-space metric line", () => {
    expect(parseIngredientLine("100g plain flour")).toMatchObject({
      quantity: 100,
      unit: "g",
      name: "plain flour",
    });
  });

  it("parses a spaced metric line", () => {
    expect(parseIngredientLine("2 dl vetemjöl")).toMatchObject({
      quantity: 2,
      unit: "dl",
      name: "vetemjöl",
    });
  });

  it("parses simple and mixed fractions", () => {
    expect(parseIngredientLine("1/2 tsp salt")).toMatchObject({ quantity: 0.5, unit: "tsp" });
    expect(parseIngredientLine("1 1/2 cups flour")).toMatchObject({ quantity: 1.5, unit: "cup" });
  });

  it("parses unicode fractions, alone and mixed", () => {
    expect(parseIngredientLine("½ onion")).toMatchObject({ quantity: 0.5, unit: null, name: "onion" });
    expect(parseIngredientLine("1½ dl milk")).toMatchObject({ quantity: 1.5, unit: "dl" });
  });

  it("collapses a quantity range to its first number", () => {
    expect(parseIngredientLine("2-3 eggs")).toMatchObject({ quantity: 2, name: "eggs" });
    expect(parseIngredientLine("2 to 3 eggs")).toMatchObject({ quantity: 2, name: "eggs" });
  });

  it("leaves a line with no quantity unparsed but keeps the raw text", () => {
    const parsed = parseIngredientLine("salt and pepper to taste");
    expect(parsed.quantity).toBeNull();
    expect(parsed.unit).toBeNull();
    expect(parsed.rawText).toBe("salt and pepper to taste");
  });

  it("canonicalizes unit aliases to one spelling", () => {
    expect(parseIngredientLine("100 grams sugar").unit).toBe("g");
    expect(parseIngredientLine("2 kilograms potatoes").unit).toBe("kg");
    expect(parseIngredientLine("3 matskedar oil").unit).toBe("msk");
    expect(parseIngredientLine("2 tablespoons oil").unit).toBe("tbsp");
  });

  it("does not treat a non-unit word as a unit", () => {
    expect(parseIngredientLine("1 large egg")).toMatchObject({ quantity: 1, unit: null });
  });
});

describe("normalizeIngredientName", () => {
  it("lowercases, trims and drops parentheticals", () => {
    expect(normalizeIngredientName("  Onion (chopped) ")).toBe("onion");
  });

  it("merges common plurals to a singular", () => {
    expect(normalizeIngredientName("onions")).toBe("onion");
    expect(normalizeIngredientName("tomatoes")).toBe("tomato");
    expect(normalizeIngredientName("boxes")).toBe("box");
    expect(normalizeIngredientName("berries")).toBe("berry");
  });

  it("leaves singular words that end in s alone", () => {
    expect(normalizeIngredientName("asparagus")).toBe("asparagus");
    expect(normalizeIngredientName("hummus")).toBe("hummus");
    expect(normalizeIngredientName("couscous")).toBe("couscous");
  });
});

describe("categorize", () => {
  it("assigns known keywords to categories", () => {
    expect(categorize("onion")).toBe("Produce");
    expect(categorize("whole milk")).toBe("Dairy");
    expect(categorize("plain flour")).toBe("Bakery");
    expect(categorize("chicken breast")).toBe("Meat & Fish");
  });

  it("falls back to Other", () => {
    expect(categorize("unobtainium")).toBe("Other");
  });
});
