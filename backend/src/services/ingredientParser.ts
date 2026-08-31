import type { ParsedIngredient } from "../types.js";

// Best-effort parsing of a free-text ingredient line ("2 large eggs",
// "100g plain flour", "3 dl vetemjöl") into quantity/unit/name.
//
// This is intentionally simple regex/lookup based, not a real NLP
// ingredient parser. It's used for schema.org recipeIngredient strings on
// import. It will get plenty of lines wrong or partially wrong (compound
// quantities, ranges like "2-3", size words like "large" ending up glued
// to the name, etc) - the raw text is always kept alongside so nothing is
// lost, and manual add lets a human enter quantity/unit/name directly
// instead of relying on this parser.

const UNICODE_FRACTIONS: Record<string, number> = {
  "½": 1 / 2,
  "⅓": 1 / 3,
  "⅔": 2 / 3,
  "¼": 1 / 4,
  "¾": 3 / 4,
  "⅕": 1 / 5,
  "⅖": 2 / 5,
  "⅗": 3 / 5,
  "⅘": 4 / 5,
  "⅙": 1 / 6,
  "⅚": 5 / 6,
  "⅛": 1 / 8,
  "⅜": 3 / 8,
  "⅝": 5 / 8,
  "⅞": 7 / 8,
};

// Canonicalized unit aliases. Covers metric, common Swedish recipe units
// (Arla Köket) and common English/US units (BBC Good Food). Not
// exhaustive by design.
const UNIT_ALIASES: Record<string, string> = {
  g: "g",
  gram: "g",
  grams: "g",
  gr: "g",
  kg: "kg",
  kilo: "kg",
  kilogram: "kg",
  kilograms: "kg",
  ml: "ml",
  milliliter: "ml",
  milliliters: "ml",
  millilitre: "ml",
  millilitres: "ml",
  cl: "cl",
  dl: "dl",
  l: "l",
  liter: "l",
  liters: "l",
  litre: "l",
  litres: "l",
  msk: "msk",
  matsked: "msk",
  matskedar: "msk",
  tsk: "tsk",
  tesked: "tsk",
  teskedar: "tsk",
  st: "st",
  styck: "st",
  stycken: "st",
  port: "port",
  portion: "port",
  portioner: "port",
  burk: "burk",
  burkar: "burk",
  förp: "förp",
  förpackning: "förp",
  förpackningar: "förp",
  paket: "paket",
  klyfta: "klyfta",
  klyftor: "klyfta",
  skiva: "skiva",
  skivor: "skiva",
  knippe: "knippe",
  cup: "cup",
  cups: "cup",
  tbsp: "tbsp",
  tablespoon: "tbsp",
  tablespoons: "tbsp",
  tsp: "tsp",
  teaspoon: "tsp",
  teaspoons: "tsp",
  oz: "oz",
  ounce: "oz",
  ounces: "oz",
  lb: "lb",
  lbs: "lb",
  pound: "lb",
  pounds: "lb",
  pint: "pint",
  pints: "pint",
  quart: "quart",
  quarts: "quart",
  clove: "clove",
  cloves: "clove",
  can: "can",
  cans: "can",
  package: "package",
  packages: "package",
  pkg: "package",
  bunch: "bunch",
  bunches: "bunch",
  slice: "slice",
  slices: "slice",
  pinch: "pinch",
  dash: "dash",
};

// Keyword -> shopping-list category. Checked in this order; first match
// wins. Keyword based on purpose (no external ingredient database) so it
// will misclassify unusual ingredients into "Other" - documented in the
// README as a known v1 limitation.
const CATEGORY_KEYWORDS: [string, string[]][] = [
  [
    "Produce",
    [
      "onion", "lök", "garlic", "vitlök", "tomato", "tomat", "potato", "potatis",
      "carrot", "morot", "apple", "äpple", "lemon", "citron", "lime", "pepper",
      "paprika", "spinach", "spenat", "lettuce", "sallad", "cucumber", "gurka",
      "broccoli", "mushroom", "svamp", "basil", "basilika", "parsley", "persilja",
      "dill", "chili", "ginger", "ingefära", "banana", "banan", "berr", "bär",
      "avocado", "zucchini", "squash", "cabbage", "kål", "leek", "purjolök",
      "celery", "selleri", "fruit", "frukt", "grönsak", "citrus", "apelsin", "orange",
    ],
  ],
  [
    "Dairy",
    [
      "milk", "mjölk", "cream", "grädde", "butter", "smör", "cheese", "ost",
      "yoghurt", "yogurt", "egg", "ägg", "creme fraiche", "crème fraiche",
      "quark", "kvarg", " fil", "buttermilk",
    ],
  ],
  [
    "Meat & Fish",
    [
      "chicken", "kyckling", "beef", "nötkött", "pork", "fläsk", "bacon",
      "sausage", "korv", "mince", "färs", "fish", "fisk", "salmon", "lax",
      "shrimp", "räka", "meat", "kött", "ham", "skinka", "turkey", "kalkon",
      "lamb", "lamm",
    ],
  ],
  [
    "Bakery",
    ["bread", "bröd", "flour", "mjöl", "yeast", "jäst", "tortilla", "bun", "bulle", "baguette"],
  ],
  [
    "Frozen",
    ["frozen", "fryst", "ice cream", "glass "],
  ],
  [
    "Pantry",
    [
      "sugar", "socker", "salt", "oil", "olja", "vinegar", "vinäger", "rice",
      "ris", "pasta", "stock", "buljong", "broth", "spice", "krydda", "honung",
      "honey", "tomato paste", "tomatpuré", "beans", "bönor", "lentil", "lins",
      "nut", "nöt", "almond", "mandel", "chocolate", "choklad", "vanilla",
      "vanilj", "baking powder", "bakpulver", "bicarbonate", "natron", "curry",
      "cumin", "kummin", "cinnamon", "kanel",
    ],
  ],
];

export function categorize(name: string): string {
  const n = ` ${name.toLowerCase()} `;
  for (const [category, keywords] of CATEGORY_KEYWORDS) {
    if (keywords.some((k) => n.includes(k))) return category;
  }
  return "Other";
}

function parseQuantityToken(token: string): number | null {
  const trimmed = token.trim();
  if (UNICODE_FRACTIONS[trimmed] !== undefined) return UNICODE_FRACTIONS[trimmed];

  const mixedUnicode = trimmed.match(/^(\d+)\s*([½⅓⅔¼¾⅕⅖⅗⅘⅙⅚⅛⅜⅝⅞])$/);
  if (mixedUnicode) {
    return Number(mixedUnicode[1]) + UNICODE_FRACTIONS[mixedUnicode[2]];
  }

  const mixed = trimmed.match(/^(\d+)\s+(\d+)\/(\d+)$/);
  if (mixed) {
    return Number(mixed[1]) + Number(mixed[2]) / Number(mixed[3]);
  }

  const frac = trimmed.match(/^(\d+)\/(\d+)$/);
  if (frac) {
    return Number(frac[1]) / Number(frac[2]);
  }

  const num = Number(trimmed.replace(",", "."));
  return Number.isFinite(num) ? num : null;
}

const QUANTITY_TOKEN =
  /^(\d+\s+\d+\/\d+|\d+\/\d+|\d+(?:[.,]\d+)?\s*[½⅓⅔¼¾⅕⅖⅗⅘⅙⅚⅛⅜⅝⅞]?|[½⅓⅔¼¾⅕⅖⅗⅘⅙⅚⅛⅜⅝⅞])\s*/;

export function parseIngredientLine(raw: string): ParsedIngredient {
  const text = raw.trim().replace(/\s+/g, " ");
  let rest = text;
  let quantity: number | null = null;

  const qtyMatch = rest.match(QUANTITY_TOKEN);
  if (qtyMatch) {
    quantity = parseQuantityToken(qtyMatch[1]);
    rest = rest.slice(qtyMatch[0].length);
  }

  // Optional range like "2-3" or "2 to 3" collapses to the first number -
  // good enough for shopping-list purposes (better to have slightly too
  // much than too little).
  const rangeMatch = rest.match(/^(?:-|to)\s*\d+(?:[.,]\d+)?\s*/);
  if (quantity !== null && rangeMatch) {
    rest = rest.slice(rangeMatch[0].length);
  }

  let unit: string | null = null;
  if (quantity !== null) {
    const unitMatch = rest.match(/^([a-zA-ZåäöÅÄÖ]+)\.?(\s+|$)/);
    if (unitMatch) {
      const token = unitMatch[1].toLowerCase();
      if (UNIT_ALIASES[token]) {
        unit = UNIT_ALIASES[token];
        rest = rest.slice(unitMatch[0].length);
      }
    }
  }

  const name = rest.trim() || text;
  return {
    rawText: text,
    quantity,
    unit,
    name,
    category: categorize(name),
  };
}

/**
 * Normalizes a name for shopping-list grouping/matching purposes: lowercase,
 * drop parenthetical asides ("onion (chopped)" -> "onion"), collapse
 * whitespace, and naively strip a trailing "s" so "onion"/"onions" match.
 * This is deliberately crude - see README "Known limitations".
 */
export function normalizeIngredientName(name: string): string {
  let n = name.toLowerCase().trim();
  n = n.replace(/\([^)]*\)/g, " ");
  n = n.replace(/[.,;:]+$/, "");
  n = n.replace(/\s+/g, " ").trim();
  if (n.length > 3 && n.endsWith("s") && !n.endsWith("ss")) {
    n = n.slice(0, -1);
  }
  return n;
}
