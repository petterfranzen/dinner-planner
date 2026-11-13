import { afterAll, beforeAll, describe, expect, it, jest } from "@jest/globals";
import express from "express";
import type { Server } from "node:http";

// The route module imports db.js at load time. Mock it so this test never
// creates a sqlite file and stays a pure unit test of the route's validation.
const run = jest.fn(() => ({ changes: 1 }));
const prepare = jest.fn(() => ({ run, get: jest.fn(), all: jest.fn() }));

jest.unstable_mockModule("../src/db.js", () => ({ db: { prepare } }));

const { mealPlanRouter } = await import("../src/routes/mealPlan.js");

let server: Server;
let base = "";

beforeAll(async () => {
  const app = express();
  app.use(express.json());
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

describe("DELETE /api/meal-plan/:week/:day/:mealType", () => {
  it.each(["abc", "7", "-1", "1.5", "Mon"])(
    "rejects day %s with 400 and never touches the DB",
    async (day) => {
      prepare.mockClear();
      run.mockClear();
      const res = await fetch(`${base}/api/meal-plan/2026-11-02/${day}/dinner`, { method: "DELETE" });
      expect(res.status).toBe(400);
      expect(await res.json()).toEqual({ error: "day must be 0 (Mon) through 6 (Sun)" });
      expect(prepare).not.toHaveBeenCalled();
      expect(run).not.toHaveBeenCalled();
    },
  );

  it.each(["brunch", "DINNER", "lunch "])(
    "rejects mealType %s with 400 and never touches the DB",
    async (mealType) => {
      prepare.mockClear();
      run.mockClear();
      const res = await fetch(
        `${base}/api/meal-plan/2026-11-02/1/${encodeURIComponent(mealType)}`,
        { method: "DELETE" },
      );
      expect(res.status).toBe(400);
      expect(await res.json()).toEqual({
        error: "mealType must be one of: breakfast, lunch, dinner",
      });
      expect(prepare).not.toHaveBeenCalled();
      expect(run).not.toHaveBeenCalled();
    },
  );

  it.each(["0", "1", "6"])("accepts day %s and deletes the slot", async (day) => {
    prepare.mockClear();
    run.mockClear();
    const res = await fetch(`${base}/api/meal-plan/2026-11-02/${day}/dinner`, { method: "DELETE" });
    expect(res.status).toBe(204);
    expect(prepare).toHaveBeenCalledTimes(1);
    expect(run).toHaveBeenCalledWith("2026-11-02", Number(day), "dinner");
  });
});
