import { lookup } from "node:dns/promises";
import { isIP } from "node:net";
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
//   - refuses an address that is private, loopback or link-local, and one
//     whose hostname *resolves* to such an address - checked on the pasted
//     URL and again on every redirect hop - so the fetch cannot be bounced
//     at the container's own network, a cloud metadata endpoint, or another
//     service on the LAN. A redirect deliberately does not have to be on the
//     allowlist (an apple.news share link 30x's to the publisher's own
//     domain), but it must still pass the scheme and private-address checks.
//   - stores only the one recipe the person pasted, not the site's catalog

const ALLOWED_HOSTS = ["bbcgoodfood.com", "arla.se", "apple.news"];

/** Redirect hops followed before giving up. */
const MAX_REDIRECTS = 5;

// Hard ceiling on the response body we will read, so one page (or a hostile
// / looping response) cannot exhaust the container's memory.
const MAX_RESPONSE_BYTES = 2 * 1024 * 1024; // 2 MiB

// Whole-request wall clock. Apple News short links and a slow origin fit well
// inside this; a black-holed connect does not.
const FETCH_TIMEOUT_MS = 15_000;

const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308]);

const BROWSER_HEADERS: Record<string, string> = {
  // A plain fetch UA gets blocked/soft-blocked by some sites; a normal
  // browser UA is enough to get the same HTML a person's browser sees.
  "User-Agent":
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36",
  Accept: "text/html,application/xhtml+xml",
};

const PRIVATE_ADDRESS_MESSAGE =
  "That URL points at a private or internal network address, which this importer won't fetch.";

const TOO_LARGE_MESSAGE =
  "That page is too large to import (the importer only reads pages up to 2 MB).";

export class RecipeImportError extends Error {
  status: number;
  constructor(message: string, status = 422) {
    super(message);
    this.status = status;
  }
}

// --- target validation -----------------------------------------------------

/** Strips the brackets Node's URL puts around an IPv6 host and a trailing dot. */
function unbracket(hostname: string): string {
  return hostname.replace(/^\[/, "").replace(/\]$/, "").replace(/\.$/, "");
}

function isPrivateIPv4(ip: string): boolean {
  const parts = ip.split(".").map((n) => Number(n));
  if (parts.length !== 4 || parts.some((n) => !Number.isInteger(n) || n < 0 || n > 255)) {
    return false;
  }
  const [a, b] = parts;
  if (a === 0) return true; // 0.0.0.0/8 "this network"
  if (a === 10) return true; // 10.0.0.0/8 private
  if (a === 127) return true; // loopback
  if (a === 169 && b === 254) return true; // link-local (incl. 169.254.169.254 metadata)
  if (a === 172 && b >= 16 && b <= 31) return true; // 172.16.0.0/12 private
  if (a === 192 && b === 168) return true; // 192.168.0.0/16 private
  if (a === 100 && b >= 64 && b <= 127) return true; // 100.64.0.0/10 CGNAT
  if (a >= 224) return true; // multicast (224/4) and reserved (240/4)
  return false;
}

function isPrivateIPv6(ip: string): boolean {
  const h = ip.toLowerCase();
  // IPv4-mapped / -compatible forms (::ffff:127.0.0.1) - judge the IPv4 part.
  const mapped = h.match(/^::(?:ffff:)?(\d+\.\d+\.\d+\.\d+)$/);
  if (mapped) return isPrivateIPv4(mapped[1]);
  if (h === "::1" || h === "::") return true; // loopback / unspecified
  if (h.startsWith("fe80")) return true; // link-local fe80::/10
  if (h.startsWith("fc") || h.startsWith("fd")) return true; // unique-local fc00::/7
  if (h.startsWith("ff")) return true; // multicast ff00::/8
  return false;
}

/**
 * True for a host that is (or is a name for) a private, loopback, link-local
 * or otherwise non-public address. IP literals and the well-known internal
 * names are caught here; a public-looking name that *resolves* to a private
 * address is caught separately, after the DNS lookup.
 */
export function isBlockedHost(hostname: string): boolean {
  const h = unbracket(hostname.toLowerCase());
  if (h === "localhost" || h.endsWith(".localhost")) return true;
  const version = isIP(h);
  if (version === 4) return isPrivateIPv4(h);
  if (version === 6) return isPrivateIPv6(h);
  return false;
}

function isAllowedHost(hostname: string): boolean {
  const h = hostname.toLowerCase().replace(/^www\./, "");
  return ALLOWED_HOSTS.some((allowed) => h === allowed || h.endsWith(`.${allowed}`));
}

function assertScheme(url: URL): void {
  if (url.protocol !== "https:" && url.protocol !== "http:") {
    throw new RecipeImportError("Only http/https URLs are supported.", 400);
  }
}

function parseUrl(rawUrl: string): URL {
  try {
    return new URL(rawUrl);
  } catch {
    throw new RecipeImportError("That doesn't look like a valid URL.", 400);
  }
}

/** Entry gate for a URL the user pasted: http(s) only, not a private/internal
 * target, and on the allowlist. */
export function assertSupportedUrl(rawUrl: string): URL {
  const url = parseUrl(rawUrl);
  assertScheme(url);
  if (isBlockedHost(url.hostname)) {
    throw new RecipeImportError(PRIVATE_ADDRESS_MESSAGE, 400);
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

/**
 * Gate for a *redirect* target. Deliberately does not re-apply the host
 * allowlist: an apple.news share link 30x's to the publisher's own domain,
 * which is the whole point of following it. It does enforce the trust
 * boundary - scheme, and the private/loopback/link-local block - so an
 * allowlisted host cannot bounce the fetch at the container's own network or
 * a metadata endpoint.
 */
export function assertSafeRedirectUrl(rawUrl: string): URL {
  const url = parseUrl(rawUrl);
  assertScheme(url);
  if (isBlockedHost(url.hostname)) {
    throw new RecipeImportError(PRIVATE_ADDRESS_MESSAGE, 400);
  }
  return url;
}

// --- fetching --------------------------------------------------------------

export interface FetchInit {
  redirect: "manual";
  signal: AbortSignal;
  headers: Record<string, string>;
}

export interface FetchResponse {
  status: number;
  ok: boolean;
  headers: { get(name: string): string | null };
  body: ReadableStream<Uint8Array> | null;
  text(): Promise<string>;
}

export type FetchLike = (url: string, init: FetchInit) => Promise<FetchResponse>;

export type HostResolver = (hostname: string) => Promise<string[]>;

const defaultFetch: FetchLike = (url, init) => fetch(url, init);

const defaultResolve: HostResolver = async (hostname) => {
  const addresses = await lookup(hostname, { all: true });
  return addresses.map((a) => a.address);
};

/**
 * Resolves the host and refuses if *any* address it points at is private.
 * This closes DNS rebinding: an allowlisted name whose A record points into
 * the container's network is blocked even though the name itself looks fine.
 */
async function assertResolvesToPublicAddress(url: URL, resolve: HostResolver): Promise<void> {
  const host = unbracket(url.hostname);
  if (isIP(host)) return; // literal IP - already judged by the caller
  let addresses: string[];
  try {
    addresses = await resolve(host);
  } catch {
    throw new RecipeImportError(
      "Could not look up that URL's host. Check the link and try again.",
      502,
    );
  }
  if (addresses.length === 0 || addresses.some((address) => isBlockedHost(address))) {
    throw new RecipeImportError(PRIVATE_ADDRESS_MESSAGE, 400);
  }
}

/** Reads the body, bailing out as soon as it exceeds the cap. */
async function readBodyCapped(res: FetchResponse, maxBytes: number): Promise<string> {
  const declared = res.headers.get("content-length");
  if (declared !== null) {
    const size = Number(declared);
    if (Number.isFinite(size) && size > maxBytes) {
      throw new RecipeImportError(TOO_LARGE_MESSAGE, 413);
    }
  }
  const body = res.body;
  if (!body || typeof body.getReader !== "function") {
    const text = await res.text();
    if (Buffer.byteLength(text, "utf8") > maxBytes) {
      throw new RecipeImportError(TOO_LARGE_MESSAGE, 413);
    }
    return text;
  }
  const reader = body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!value) continue;
      total += value.byteLength;
      if (total > maxBytes) {
        throw new RecipeImportError(TOO_LARGE_MESSAGE, 413);
      }
      chunks.push(value);
    }
  } finally {
    await reader.cancel().catch(() => undefined);
  }
  return Buffer.concat(chunks).toString("utf8");
}

interface FetchDeps {
  fetchImpl: FetchLike;
  resolve: HostResolver;
  timeoutMs: number;
  maxBytes: number;
  maxRedirects: number;
}

/**
 * Fetches `rawUrl` following redirects *manually* so every hop is re-checked:
 * the scheme and the private/loopback/link-local block apply to each target,
 * not just the URL the user pasted. The whole request shares one abort signal
 * (the timeout) and one size cap.
 */
async function fetchHtml(rawUrl: string, deps: FetchDeps): Promise<string> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), deps.timeoutMs);
  try {
    let url = assertSupportedUrl(rawUrl);
    for (let hop = 0; ; hop++) {
      await assertResolvesToPublicAddress(url, deps.resolve);
      const res = await deps.fetchImpl(url.toString(), {
        redirect: "manual",
        signal: controller.signal,
        headers: BROWSER_HEADERS,
      });

      if (REDIRECT_STATUSES.has(res.status)) {
        if (hop >= deps.maxRedirects) {
          throw new RecipeImportError("That URL redirected too many times. Try the final link.", 502);
        }
        const location = res.headers.get("location");
        if (!location) {
          throw new RecipeImportError("That URL redirected without a destination.", 502);
        }
        let next: URL;
        try {
          next = new URL(location, url);
        } catch {
          throw new RecipeImportError(
            "That URL redirected to something that isn't a valid link.",
            502,
          );
        }
        url = assertSafeRedirectUrl(next.toString()); // scheme + private block on the hop
        continue;
      }

      if (!res.ok) {
        throw new RecipeImportError(
          `Could not fetch that page (HTTP ${res.status}). It may have moved or be blocking automated requests.`,
          502,
        );
      }
      return await readBodyCapped(res, deps.maxBytes);
    }
  } catch (err) {
    if (err instanceof RecipeImportError) throw err;
    const aborted = (err as { name?: string }).name === "AbortError";
    throw new RecipeImportError(
      aborted
        ? "That page took too long to respond. Try again, or add the recipe manually."
        : "Could not reach that URL. Check the link and your internet connection.",
      502,
    );
  } finally {
    clearTimeout(timer);
  }
}

// --- JSON-LD parsing -------------------------------------------------------

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

// --- public API ------------------------------------------------------------

export interface ImportedRecipe {
  title: string;
  servings: number;
  instructions: string;
  ingredients: ParsedIngredient[];
  sourceUrl: string;
  sourceSite: string;
}

/** Overridable seams (fetch, DNS resolver, limits) - the defaults are the
 * real ones; tests inject fakes so no network is touched. */
export interface RecipeImportOptions {
  fetchImpl?: FetchLike;
  resolve?: HostResolver;
  timeoutMs?: number;
  maxBytes?: number;
  maxRedirects?: number;
}

export async function importRecipeFromUrl(
  rawUrl: string,
  options: RecipeImportOptions = {},
): Promise<ImportedRecipe> {
  const url = assertSupportedUrl(rawUrl);
  const deps: FetchDeps = {
    fetchImpl: options.fetchImpl ?? defaultFetch,
    resolve: options.resolve ?? defaultResolve,
    timeoutMs: options.timeoutMs ?? FETCH_TIMEOUT_MS,
    maxBytes: options.maxBytes ?? MAX_RESPONSE_BYTES,
    maxRedirects: options.maxRedirects ?? MAX_REDIRECTS,
  };
  return duringPhase(`importing a recipe from ${url.hostname}`, () =>
    fetchAndParse(url, rawUrl, deps),
  );
}

// rawUrl is carried through rather than re-derived from `url`: it's what
// gets stored as sourceUrl, and URL parsing normalises things (trailing
// slashes, default ports, escaping) that would otherwise silently change
// what the recipe records as its source.
async function fetchAndParse(url: URL, rawUrl: string, deps: FetchDeps): Promise<ImportedRecipe> {
  const html = await fetchHtml(rawUrl, deps);

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
