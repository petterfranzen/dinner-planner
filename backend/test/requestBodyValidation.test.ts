import { afterAll, beforeAll, describe, expect, it, jest } from "@jest/globals";
import express from "express";
import type { Server } from "node:http";

// Both route modules import db.js at load time. Mock it so this stays a pure
// unit test of request-body validation and never opens a sqlite file.
const run = jest.fn(() => ({ changes: 1 }));
const get = jest.fn(() => undefined);
const all = jest.fn(() => []);
const prepare = jest.fn(() => ({ run, get, all }));

jest.unstable_mockModule("../src/db.js", () => ({ db: { prepare } }));

const { recipesRouter } = await import("../src/routes/recipes.js");
const { mealPlanRouter } = await import("../src/routes/mealPlan.js");

let server: Server;
let base = "";

beforeAll(async () => {
  const app = express();
  app.use(express.json());
  app.get("/api/health", (_req, res) => res.json({ status: "ok" }));
  app.use("/api/recipes", recipesRouter);
  app.use("/api/meal-plan", mealPlanRouter);
  await new Promise<void>((resolve) => {
    server = app.listen(0, "127.0.0.1", () => resolve());
  });
  const address = server.address();
  if (address && typeof address === "object") base = `http://127.0.0.1:${address.port}`;
});

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

function send(method: string, path: string, body: unknown) {
  return fetch(`${base}${path}`, {
    method,
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

/** The server must still answer after every bad request: the whole point of
 *  the fix is that a mistyped field is a 400, not a dead process. */
async function expectServerStillUp() {
  const res = await fetch(`${base}/api/health`);
  expect(res.status).toBe(200);
  expect(await res.json()).toEqual({ status: "ok" });
}

describe("POST /api/recipes/import - non-string url is a 400", () => {
  it.each([[{ url: 1 }], [{ url: [] }], [{ url: {} }], [{ url: true }], [{}]])(
    "rejects %p with 400",
    async (body) => {
      const res = await send("POST", "/api/recipes/import", body);
      expect(res.status).toBe(400);
      expect(await res.json()).toEqual({ error: "url is required" });
    },
  );

  it("REGRESSION: the one request that used to kill the process leaves it healthy", async () => {
    const res = await send("POST", "/api/recipes/import", { url: 1 });
    expect(res.status).toBe(400);
    await expectServerStillUp();
  });
});

describe("POST /api/recipes - typed manual-recipe body", () => {
  it.each([
    [{ title: 1 }, "title is required"],
    [{ title: {} }, "title is required"],
    [{}, "title is required"],
  ])("rejects %p with 400", async (body, error) => {
    const res = await send("POST", "/api/recipes", body);
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error });
  });

  it.each([
    [{ title: "ok", ingredients: 1 }, "at least one ingredient is required"],
    [{ title: "ok", ingredients: [] }, "at least one ingredient is required"],
    [{ title: "ok", ingredients: [1] }, "each ingredient must be an object"],
    [{ title: "ok", ingredients: ["flour"] }, "each ingredient must be an object"],
    [{ title: "ok", ingredients: [{ name: 1 }] }, "each ingredient needs a name"],
    [{ title: "ok", ingredients: [{ name: {} }] }, "each ingredient needs a name"],
    [{ title: "ok", servings: "4", ingredients: [{ name: "flour" }] }, "servings must be a number"],
    [{ title: "ok", servings: {}, ingredients: [{ name: "flour" }] }, "servings must be a number"],
  ])("rejects %p with 400", async (body, error) => {
    const res = await send("POST", "/api/recipes", body);
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error });
  });

  it("leaves the server healthy after the same requests", async () => {
    await send("POST", "/api/recipes", { title: 1 });
    await send("POST", "/api/recipes", { title: "ok", ingredients: [{ name: 1 }] });
    await expectServerStillUp();
  });
});

describe("POST /api/recipes/ingredients/parse-preview - non-string text", () => {
  it.each([[{ text: 1 }], [{ text: [] }], [{ text: {} }]])(
    "rejects %p with 400",
    async (body) => {
      const res = await send("POST", "/api/recipes/ingredients/parse-preview", body);
      expect(res.status).toBe(400);
      expect(await res.json()).toEqual({ error: "text must be a string" });
    },
  );
});

describe("PUT /api/meal-plan/:week/:day/:mealType - typed upsert body", () => {
  const slot = "/api/meal-plan/2026-11-02/1/dinner";

  it.each([
    [{ note: 1 }, "note must be a string"],
    [{ note: {} }, "note must be a string"],
    [{ note: [] }, "note must be a string"],
    [{ recipeId: "5" }, "recipeId must be a number"],
    [{ recipeId: {} }, "recipeId must be a number"],
    [{ servingsOverride: "2" }, "servingsOverride must be a number"],
    [{ servingsOverride: [] }, "servingsOverride must be a number"],
    [{ servingsOverride: 0 }, "servingsOverride must be positive"],
    [{ servingsOverride: -2 }, "servingsOverride must be positive"],
  ])("rejects %p with 400", async (body, error) => {
    const res = await send("PUT", slot, body);
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error });
  });

  it("leaves the server healthy after a bad note", async () => {
    const res = await send("PUT", slot, { note: 1 });
    expect(res.status).toBe(400);
    await expectServerStillUp();
  });
});

describe("meal-plan week parameter - an invalid date is a 400, not a 500", () => {
  const WEEK_ERROR = { error: "week must be a date (YYYY-MM-DD)" };

  it.each(["nope", "2026-13-01", ""])("GET ?week=%p is a 400", async (week) => {
    const res = await fetch(`${base}/api/meal-plan?week=${encodeURIComponent(week)}`);
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual(WEEK_ERROR);
  });

  it("GET with a repeated ?week= (an array) is a 400", async () => {
    const res = await fetch(`${base}/api/meal-plan?week=2026-11-02&week=2026-11-09`);
    expect(res.status).toBe(400);
  });

  it("GET without ?week= still defaults to this week", async () => {
    const res = await fetch(`${base}/api/meal-plan`);
    expect(res.status).toBe(200);
  });

  it.each(["PUT", "DELETE"])("%s on a non-date week is a 400", async (method) => {
    const res = await send(method, "/api/meal-plan/not-a-date/1/dinner", {});
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual(WEEK_ERROR);
    await expectServerStillUp();
  });
});
