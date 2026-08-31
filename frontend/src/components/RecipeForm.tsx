import { useState } from "react";
import { api } from "../api/client";

interface IngredientRow {
  quantity: string;
  unit: string;
  name: string;
}

const emptyRow = (): IngredientRow => ({ quantity: "", unit: "", name: "" });

interface Props {
  onCreated: () => void;
}

export function RecipeForm({ onCreated }: Props) {
  const [title, setTitle] = useState("");
  const [servings, setServings] = useState(4);
  const [instructions, setInstructions] = useState("");
  const [rows, setRows] = useState<IngredientRow[]>([emptyRow(), emptyRow(), emptyRow()]);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  function updateRow(index: number, field: keyof IngredientRow, value: string) {
    setRows((prev) => prev.map((r, i) => (i === index ? { ...r, [field]: value } : r)));
  }

  function addRow() {
    setRows((prev) => [...prev, emptyRow()]);
  }

  function removeRow(index: number) {
    setRows((prev) => prev.filter((_, i) => i !== index));
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    const ingredients = rows
      .filter((r) => r.name.trim())
      .map((r) => ({
        quantity: r.quantity.trim() ? Number(r.quantity.trim().replace(",", ".")) : null,
        unit: r.unit.trim() || null,
        name: r.name.trim(),
      }));

    if (!title.trim() || ingredients.length === 0) {
      setError("Give the recipe a title and at least one ingredient.");
      return;
    }

    setSaving(true);
    try {
      await api.createRecipe({ title: title.trim(), servings, instructions, ingredients });
      setTitle("");
      setServings(4);
      setInstructions("");
      setRows([emptyRow(), emptyRow(), emptyRow()]);
      onCreated();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <form className="recipe-form" onSubmit={submit}>
      <h3>Add a recipe manually</h3>
      {error && <p className="error">{error}</p>}
      <label>
        Title
        <input value={title} onChange={(e) => setTitle(e.target.value)} required />
      </label>
      <label>
        Servings
        <input
          type="number"
          min={1}
          value={servings}
          onChange={(e) => setServings(Number(e.target.value) || 1)}
        />
      </label>

      <h4>Ingredients</h4>
      {rows.map((row, i) => (
        <div className="ingredient-row" key={i}>
          <input
            placeholder="qty"
            className="ingredient-qty"
            value={row.quantity}
            onChange={(e) => updateRow(i, "quantity", e.target.value)}
          />
          <input
            placeholder="unit"
            className="ingredient-unit"
            value={row.unit}
            onChange={(e) => updateRow(i, "unit", e.target.value)}
          />
          <input
            placeholder="ingredient name"
            className="ingredient-name"
            value={row.name}
            onChange={(e) => updateRow(i, "name", e.target.value)}
          />
          <button type="button" className="link-button" onClick={() => removeRow(i)}>
            ✕
          </button>
        </div>
      ))}
      <button type="button" onClick={addRow}>
        + add ingredient
      </button>

      <label>
        Instructions
        <textarea rows={5} value={instructions} onChange={(e) => setInstructions(e.target.value)} />
      </label>

      <button type="submit" disabled={saving}>
        {saving ? "Saving…" : "Save recipe"}
      </button>
    </form>
  );
}
