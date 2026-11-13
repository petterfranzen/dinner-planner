import { afterEach, beforeEach, describe, expect, it, jest } from "@jest/globals";
import {
  assertSupportedUrl,
  importRecipeFromUrl,
  RecipeImportError,
} from "../src/services/recipeImport.js";

// No network: every test stubs global fetch with a canned HTML page.
const RECIPE_JSON = JSON.stringify({
  "@context": "https://schema.org",
  "@type": "Recipe",
  name: "Test pancakes",
  recipeYield: "4",
  recipeIngredient: ["2 dl flour", "3 dl milk"],
  recipeInstructions: [{ "@type": "HowToStep", text: "Mix it all." }],
});

function pageWithLdJson(typeAttribute: string, json = RECIPE_JSON): string {
  return `<!doctype html><html><head><script type="${typeAttribute}">${json}</script></head><body>ok</body></html>`;
}

const realFetch = globalThis.fetch;

function stubFetch(html: string, status = 200) {
  const fetchMock = jest.fn(async () => new Response(html, { status }));
  globalThis.fetch = fetchMock as unknown as typeof fetch;
  return fetchMock;
}

beforeEach(() => {
  jest.spyOn(console, "log").mockImplementation(() => undefined);
});

afterEach(() => {
  jest.restoreAllMocks();
  globalThis.fetch = realFetch;
});

describe("assertSupportedUrl", () => {
  it("accepts http and https", () => {
    expect(assertSupportedUrl("https://www.bbcgoodfood.com/recipes/x").protocol).toBe("https:");
    expect(assertSupportedUrl("http://arla.se/recept/x/").protocol).toBe("http:");
  });

  it.each(["ftp://bbcgoodfood.com/x", "file:///etc/passwd", "javascript:alert(1)"])(
    "rejects the non-http(s) scheme %s",
    (url) => {
      expect(() => assertSupportedUrl(url)).toThrow(/only http\/https/i);
    },
  );

  it("rejects something that is not a URL at all", () => {
    expect(() => assertSupportedUrl("not a url")).toThrow(RecipeImportError);
  });

  it.each([
    "https://bbcgoodfood.com/recipes/x",
    "https://www.bbcgoodfood.com/recipes/x",
    "https://arla.se/recept/x",
    "https://apple.news/abc",
  ])("accepts the allowlisted host %s", (url) => {
    expect(() => assertSupportedUrl(url)).not.toThrow();
  });

  it.each([
    "https://evil.com/recipes/x",
    "https://bbcgoodfood.com.evil.com/x",
    "https://notbbcgoodfood.com/x",
    "https://apple.news.evil.com/x",
  ])("rejects the off-allowlist host %s", (url) => {
    expect(() => assertSupportedUrl(url)).toThrow(/only supports links from/i);
  });
});

describe("importRecipeFromUrl", () => {
  it("reads a normal application/ld+json block", async () => {
    stubFetch(pageWithLdJson("application/ld+json"));
    const recipe = await importRecipeFromUrl("https://www.bbcgoodfood.com/recipes/x");
    expect(recipe.title).toBe("Test pancakes");
    expect(recipe.servings).toBe(4);
    expect(recipe.ingredients).toHaveLength(2);
    expect(recipe.instructions).toBe("Mix it all.");
    expect(recipe.sourceSite).toBe("bbcgoodfood.com");
  });

  it("reads the entity-encoded application/ld&#x2B;json type arla.se emits", async () => {
    stubFetch(pageWithLdJson("application/ld&#x2B;json"));
    const recipe = await importRecipeFromUrl("https://arla.se/recept/pannkaka/");
    expect(recipe.title).toBe("Test pancakes");
    expect(recipe.ingredients.map((i) => i.name)).toEqual(["flour", "milk"]);
  });

  it("throws a clear 422 when the page has no recipe data", async () => {
    stubFetch("<!doctype html><html><body>nothing here</body></html>");
    const error = await importRecipeFromUrl("https://www.bbcgoodfood.com/recipes/x").catch(
      (e: unknown) => e,
    );
    expect(error).toBeInstanceOf(RecipeImportError);
    expect((error as RecipeImportError).status).toBe(422);
    expect((error as Error).message).toMatch(/could not find recipe data/i);
  });

  it("throws a 502 when the page cannot be fetched", async () => {
    globalThis.fetch = jest.fn(
      async () => new Response("nope", { status: 503 }),
    ) as unknown as typeof fetch;
    await expect(importRecipeFromUrl("https://arla.se/recept/x/")).rejects.toMatchObject({
      status: 502,
    });
  });
});
