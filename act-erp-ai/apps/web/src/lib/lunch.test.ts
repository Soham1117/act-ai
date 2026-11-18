import { describe, expect, it } from "vitest";
import { allocateDailyLunch, type LunchShift } from "./lunch";

const shift = (id: string, hour: number, spanMin: number, baseMin = spanMin): LunchShift => ({
  id,
  clockIn: Date.UTC(2026, 10, 12, hour),
  spanMin,
  baseMin,
});
const lunches = (shifts: LunchShift[]) => Object.fromEntries(allocateDailyLunch(shifts));

describe("allocateDailyLunch", () => {
  it("takes 30 minutes off a day over 4 hours, and nothing at exactly 4 hours or less", () => {
    expect(lunches([shift("a", 13, 8 * 60 + 30)])).toEqual({ a: 30 });
    expect(lunches([shift("a", 13, 4 * 60 + 1)])).toEqual({ a: 30 });
    expect(lunches([shift("a", 13, 4 * 60)])).toEqual({ a: 0 });
    expect(lunches([shift("a", 13, 45)])).toEqual({ a: 0 });
  });

  it("deducts once per day, on the punch where the day passes 4 hours", () => {
    expect(lunches([shift("pm", 18, 3 * 60), shift("am", 13, 4 * 60)])).toEqual({ am: 0, pm: 30 });
    // The morning alone is over 4 hours: a later punch never moves the lunch.
    expect(lunches([shift("am", 13, 7 * 60), shift("pm", 21, 2 * 60)])).toEqual({ am: 30, pm: 0 });
  });

  it("takes the rest of the lunch from earlier punches when the crossing punch is short", () => {
    expect(lunches([shift("am", 13, 4 * 60), shift("pm", 20, 10)])).toEqual({ am: 20, pm: 10 });
  });

  it("deducts lunch on top of an employee's personal break", () => {
    // 8:30 on the clock with a 0:20 personal break: 8:10 before lunch, 7:40 paid.
    expect(lunches([shift("a", 13, 8 * 60 + 30, 8 * 60 + 10)])).toEqual({ a: 30 });
  });
});
