import { describe, expect, it } from "@jest/globals";
import { mondayOf } from "../src/services/dateUtils.js";

describe("mondayOf", () => {
  it("returns the same day for a Monday", () => {
    expect(mondayOf("2026-11-02")).toBe("2026-11-02");
  });

  it("walks back to the Monday for mid-week days", () => {
    expect(mondayOf("2026-11-03")).toBe("2026-11-02");
    expect(mondayOf("2026-11-04")).toBe("2026-11-02");
    expect(mondayOf("2026-11-05")).toBe("2026-11-02");
    expect(mondayOf("2026-11-06")).toBe("2026-11-02");
  });

  it("walks Sunday back six days", () => {
    expect(mondayOf("2026-11-08")).toBe("2026-11-02");
  });

  it("crosses a month and a year boundary", () => {
    expect(mondayOf("2027-01-01")).toBe("2026-12-28");
    expect(mondayOf("2026-03-01")).toBe("2026-02-23");
  });

  it("throws on an invalid date", () => {
    expect(() => mondayOf("not-a-date")).toThrow(/invalid date/i);
  });
});
