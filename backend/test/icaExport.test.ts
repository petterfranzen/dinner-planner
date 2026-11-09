import { describe, expect, it } from "@jest/globals";
import { toCsv, toPlainText } from "../src/services/icaExport.js";
import type { ShoppingListItem } from "../src/types.js";

const items: ShoppingListItem[] = [
  { name: "milk", quantity: 1.5, unit: "l", category: "Dairy", sources: ["1.5 l milk"] },
  { name: "onion", quantity: 2, unit: null, category: "Produce", sources: ["2 onions"] },
  { name: "salt", quantity: null, unit: null, category: "Pantry", sources: ["salt to taste"] },
];

describe("toPlainText", () => {
  it("groups by category with a checkbox per item", () => {
    const text = toPlainText(items);
    expect(text).toContain("Shopping list");
    expect(text).toContain("Dairy");
    expect(text).toContain("[ ] milk  (1.50 l)");
    expect(text).toContain("[ ] onion  (2)");
    expect(text).toContain("[ ] salt");
    expect(text.indexOf("Dairy")).toBeLessThan(text.indexOf("Pantry"));
    expect(text.indexOf("Pantry")).toBeLessThan(text.indexOf("Produce"));
  });

  it("ends with exactly one newline", () => {
    const text = toPlainText(items);
    expect(text.endsWith("\n")).toBe(true);
    expect(text.endsWith("\n\n")).toBe(false);
  });

  it("handles an empty list", () => {
    expect(toPlainText([])).toBe("Shopping list\n");
  });
});

describe("toCsv", () => {
  it("writes a header and one row per item", () => {
    const csv = toCsv(items);
    const lines = csv.trimEnd().split("\n");
    expect(lines[0]).toBe("Category,Item,Quantity,Unit");
    expect(lines).toContain("Dairy,milk,1.5,l");
    expect(lines).toContain("Produce,onion,2,");
    expect(lines).toContain("Pantry,salt,,");
    expect(lines).toHaveLength(4);
  });

  it("quotes values containing commas or quotes", () => {
    const csv = toCsv([
      { name: 'beans, "black"', quantity: 1, unit: null, category: "Pantry", sources: [] },
    ]);
    expect(csv).toContain('Pantry,"beans, ""black""",1,');
  });

  it("handles an empty list", () => {
    expect(toCsv([])).toBe("Category,Item,Quantity,Unit\n");
  });
});
