import { useEffect, useMemo, useState } from "react";
import { api } from "../api/client";
import type { ShoppingListItem } from "../types";

interface Props {
  weekStart: string;
}

function formatQty(item: ShoppingListItem): string {
  if (item.quantity == null) return "";
  const q = Number.isInteger(item.quantity) ? String(item.quantity) : item.quantity.toFixed(2);
  return item.unit ? `${q} ${item.unit}` : q;
}

export function ShoppingList({ weekStart }: Props) {
  const [items, setItems] = useState<ShoppingListItem[]>([]);
  const [checked, setChecked] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [copyStatus, setCopyStatus] = useState<string | null>(null);

  useEffect(() => {
    setLoading(true);
    setChecked(new Set());
    api
      .getShoppingList(weekStart)
      .then((res) => setItems(res.items))
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, [weekStart]);

  const grouped = useMemo(() => {
    const map = new Map<string, ShoppingListItem[]>();
    for (const item of items) {
      const list = map.get(item.category) ?? [];
      list.push(item);
      map.set(item.category, list);
    }
    return [...map.entries()].sort((a, b) => a[0].localeCompare(b[0]));
  }, [items]);

  function toggle(key: string) {
    setChecked((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  async function copyToClipboard() {
    const text = grouped
      .map(
        ([category, categoryItems]) =>
          `${category}\n${categoryItems.map((i) => `- ${i.name}${formatQty(i) ? ` (${formatQty(i)})` : ""}`).join("\n")}`,
      )
      .join("\n\n");
    try {
      await navigator.clipboard.writeText(text);
      setCopyStatus("Copied!");
    } catch {
      setCopyStatus("Could not copy — select and copy manually.");
    }
    setTimeout(() => setCopyStatus(null), 2000);
  }

  if (loading) return <p>Loading shopping list…</p>;
  if (error) return <p className="error">{error}</p>;
  if (items.length === 0) {
    return <p>No recipes planned for this week yet — assign recipes in the plan above to build a shopping list.</p>;
  }

  return (
    <div>
      <div className="shopping-list-actions">
        <button onClick={copyToClipboard}>Copy list</button>
        <a href={api.exportUrl(weekStart, "txt")}>
          <button type="button">Download .txt</button>
        </a>
        <a href={api.exportUrl(weekStart, "csv")}>
          <button type="button">Download .csv</button>
        </a>
        {copyStatus && <span className="copy-status">{copyStatus}</span>}
      </div>
      <p className="hint">
        No official ICA integration exists (see README) — use these to paste into notes or search item-by-item in
        the ICA app.
      </p>
      {grouped.map(([category, categoryItems]) => (
        <div className="shopping-category" key={category}>
          <h3>{category}</h3>
          <ul>
            {categoryItems.map((item) => {
              const key = `${category}|${item.name}|${item.unit ?? ""}`;
              return (
                <li key={key} className={checked.has(key) ? "checked" : ""}>
                  <label>
                    <input type="checkbox" checked={checked.has(key)} onChange={() => toggle(key)} />
                    {item.name}
                    {formatQty(item) && <span className="qty"> — {formatQty(item)}</span>}
                  </label>
                </li>
              );
            })}
          </ul>
        </div>
      ))}
    </div>
  );
}
