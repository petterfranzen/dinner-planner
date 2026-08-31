import { useState } from "react";
import { api } from "../api/client";

interface Props {
  onImported: () => void;
}

export function RecipeImport({ onImported }: Props) {
  const [url, setUrl] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setStatus(null);
    if (!url.trim()) return;
    setLoading(true);
    try {
      const recipe = await api.importRecipe(url.trim());
      setStatus(`Imported "${recipe.title}" (${recipe.ingredients.length} ingredients).`);
      setUrl("");
      onImported();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <form className="recipe-import" onSubmit={submit}>
      <h3>Import a recipe from a URL</h3>
      <p className="hint">
        Paste a single recipe link from BBC Good Food, Arla Köket (arla.se), or Apple News. This reads the
        structured recipe data the page already publishes for search engines — it only imports the one recipe you
        paste, nothing else on the site.
      </p>
      {error && <p className="error">{error}</p>}
      {status && <p className="success">{status}</p>}
      <div className="import-row">
        <input
          type="url"
          placeholder="https://www.bbcgoodfood.com/recipes/..."
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          required
        />
        <button type="submit" disabled={loading}>
          {loading ? "Importing…" : "Import"}
        </button>
      </div>
    </form>
  );
}
