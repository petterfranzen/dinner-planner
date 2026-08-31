import type { ShoppingListItem } from "../types.js";

// "Export to ICA" - see README for the research behind this. Short version:
// ICA Sverige has no public/documented consumer API or import format for
// shopping lists (the only "API" is an unofficial, reverse-engineered one
// that requires a real ICA account's login credentials and has reportedly
// broken before after ICA changed things - not something to build a
// household app around). There's also no known ICA app URL scheme or file
// import for shopping lists.
//
// So instead of faking an "ICA integration", this produces a clean,
// categorized plain-text and CSV export a person can realistically use:
// copy/paste into notes, or open the ICA app and search each line by name
// (which is exactly how ICA's own app is used today when following any
// paper or third-party list).

function formatQuantity(item: ShoppingListItem): string {
  if (item.quantity == null) return "";
  const q = Number.isInteger(item.quantity) ? String(item.quantity) : item.quantity.toFixed(2);
  return item.unit ? `${q} ${item.unit}` : q;
}

export function toPlainText(items: ShoppingListItem[]): string {
  const byCategory = new Map<string, ShoppingListItem[]>();
  for (const item of items) {
    const list = byCategory.get(item.category) ?? [];
    list.push(item);
    byCategory.set(item.category, list);
  }

  const lines: string[] = ["Shopping list", ""];
  for (const [category, categoryItems] of [...byCategory.entries()].sort((a, b) => a[0].localeCompare(b[0]))) {
    lines.push(`${category}`, "-".repeat(category.length));
    for (const item of categoryItems) {
      const qty = formatQuantity(item);
      lines.push(`[ ] ${item.name}${qty ? `  (${qty})` : ""}`);
    }
    lines.push("");
  }
  return lines.join("\n").trim() + "\n";
}

function csvEscape(value: string): string {
  if (/[",\n]/.test(value)) {
    return `"${value.replace(/"/g, '""')}"`;
  }
  return value;
}

export function toCsv(items: ShoppingListItem[]): string {
  const header = "Category,Item,Quantity,Unit";
  const rows = items.map((item) =>
    [
      csvEscape(item.category),
      csvEscape(item.name),
      item.quantity != null ? String(item.quantity) : "",
      item.unit ?? "",
    ].join(","),
  );
  return [header, ...rows].join("\n") + "\n";
}
