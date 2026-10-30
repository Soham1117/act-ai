import { describe, expect, it } from "vitest";
import {
  hoursToMinutes,
  nameKey,
  parseAccrualUsage,
  parseDecimal,
  parseRoster,
  parseSheetRows,
  parseWeeklyPunch,
  parseScheduledShifts,
  usualWeek,
} from "@/lib/tcp-xml";

const sheet = (rows: string[][]) =>
  `<Workbook><Worksheet><Table>${rows
    .map(
      (r) =>
        `<Row>${r
          .map((c, i) => (c === "" ? "" : `<Cell ss:Index="${i + 1}"><Data ss:Type="String">${c}</Data></Cell>`))
          .join("")}</Row>`,
    )
    .join("")}</Table></Worksheet></Workbook>`;

describe("tcp-xml", () => {
  it("reads hours and decimals", () => {
    expect(hoursToMinutes("6:40")).toBe(400);
    expect(hoursToMinutes("-1446:00")).toBe(-86760);
    expect(parseDecimal("(0.5000)")).toBe(-0.5);
  });

  it("keys names ignoring middle names and nicknames", () => {
    expect(nameKey("Lowell (Tristan) Williams")).toBe("lowell williams");
    expect(nameKey("Kenneth W Stokley")).toBe("kenneth stokley");
  });

  it("honours ss:Index gaps", () => {
    const rows = parseSheetRows(sheet([["84", "", "┌"]]));
    expect(rows[0]).toEqual(["84", "", "┌"]);
  });

  it("parses punches, timesheet hours and open punches in Central time", () => {
    const { punches } = parseWeeklyPunch(
      parseSheetRows(
        sheet([
          ["84", "Ken Stokley", "[", "7/9/2021", "11:20 AM", "7/9/2021", "11:19 AM", "7/9/2021", "06:00 PM", "", "", "2", "6:40"],
          ["", "", "[", "7/12/2021", "08:00 AM", "", "", "TS", "TS", "", "", "100", "8:00"],
          ["", "", "[", "7/13/2021", "08:00 AM", "", "", "", "", "", "", "2", "0:00"],
        ]),
      ),
    );
    expect(punches).toHaveLength(3);
    expect(punches[0]!.clockIn.toISOString()).toBe("2021-07-09T16:20:00.000Z"); // CDT = UTC-5
    expect(punches[0]!.minutes).toBe(400);
    expect(punches[1]).toMatchObject({ manual: true, jobCode: "100", number: "84" });
    expect(punches[1]!.clockOut!.getTime() - punches[1]!.clockIn.getTime()).toBe(8 * 3600_000);
    expect(punches[2]!.open).toBe(true);
  });

  it("reads roster headers without capturing the SSN", () => {
    const roster = parseRoster(
      parseSheetRows(
        sheet([["Name: Hannah Cobern     Number: 458     Export Code: ACT454     SSN: 123-45-6789    Department: MANUFACTURING    Location: BURLESON"]]),
      ),
    );
    expect(roster).toEqual([
      { number: "458", name: "Hannah Cobern", exportCode: "ACT454", department: "MANUFACTURING", location: "BURLESON" },
    ]);
    expect(JSON.stringify(roster)).not.toContain("6789");
  });

  it("parses the accrual ledger incl. opening row", () => {
    const rows = parseAccrualUsage(
      parseSheetRows(
        sheet([
          ["Employee: Ken Stokley    Number: 84"],
          ["Accrual Bank: 1"],
          ["Before 1/1/2006", "", "0.0000", "0.0000", "0.0000", "(0.0000)", "0.0000"],
          ["7/10/2021", "", "1.5400", "0.0000", "0.0000"],
          ["7/12/2021", "", "0.0000", "0.0000", "8.0000"],
        ]),
      ),
    );
    expect(rows).toHaveLength(3);
    expect(rows[0]!.date).toBeNull();
    expect(rows[1]).toMatchObject({ number: "84", bankId: 1, accrued: 1.54 });
    expect(rows[2]!.taken).toBe(8);
  });
  it("pairs scheduled in/out rows and finds the usual week", () => {
    const rows = [["458", "Hannah Cobern", "", "In", "10/12/2026 07:00 AM"], ["", "", "", "Out", "10/12/2026 03:30 PM"]];
    for (const d of ["10/19", "10/26", "11/2"]) {
      rows.push(["", "", "", "In", `${d}/2026 07:00 AM`], ["", "", "", "Out", `${d}/2026 03:30 PM`]);
    }
    rows.push(["", "", "", "In", "10/20/2026 06:00 AM"], ["", "", "", "Out", "10/20/2026 02:00 PM"]);
    const shifts = parseScheduledShifts(rows);
    expect(shifts).toHaveLength(5);
    expect(shifts[0]).toEqual({ number: "458", date: "2026-10-12", start: "07:00", end: "15:30" });
    const week = usualWeek(shifts, "2026-10-01", "2026-11-30");
    expect(week.days[1]).toEqual({ start: "07:00", end: "15:30", weeks: 4 }); // Mondays
    expect(week.days[2]).toBeUndefined(); // one Tuesday only
  });
});
