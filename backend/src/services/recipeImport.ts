import { duringPhase } from "../phase.js";
import { parseIngredientLine } from "./ingredientParser.js";
import type { ParsedIngredient } from "../types.js";

// One-URL-at-a-time personal recipe import. This deliberately:
//   - only accepts a single URL per call (no batch/list input anywhere in
//     the API)
//   - only reads the schema.org/Recipe JSON-LD a page *already* publishes
//     for search engines and recipe apps to consume (the same structured
//     data Google Rich Results / Paprika / Mealie read) - it never scrapes
//     arbitrary HTML as a fallback
//   - is restricted to a small allowlist of sites the household actually
//     uses, both to keep this obviously a personal clipper (not a general
//     purpose fetcher) and to avoid this becoming an SSRF-style "fetch any
//     URL the server can reach" endpoint
//   - stores only the one recipe the person pasted, not the site's catalog

const ALLOWED_HOSTS = ["bbcgoodfood.com", "arla.se", "apple.news"];

export class RecipeImportError extends Error {
  status: number;
  constructor(message: string, status = 422) {
    super(message);
    this.status = status;
  }
}

function isAllowedHost(hostname: string): boolean {
  const h = hostname.toLowerCase().replace(/^www\./, "");
  return ALLOWED_HOSTS.some((allowed) => h === allowed || h.endsWith(`.${allowed}`));
}

export function assertSupportedUrl(rawUrl: string): URL {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    throw new RecipeImportError("That doesn't look like a valid URL.", 400);
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") {
    throw new RecipeImportError("Only http/https URLs are supported.", 400);
  }
  if (!isAllowedHost(url.hostname)) {
    throw new RecipeImportError(
      `Import only supports links from ${ALLOWED_HOSTS.join(", ")} for now. ` +
        `Got: ${url.hostname}. Add the recipe manually instead.`,
      400,
    );
  }
  return url;
}

// Matches <script type="application/ld+json">...</script>, tolerating the
// "+" being HTML-entity-encoded (arla.se emits type="application/ld&#x2B;json",
// which a plain literal-"+" regex silently misses - found while testing
// against a real Arla Köket page).
const LD_JSON_SCRIPT =
  /<script[^>]+type\s*=\s*(["'])application\/ld(?:\+|&#x2b;|&#43;|&plus;)json\1[^>]*>([\s\S]*?)<\/script>/gi;

type JsonLdValue = Record<string, unknown> | JsonLdValue[];

function flattenLdJsonBlocks(html: string): Record<string, unknown>[] {
  const out: Record<string, unknown>[] = [];
  for (const match of html.matchAll(LD_JSON_SCRIPT)) {
    const raw = match[2].trim();
    if (!raw) continue;
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      continue; // malformed block on the page - skip, don't fail the whole import
    }
    flattenInto(parsed as JsonLdValue, out);
  }
  return out;
}

function flattenInto(value: JsonLdValue, out: Record<string, unknown>[]): void {
  if (Array.isArray(value)) {
    for (const item of value) flattenInto(item, out);
    return;
  }
  if (value && typeof value === "object") {
    out.push(value);
    const graph = (value as Record<string, unknown>)["@graph"];
    if (Array.isArray(graph)) {
      flattenInto(graph as JsonLdValue, out);
    }
  }
}

function hasType(obj: Record<string, unknown>, type: string): boolean {
  const t = obj["@type"];
  if (typeof t === "string") return t === type;
  if (Array.isArray(t)) return t.includes(type);
  return false;
}

function findRecipeNode(nodes: Record<string, unknown>[]): Record<string, unknown> | null {
  return nodes.find((n) => hasType(n, "Recipe")) ?? null;
}

function toStringArray(value: unknown): string[] {
  if (value == null) return [];
  if (typeof value === "string") return [value];
  if (Array.isArray(value)) return value.flatMap(toStringArray);
  return [];
}

/** Flattens schema.org recipeInstructions (strings, HowToStep, HowToSection, or one big string) into an ordered list of step texts. */
function extractInstructions(value: unknown): string[] {
  if (value == null) return [];
  if (typeof value === "string") {
    // Some sites put the whole method as one newline/HTML-separated string.
    return value
      .split(/\r?\n|<\/p>|<br\s*\/?>/i)
      .map((s) => s.replace(/<[^>]+>/g, "").trim())
      .filter(Boolean);
  }
  if (Array.isArray(value)) {
    return value.flatMap(extractInstructions);
  }
  if (typeof value === "object") {
    const obj = value as Record<string, unknown>;
    if (hasType(obj, "HowToSection") && Array.isArray(obj.itemListElement)) {
      const heading = typeof obj.name === "string" ? [`${obj.name}:`] : [];
      return [...heading, ...extractInstructions(obj.itemListElement)];
    }
    if (typeof obj.text === "string") return [obj.text.trim()];
    if (typeof obj.name === "string") return [obj.name.trim()];
  }
  return [];
}

function extractServings(value: unknown): number {
  const candidates = toStringArray(value);
  for (const c of candidates) {
    const match = c.match(/\d+(?:[.,]\d+)?/);
    if (match) return Number(match[0].replace(",", "."));
  }
  if (typeof value === "number" && Number.isFinite(value)) return value;
  return 4; // reasonable default when the site doesn't say
}

export interface ImportedRecipe {
  title: string;
  servings: number;
  instructions: string;
  ingredients: ParsedIngredient[];
  sourceUrl: string;
  sourceSite: string;
}

export async function importRecipeFromUrl(rawUrl: string): Promise<ImportedRecipe> {
  const url = assertSupportedUrl(rawUrl);
  return duringPhase(`importing a recipe from ${url.hostname}`, () => fetchAndParse(url, rawUrl));
}

// rawUrl is carried through rather than re-derived from `url`: it's what
// gets stored as sourceUrl, and URL parsing normalises things (trailing
// slashes, default ports, escaping) that would otherwise silently change
// what the recipe records as its source.
async function fetchAndParse(url: URL, rawUrl: string): Promise<ImportedRecipe> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15_000);
  let html: string;
  try {
    const res = await fetch(url, {
      redirect: "follow", // needed for apple.news short links, which 30x to the actual article
      signal: controller.signal,
      headers: {
        // A plain fetch UA gets blocked/soft-blocked by some sites; a normal
        // browser UA is enough to get the same HTML a person's browser sees.
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36",
        Accept: "text/html,application/xhtml+xml",
      },
    });
    if (!res.ok) {
      throw new RecipeImportError(
        `Could not fetch that page (HTTP ${res.status}). It may have moved or be blocking automated requests.`,
        502,
      );
    }
    html = await res.text();
  } catch (err) {
    if (err instanceof RecipeImportError) throw err;
    throw new RecipeImportError(
      "Could not reach that URL. Check the link and your internet connection.",
      502,
    );
  } finally {
    clearTimeout(timeout);
  }

  const nodes = flattenLdJsonBlocks(html);
  const recipeNode = findRecipeNode(nodes);
  if (!recipeNode) {
    throw new RecipeImportError(
      "Could not find recipe data (schema.org/Recipe structured data) on that page. " +
        "This site may not publish it, or the page may not actually be a single recipe. " +
        "Try adding the recipe manually instead.",
      422,
    );
  }

  const title = typeof recipeNode.name === "string" ? recipeNode.name : "Imported recipe";
  const ingredientLines = toStringArray(recipeNode.recipeIngredient ?? recipeNode.ingredients);
  if (ingredientLines.length === 0) {
    throw new RecipeImportError(
      "Found a recipe on that page, but it has no ingredient list we could read.",
      422,
    );
  }
  const ingredients = ingredientLines.map(parseIngredientLine);
  const instructions = extractInstructions(recipeNode.recipeInstructions).join("\n");
  const servings = extractServings(recipeNode.recipeYield);

  return {
    title,
    servings,
    instructions,
    ingredients,
    sourceUrl: rawUrl,
    sourceSite: url.hostname.replace(/^www\./, ""),
  };
}
