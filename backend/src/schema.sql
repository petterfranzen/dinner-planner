-- SQLite schema for the household dinner planner.
--
-- No user/auth tables on purpose: this app assumes it runs privately on the
-- household's own network (or their own tunnel), shared by both people with
-- no login, the same way flight-tracker has no login. See README for that
-- assumption spelled out.

CREATE TABLE IF NOT EXISTS recipe (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    title           TEXT NOT NULL,
    servings        REAL NOT NULL DEFAULT 4,
    instructions    TEXT NOT NULL DEFAULT '',
    source_url      TEXT,
    source_site     TEXT,
    created_at      TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE TABLE IF NOT EXISTS recipe_ingredient (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    recipe_id       INTEGER NOT NULL REFERENCES recipe(id) ON DELETE CASCADE,
    position        INTEGER NOT NULL DEFAULT 0,
    raw_text        TEXT NOT NULL,
    quantity        REAL,
    unit            TEXT,
    name            TEXT NOT NULL,
    category        TEXT NOT NULL DEFAULT 'Other'
);

CREATE INDEX IF NOT EXISTS idx_recipe_ingredient_recipe_id
    ON recipe_ingredient(recipe_id);

-- One row per (week, day, meal_type). week_start_date is the Monday of that
-- week, stored as an ISO date (YYYY-MM-DD). Either recipe_id is set (a
-- planned recipe, optionally scaled via servings_override) or note is set
-- (free text like "leftovers" / "eating out") - not both required, but at
-- least one should be present for the slot to mean anything.
CREATE TABLE IF NOT EXISTS meal_plan_entry (
    id                  INTEGER PRIMARY KEY AUTOINCREMENT,
    week_start_date     TEXT NOT NULL,
    day_of_week         INTEGER NOT NULL CHECK (day_of_week BETWEEN 0 AND 6), -- 0=Mon ... 6=Sun
    meal_type           TEXT NOT NULL DEFAULT 'dinner',
    recipe_id           INTEGER REFERENCES recipe(id) ON DELETE SET NULL,
    servings_override   REAL,
    note                TEXT,
    UNIQUE (week_start_date, day_of_week, meal_type)
);

CREATE INDEX IF NOT EXISTS idx_meal_plan_entry_week
    ON meal_plan_entry(week_start_date);
