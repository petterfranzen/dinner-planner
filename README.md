# Dinner Planner

A small weekly meal-planning app for two people sharing a household:
add recipes (manually, or imported from a URL), assign them to a
Mon–Sun plan together, and generate one consolidated, categorized
shopping list for the week — plus a realistic (not fake) "export to ICA"
option. See [Honest limitations](#honest-limitations--assumptions) below
before relying on this for anything more than a household MVP.

## What it does

1. **Recipes** — add a recipe by hand (title, servings, ingredients with
   quantity/unit, instructions), or import one from a URL on **BBC Good
   Food**, **Arla Köket** (arla.se), or **Apple News**. Import works by
   reading the `schema.org/Recipe` JSON-LD block those pages already embed
   for search engines and recipe apps (the same mechanism apps like
   Paprika/Mealie use) — it's a one-URL-at-a-time personal clipper, not a
   crawler: it fetches exactly the page you paste, reads only its
   structured recipe metadata, and stores only that one recipe. If a page
   has no parseable `schema.org/Recipe` data, import fails with a clear
   message instead of guessing at arbitrary HTML.
2. **Weekly plan** — a Mon–Sun grid (breakfast/lunch/dinner rows) where
   either person can assign a recipe to a day, or just leave a free-text
   note ("leftovers", "eating out"). It's shared state, not per-person —
   see limitations.
3. **Shopping list** — aggregates every ingredient from the week's planned
   recipes into one list, grouped into rough categories (Produce, Dairy,
   Meat & Fish, Bakery, Frozen, Pantry, Other), with best-effort combining
   of matching ingredients (see limitations for what "best-effort" means
   here).
4. **Export to ICA** — see [ICA research findings](#ica-export-research-findings)
   below. Short version: there's no public/official way to push a list
   into ICA's app, so this gives you a clean categorized, copy/paste-ready
   list plus downloadable `.txt`/`.csv` files instead.

## Tech stack (and why)

- **Backend: Node.js + TypeScript + Express**, with **SQLite** via
  `better-sqlite3`. This is a two-person household app with light,
  simple, mostly-relational data (recipes, ingredients, one small meal
  plan table) — a full Postgres+ORM setup would be more ceremony than the
  problem needs, and SQLite as a single file is trivially backed up.
  Node/TypeScript was picked (over, say, Spring Boot as in the
  `flight-tracker` sibling project) so the recipe-import logic — regexes,
  JSON-LD parsing, `fetch` — and the frontend can share the same language
  and mental model, which matters more here than it did for
  flight-tracker's heavier polling/scheduling backend.
- **Frontend: React + TypeScript + Vite**, built to a static bundle served
  by nginx — same shape as flight-tracker's frontend (Vite/React/TS behind
  nginx, proxying `/api`), for consistency with this household's other
  project.
- **Docker Compose** ties backend + frontend together with one command,
  matching this household's established "test/run things via Docker
  Compose" preference. Only two services (no separate poller/agent role
  needed here, unlike flight-tracker) — see `docker-compose.yml` for the
  breakdown.

## Run it locally

```bash
docker compose up --build
```

Then open **http://localhost:5174** (backend API is also reachable
directly on **http://localhost:4000** if you want to poke `/api/...`
routes with curl). Recipes and the meal plan persist in a named Docker
volume (`backend-data`), so `docker compose down` (without `-v`) keeps
your data across restarts; `docker compose down -v` wipes it.

To run without Docker:

```bash
# backend
cd backend
npm install
npm run dev        # http://localhost:4000

# frontend, in another terminal
cd frontend
npm install
npm run dev         # http://localhost:5173, proxies /api to :4000
```

No environment variables or secrets are required — there's nothing to
configure before first run.

## ICA export research findings

I looked (actual web search, not assumption) for any real, documented way
for a third-party app to hand a shopping list to ICA Sverige's own app.
Findings:

- **No public/official API.** ICA Sverige does not publish a developer
  API for shopping lists, product data, or list import, for consumers or
  third parties.
- **An unofficial, reverse-engineered API exists** (e.g.
  [`svendahlstrand/ica-api`](https://github.com/svendahlstrand/ica-api),
  used by a [Home Assistant community integration](https://github.com/jochke/ica_shopping_list)).
  It talks to `handla.api.ica.se` but requires **a real ICA account's
  login credentials** (HTTP Basic auth against ICA directly), is
  undocumented/unsupported by ICA, and by the Home Assistant community's
  own account **broke when ICA changed things in April 2024**. Building a
  household app around silently storing a real ICA login and depending on
  an API that can break without notice isn't something I implemented —
  flagged below as a decision for you, not made unilaterally.
- **No known URL scheme or file-import format** for handing a list to the
  ICA app (no `ica://` share intent, no supported CSV/list-import flow
  found in research).

**What's actually implemented instead:** an honest, useful fallback. The
shopping list screen has "Copy list" (grouped by category, ready to paste
into Notes or a message), and "Download .txt" / "Download .csv" buttons
(`GET /api/shopping-list/export?format=txt|csv`). The UI explicitly says
there's no real ICA integration and that this is meant to be pasted in or
used to search item-by-item in ICA's own app — nothing in the UI or code
claims a fake "ICA integration."

## Data model / where things live

- `backend/src/schema.sql` — the whole SQLite schema (`recipe`,
  `recipe_ingredient`, `meal_plan_entry`). No user table.
- `backend/src/services/recipeImport.ts` — URL allowlist, JSON-LD
  extraction/parsing, schema.org → internal recipe mapping.
- `backend/src/services/ingredientParser.ts` — free-text ingredient line →
  quantity/unit/name, plus the keyword-based category lookup.
- `backend/src/services/shoppingList.ts` — the aggregation/combining logic
  for turning a week's planned recipes into one list.
- `backend/src/services/icaExport.ts` — the plain-text/CSV export.
- `frontend/src/components/` — one component per screen area (week
  planner, shopping list, recipe list/form/import).

## Honest limitations / assumptions

Read this before trusting the app with real weekly planning:

- **No accounts, no login, shared state.** This assumes it runs privately
  on the household's own network (or the couple's own tunnel/VPN), the
  same way `flight-tracker` has no login and is just reachable on the
  LAN. Anyone who can reach the URL can see and edit everything —
  recipes and the plan are a single shared household resource, not
  per-person. If either of you ever wants to expose this outside your
  own network, it needs real auth first — **not done here, flag if you
  want it.**
- **Meal-plan edits aren't real-time/collaborative.** Both people see the
  same data, but there's no live sync (websockets, etc.) — if you both
  edit the same day/slot within moments of each other, last save wins,
  same as two people editing one spreadsheet cell.
- **Recipe import sites actually tested:**
  - **BBC Good Food** — tested against a real page
    (`bbcgoodfood.com/recipes/easy-pancakes`); its `schema.org/Recipe`
    JSON-LD parsed cleanly (name, yield, ingredients, step-by-step
    `HowToStep` instructions).
  - **Arla Köket (arla.se)** — tested against a real page
    (`arla.se/recept/pannkaka/`); it *does* embed `schema.org/Recipe`,
    but its `<script type="application/ld+json">` tag is emitted with the
    `+` HTML-entity-encoded (`application/ld&#x2B;json`) — a
    literal-`+`-only regex silently finds nothing there. The parser
    tolerates that encoding (and a couple of equivalent entity forms);
    this was only caught by testing against the real site, not assumed.
  - **Apple News** — **not actually verified against a live example.**
    Apple News+ Food recipes are proprietary in-app content (Apple News
    Format), not a fetchable public webpage in the general case, and I
    could not obtain a real `apple.news/...` share link to test during
    development. The importer will follow an `apple.news` link's redirect
    and look for `schema.org/Recipe` at wherever it lands (this works for
    a plain, free Apple News article that just deep-links to the original
    publisher's own recipe page, since that's ordinary schema.org
    detection with no special-casing) — but for genuine Apple News+
    exclusive recipes, expect the graceful "no recipe data found" failure
    rather than a successful import. Treat Apple News support as
    best-effort/unverified until you've tried it with a real link.
  - Only these three hosts are allowlisted; anything else is rejected
    with a clear message before any fetch happens (also limits this to
    being obviously a personal one-recipe clipper, not a general URL
    fetcher).
- **Ingredient parsing is regex/keyword based, not NLP.** Quantity/unit
  extraction on imported ingredient lines handles common patterns (whole
  numbers, decimals, simple and mixed fractions, unicode fractions like
  "½", common metric/Swedish/English units) but will mis-parse unusual
  phrasing (ranges collapse to their first number, size words like
  "large" can end up glued onto the ingredient name, etc). The original
  raw text is always kept and shown, so nothing is silently lost — it can
  just end up filed as "1 large eggs" instead of a clean "2 eggs, size:
  large".
- **Shopping-list combining is best-effort, not exact.** Two ingredients
  combine into one line only when their *normalized name and unit both
  match* (e.g. "onion" + "onions", both in no unit or both in "g", merge
  and sum). There is **no unit-conversion table** — "2 cups flour" from
  one recipe and "100g flour" from another will **not** be converted into
  each other; they show up as two separate lines under "flour" rather
  than being silently combined wrong. This is a deliberate, documented
  trade-off for v1, not an oversight.
- **Category assignment is a hand-written keyword list**
  (`ingredientParser.ts`), not a real product/ingredient database.
  Anything not matching a keyword lands in "Other" — expect to see that
  bucket used often, especially for less common ingredients.
- **No image/photo handling, no nutrition info, no multi-week planning UI
  beyond next/previous week, no printing stylesheet.** All intentionally
  out of scope for a v1 MVP.

## Needs a human decision (not decided unilaterally)

- **Whether to ever build against ICA's unofficial API.** It would need
  storing one of your real ICA account passwords in this app and trusting
  an undocumented, previously-broken third-party API. I did not build
  this — decide if that trade-off is ever worth it to you; the honest
  text/CSV export is the fallback either way.
- **Whether/how to expose this beyond your own LAN** (a tunnel, port
  forward, etc.) — doing so with the current no-login model means anyone
  with the link has full read/write access. If you want outside access,
  it needs auth added first.
- **Apple News import is unverified** — if it doesn't work with a real
  link when you try it, that's expected per the limitation above; let me
  know what page/link it fails on and I can adjust the parser.
