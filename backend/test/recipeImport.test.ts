import { describe, it, expect, beforeAll, afterAll, jest } from "@jest/globals";
import {
  assertSupportedUrl,
  assertSafeRedirectUrl,
  isBlockedHost,
  importRecipeFromUrl,
  RecipeImportError,
  type FetchLike,
  type FetchResponse,
  type HostResolver,
} from "../src/services/recipeImport.js";

// No network is touched: every test injects a fake fetch and a fake DNS
// resolver, so these run offline and deterministically.
const PUBLIC_IP = "93.184.216.34";
const publicResolver: HostResolver = async () => [PUBLIC_IP];

function response(
  body: string,
  init: { status?: number; headers?: Record<string, string> } = {},
): Response {
  return new Response(body, {
    status: init.status ?? 200,
    headers: { "content-type": "text/html; charset=utf-8", ...(init.headers ?? {}) },
  });
}

function redirect(location: string, status = 302): Response {
  return new Response(null, { status, headers: { location } });
}

/** A fetch that hands back the queued responses in order. */
function queuedFetch(responses: Response[]): FetchLike {
  let i = 0;
  return async () => {
    if (i >= responses.length) throw new Error("fetch called more times than the test queued");
    return responses[i++];
  };
}

const RECIPE_JSON = JSON.stringify({
  "@context": "https://schema.org",
  "@type": "Recipe",
  name: "Pannkaka",
  recipeYield: "4",
  recipeIngredient: ["2 dl vetemjöl", "3 dl mjölk"],
  recipeInstructions: [{ "@type": "HowToStep", text: "Vispa ihop allt." }],
});

function pageWithLdJson(typeAttribute: string, json = RECIPE_JSON): string {
  return `<!doctype html><html><head><script type="${typeAttribute}">${json}</script></head><body>ok</body></html>`;
}

// ---------------------------------------------------------------------------
// The importer emits a phase marker per call by design (docker-monitor reads
// them); silence that one log so the test output stays readable.
beforeAll(() => {
  jest.spyOn(console, "log").mockImplementation(() => undefined);
});
afterAll(() => {
  jest.restoreAllMocks();
});


describe("assertSupportedUrl - scheme checks", () => {
  it("accepts http and https", () => {
    expect(assertSupportedUrl("https://www.bbcgoodfood.com/recipes/easy-pancakes").protocol).toBe(
      "https:",
    );
    expect(assertSupportedUrl("http://arla.se/recept/pannkaka/").protocol).toBe("http:");
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
});

describe("assertSupportedUrl - host allowlist", () => {
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
    "https://bbcgoodfood.com.evil.com/x", // suffix spoof
    "https://notbbcgoodfood.com/x", // substring spoof
    "https://apple.news.evil.com/x",
  ])("rejects the off-allowlist host %s", (url) => {
    expect(() => assertSupportedUrl(url)).toThrow(/only supports links from/i);
  });
});

describe("assertSupportedUrl - private, loopback and link-local targets", () => {
  it.each([
    "http://127.0.0.1/",
    "http://127.1.2.3/",
    "http://localhost/",
    "http://foo.localhost/",
    "http://0.0.0.0/",
    "http://10.0.0.5/",
    "http://172.16.0.9/",
    "http://172.31.255.255/",
    "http://192.168.1.1/",
    "http://100.64.0.1/", // CGNAT
    "http://169.254.169.254/latest/meta-data/", // cloud metadata
    "http://[::1]/",
    "http://[fe80::1]/",
    "http://[fe90::1]/", // link-local is the whole fe80::/10, not just "fe80"
    "http://[febf::1]/",
    "http://[fec0::1]/", // deprecated site-local, still not globally routable
    "http://[fd00::1]/",
    "http://[::ffff:169.254.169.254]/", // IPv4-mapped metadata endpoint
  ])("blocks the private target %s", (url) => {
    expect(() => assertSupportedUrl(url)).toThrow(/private or internal/i);
  });

  // The rule this guard implements: a host is blocked when the address it
  // points at is loopback, unspecified, link-local (fe80::/10), deprecated
  // site-local (fec0::/10), unique-local (fc00::/7), multicast (ff00::/8), or
  // an IPv4-mapped/compatible form whose embedded IPv4 is itself private.
  // Everything else - a genuinely globally routable address - is left alone.
  it("blocks the whole fe80::/10 link-local range, not just the fe80 prefix", () => {
    for (const host of ["fe80::1", "fe9a::1", "fe90::1", "febf::1", "fe80::abcd:1:2:3"]) {
      expect(isBlockedHost(host)).toBe(true);
    }
  });

  it("blocks the other non-public IPv6 ranges and the unspecified address", () => {
    for (const host of ["::", "::1", "fc00::1", "fd12:3456:789a::1", "fec0::1", "feff::1", "ff02::1"]) {
      expect(isBlockedHost(host)).toBe(true);
    }
  });

  it("blocks IPv4-mapped and -compatible addresses in both shapes", () => {
    // Dotted, as a person writes it.
    for (const host of ["::ffff:127.0.0.1", "::ffff:169.254.169.254", "::ffff:10.0.0.5", "::ffff:192.168.1.1"]) {
      expect(isBlockedHost(host)).toBe(true);
    }
    // Hex, which is what new URL() rewrites the dotted form to - the shape a
    // URL-derived host actually arrives in.
    for (const host of ["::ffff:7f00:1", "::ffff:a9fe:a9fe", "::ffff:0a00:5", "::ffff:c0a8:101"]) {
      expect(isBlockedHost(host)).toBe(true);
    }
  });

  it("leaves a public address reachable", () => {
    expect(isBlockedHost("2001:4860:4860::8888")).toBe(false);
    expect(isBlockedHost("2606:4700::1111")).toBe(false);
    expect(isBlockedHost("2a00:1450:400f:80d::200e")).toBe(false);
    // A mapped address is judged on the IPv4 it carries, not blanket-blocked.
    expect(isBlockedHost("::ffff:5db8:d822")).toBe(false); // ::ffff:93.184.216.34
  });

  it("isBlockedHost classifies public hosts as reachable", () => {
    expect(isBlockedHost("127.0.0.1")).toBe(true);
    expect(isBlockedHost("169.254.169.254")).toBe(true);
    expect(isBlockedHost("::1")).toBe(true);
    expect(isBlockedHost("bbcgoodfood.com")).toBe(false);
    expect(isBlockedHost("93.184.216.34")).toBe(false);
  });
});

describe("assertSafeRedirectUrl - the redirect gate", () => {
  it("allows a non-allowlisted public publisher (the apple.news case)", () => {
    expect(assertSafeRedirectUrl("https://publisher.example.com/recipe").hostname).toBe(
      "publisher.example.com",
    );
  });

  it("still blocks a private address on a hop", () => {
    expect(() => assertSafeRedirectUrl("http://127.0.0.1/")).toThrow(/private or internal/i);
  });

  it("still blocks a non-http(s) scheme on a hop", () => {
    expect(() => assertSafeRedirectUrl("file:///etc/passwd")).toThrow(/only http\/https/i);
  });
});

describe("importRecipeFromUrl - redirects are re-checked", () => {
  it.each([
    "http://127.0.0.1/admin",
    "http://169.254.169.254/latest/meta-data/",
    "http://10.1.2.3/",
    "http://[fe90::1]/", // the redirect gate has no allowlist, so this is the live bypass
    "http://[::ffff:169.254.169.254]/latest/meta-data/",
  ])(
    "refuses a redirect to %s",
    async (target) => {
      const fetchImpl = queuedFetch([redirect(target)]);
      await expect(
        importRecipeFromUrl("https://apple.news/abc", { fetchImpl, resolve: publicResolver }),
      ).rejects.toMatchObject({ status: 400 });
    },
  );

  it("refuses a redirect whose hostname resolves to a private address", async () => {
    const fetchImpl = queuedFetch([redirect("https://publisher.example.com/recipe")]);
    const resolve: HostResolver = async (host) =>
      host === "publisher.example.com" ? ["10.0.0.7"] : [PUBLIC_IP];
    await expect(
      importRecipeFromUrl("https://apple.news/abc", { fetchImpl, resolve }),
    ).rejects.toThrow(/private or internal/i);
  });

  it("follows a redirect to an off-allowlist publisher that is genuinely public", async () => {
    const fetchImpl = queuedFetch([
      redirect("https://publisher.example.com/recipe"),
      response(pageWithLdJson("application/ld+json")),
    ]);
    const recipe = await importRecipeFromUrl("https://apple.news/abc", {
      fetchImpl,
      resolve: publicResolver,
    });
    expect(recipe.title).toBe("Pannkaka");
    expect(recipe.sourceSite).toBe("apple.news"); // original share link is kept
  });

  it("gives up after too many redirects", async () => {
    const fetchImpl = queuedFetch([
      redirect("https://apple.news/a"),
      redirect("https://apple.news/b"),
      redirect("https://apple.news/c"),
    ]);
    await expect(
      importRecipeFromUrl("https://apple.news/start", {
        fetchImpl,
        resolve: publicResolver,
        maxRedirects: 2,
      }),
    ).rejects.toThrow(/too many times/i);
  });
});

describe("importRecipeFromUrl - DNS resolution guard", () => {
  it("blocks an allowlisted host that resolves to a private address (rebinding)", async () => {
    const fetchImpl = queuedFetch([response(pageWithLdJson("application/ld+json"))]);
    const resolve: HostResolver = async () => ["10.0.0.5"];
    await expect(
      importRecipeFromUrl("https://www.bbcgoodfood.com/recipes/x", { fetchImpl, resolve }),
    ).rejects.toThrow(/private or internal/i);
  });

  it("imports normally when the host resolves to a public address", async () => {
    const fetchImpl = queuedFetch([response(pageWithLdJson("application/ld+json"))]);
    const recipe = await importRecipeFromUrl("https://www.bbcgoodfood.com/recipes/x", {
      fetchImpl,
      resolve: publicResolver,
    });
    expect(recipe.ingredients.map((i) => i.name)).toEqual(["vetemjöl", "mjölk"]);
  });
});

describe("importRecipeFromUrl - timeout", () => {
  it("gives up when the origin never responds", async () => {
    const hanging: FetchLike = (_url, init) =>
      new Promise((_resolve, reject) => {
        init.signal.addEventListener("abort", () =>
          reject(new DOMException("The operation was aborted.", "AbortError")),
        );
      });
    await expect(
      importRecipeFromUrl("https://www.bbcgoodfood.com/recipes/x", {
        fetchImpl: hanging,
        resolve: publicResolver,
        timeoutMs: 30,
      }),
    ).rejects.toThrow(/took too long/i);
  });
});

describe("importRecipeFromUrl - response size cap", () => {
  it("refuses a body larger than the cap while streaming (no content-length)", async () => {
    const encoder = new TextEncoder();
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(encoder.encode("x".repeat(2048)));
        controller.enqueue(encoder.encode("y".repeat(2048)));
        controller.close();
      },
    });
    const oversized: FetchResponse = {
      status: 200,
      ok: true,
      headers: { get: () => null },
      body: stream,
      text: async () => "",
    };
    const fetchImpl: FetchLike = async () => oversized;
    await expect(
      importRecipeFromUrl("https://www.bbcgoodfood.com/recipes/x", {
        fetchImpl,
        resolve: publicResolver,
        maxBytes: 1024,
      }),
    ).rejects.toMatchObject({ status: 413 });
  });

  it("refuses early when content-length already exceeds the cap", async () => {
    const declared: FetchResponse = {
      status: 200,
      ok: true,
      headers: { get: (name) => (name.toLowerCase() === "content-length" ? "99999999" : null) },
      body: null,
      text: async () => "ok",
    };
    const fetchImpl: FetchLike = async () => declared;
    await expect(
      importRecipeFromUrl("https://www.bbcgoodfood.com/recipes/x", {
        fetchImpl,
        resolve: publicResolver,
        maxBytes: 1024,
      }),
    ).rejects.toMatchObject({ status: 413 });
  });

  it("still imports a page under the cap", async () => {
    const fetchImpl = queuedFetch([response(pageWithLdJson("application/ld+json"))]);
    const recipe = await importRecipeFromUrl("https://www.bbcgoodfood.com/recipes/x", {
      fetchImpl,
      resolve: publicResolver,
      maxBytes: 1024 * 1024,
    });
    expect(recipe.title).toBe("Pannkaka");
  });
});

describe("importRecipeFromUrl - JSON-LD extraction", () => {
  it("reads a plain application/ld+json block", async () => {
    const fetchImpl = queuedFetch([response(pageWithLdJson("application/ld+json"))]);
    const recipe = await importRecipeFromUrl("https://www.bbcgoodfood.com/recipes/x", {
      fetchImpl,
      resolve: publicResolver,
    });
    expect(recipe.title).toBe("Pannkaka");
    expect(recipe.servings).toBe(4);
    expect(recipe.ingredients).toHaveLength(2);
  });

  it("REGRESSION: reads the +-entity-encoded type arla.se emits (ld&#x2B;json)", async () => {
    const fetchImpl = queuedFetch([response(pageWithLdJson("application/ld&#x2B;json"))]);
    const recipe = await importRecipeFromUrl("https://arla.se/recept/pannkaka/", {
      fetchImpl,
      resolve: publicResolver,
    });
    expect(recipe.title).toBe("Pannkaka");
    expect(recipe.ingredients).toHaveLength(2);
  });

  it.each([
    "application/ld+json",
    "application/ld&#43;json",
    "application/ld&plus;json",
  ])("tolerates the equivalent encoding form %s", async (typeAttribute) => {
    const fetchImpl = queuedFetch([response(pageWithLdJson(typeAttribute))]);
    const recipe = await importRecipeFromUrl("https://arla.se/recept/pannkaka/", {
      fetchImpl,
      resolve: publicResolver,
    });
    expect(recipe.title).toBe("Pannkaka");
  });

  it("fails cleanly when the page has no recipe JSON-LD", async () => {
    const fetchImpl = queuedFetch([response("<html><body>no structured data here</body></html>")]);
    await expect(
      importRecipeFromUrl("https://www.bbcgoodfood.com/recipes/x", {
        fetchImpl,
        resolve: publicResolver,
      }),
    ).rejects.toMatchObject({ status: 422 });
  });
});
