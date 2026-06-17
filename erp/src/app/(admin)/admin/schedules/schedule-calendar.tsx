"use client";

import { useEffect, useMemo, useState } from "react";
import { useNextCalendarApp, ScheduleXCalendar } from "@schedule-x/react";
import {
  createViewMonthGrid,
  createViewMonthAgenda,
  createViewWeek,
  createViewDay,
  createViewList,
} from "@schedule-x/calendar";
import "@schedule-x/theme-default/dist/index.css";
// Must be imported BEFORE any Temporal use — installs polyfill on globalThis
// so Schedule-X's instanceof checks see the same class our events use.
import { Temporal } from "@/lib/temporal-shim";
import { useTheme } from "next-themes";
import { ShiftDialog, type EditTarget } from "./shift-dialog";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Plus, X, Filter, Search, Check } from "lucide-react";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Input } from "@/components/ui/input";

type RawEvent = {
  id: string;
  title: string;
  start: string; // "YYYY-MM-DD HH:mm"
  end: string;
  description?: string;
  employeeId: string;
  employeeName: string;
  departmentId: string | null;
  departmentName: string | null;
  jobCode: string;
  notes: string | null;
};

type EmployeeOption = {
  id: string;
  name: string;
  email: string;
  departmentId: string | null;
  departmentName: string | null;
};

type Department = { id: string; name: string };

const TZ = "America/Chicago";
function toZonedDateTime(s: string) {
  return Temporal.ZonedDateTime.from(`${s.replace(" ", "T")}:00[${TZ}]`);
}
function splitDateTime(s: string) {
  const [date, time] = s.split(" ");
  return { date, time };
}

/**
 * Stable, deterministic department→palette index. Keeps colors consistent
 * across renders so the same department always gets the same color.
 */
function deptColorIndex(deptId: string | null): number {
  if (!deptId) return 0;
  let h = 0;
  for (let i = 0; i < deptId.length; i++) {
    h = (h * 31 + deptId.charCodeAt(i)) >>> 0;
  }
  return (h % 8) + 1;
}

export function ScheduleCalendar({
  events,
  employees,
  departments,
}: {
  events: RawEvent[];
  employees: EmployeeOption[];
  departments: Department[];
}) {
  const { resolvedTheme } = useTheme();
  const [open, setOpen] = useState(false);
  const [edit, setEdit] = useState<EditTarget | null>(null);
  const [initialDate, setInitialDate] = useState<string | undefined>(undefined);

  // Filter state
  const [employeeFilter, setEmployeeFilter] = useState<string[]>([]); // ids
  const [departmentFilter, setDepartmentFilter] = useState<string[]>([]); // ids

  const eventsById = useMemo(
    () => Object.fromEntries(events.map((e) => [e.id, e])),
    [events],
  );

  // Filtered subset for the calendar.
  const filteredEvents = useMemo(() => {
    if (employeeFilter.length === 0 && departmentFilter.length === 0)
      return events;
    return events.filter((e) => {
      if (employeeFilter.length > 0 && !employeeFilter.includes(e.employeeId))
        return false;
      if (
        departmentFilter.length > 0 &&
        (e.departmentId == null || !departmentFilter.includes(e.departmentId))
      )
        return false;
      return true;
    });
  }, [events, employeeFilter, departmentFilter]);

  // Per-department `calendars` config gives every dept a distinct color.
  const calendarsConfig = useMemo(() => {
    const cfg: Record<
      string,
      {
        colorName: string;
        lightColors: { main: string; container: string; onContainer: string };
        darkColors: { main: string; onContainer: string; container: string };
      }
    > = {};
    const seen = new Set<string>();
    for (const e of events) {
      const key = e.departmentId ?? "none";
      if (seen.has(key)) continue;
      seen.add(key);
      const idx = deptColorIndex(e.departmentId);
      // Schedule-X consumes plain CSS color strings here, not CSS variables.
      // We use HSL strings tuned to the same palette as our CSS vars.
      const lightMain = lightHsl(idx);
      const darkMain = darkHsl(idx);
      cfg[key] = {
        colorName: key,
        lightColors: {
          main: lightMain,
          container: lightHsl(idx, 0.85),
          onContainer: lightHsl(idx, 0.18),
        },
        darkColors: {
          main: darkMain,
          container: darkHsl(idx, 0.18),
          onContainer: darkHsl(idx, 0.92),
        },
      };
    }
    return cfg;
  }, [events]);

  const sxEvents = useMemo(
    () =>
      filteredEvents.map((e) => ({
        id: e.id,
        title: e.title,
        start: toZonedDateTime(e.start),
        end: toZonedDateTime(e.end),
        description: e.description,
        calendarId: e.departmentId ?? "none",
      })),
    [filteredEvents],
  );

  const calendar = useNextCalendarApp({
    views: [
      createViewMonthGrid(),
      createViewMonthAgenda(),
      createViewWeek(),
      createViewDay(),
      createViewList(),
    ],
    defaultView: "month-grid",
    monthGridOptions: { nEventsPerDay: 4 },
    events: sxEvents,
    isDark: resolvedTheme === "dark",
    calendars: calendarsConfig,
    callbacks: {
      onEventClick: (ev) => {
        const src = eventsById[String(ev.id)];
        if (!src) return;
        const { date: startDate, time: startTime } = splitDateTime(src.start);
        const { time: endTime } = splitDateTime(src.end);
        setEdit({
          id: src.id,
          employeeId: src.employeeId,
          employeeName: src.employeeName,
          date: startDate,
          startTime,
          endTime,
          jobCode: src.jobCode,
          notes: src.notes,
        });
        setInitialDate(undefined);
        setOpen(true);
      },
      onClickDate: (date) => {
        setEdit(null);
        setInitialDate(date.toString());
        setOpen(true);
      },
      onClickDateTime: (dt) => {
        setEdit(null);
        setInitialDate(dt.toPlainDate().toString());
        setOpen(true);
      },
    },
  });

  // Schedule-X only reads `events` at mount. Push subsequent changes
  // through the events facade so filters actually apply to the rendered
  // calendar.
  useEffect(() => {
    if (!calendar) return;
    calendar.events.set(sxEvents);
  }, [calendar, sxEvents]);

  function openCreate() {
    setEdit(null);
    setInitialDate(undefined);
    setOpen(true);
  }

  function handleOpenChange(v: boolean) {
    setOpen(v);
    if (!v) {
      setEdit(null);
      setInitialDate(undefined);
    }
  }

  const filterCount = employeeFilter.length + departmentFilter.length;

  return (
    <div className="space-y-3">
      {/* Filter bar */}
      <div className="flex flex-wrap items-center gap-2">
        <EmployeeFilter
          employees={employees}
          selected={employeeFilter}
          onChange={setEmployeeFilter}
        />
        <DepartmentFilter
          departments={departments}
          selected={departmentFilter}
          onChange={setDepartmentFilter}
        />

        {filterCount > 0 && (
          <>
            <span className="text-[11px] text-muted-foreground">
              Showing {filteredEvents.length} of {events.length} shifts
            </span>
            <Button
              variant="ghost"
              size="sm"
              className="h-8 gap-1 text-xs"
              onClick={() => {
                setEmployeeFilter([]);
                setDepartmentFilter([]);
              }}
            >
              <X className="h-3 w-3" />
              Clear filters
            </Button>
          </>
        )}

        <div className="ml-auto">
          <Button size="sm" onClick={openCreate}>
            <Plus className="mr-1 h-3.5 w-3.5" /> New shift
          </Button>
        </div>
      </div>

      {/* Active filter chips */}
      {(employeeFilter.length > 0 || departmentFilter.length > 0) && (
        <div className="flex flex-wrap gap-1.5">
          {departmentFilter.map((id) => {
            const d = departments.find((x) => x.id === id);
            if (!d) return null;
            return (
              <Badge key={`d-${id}`} variant="secondary" className="gap-1">
                Dept: {d.name}
                <button
                  type="button"
                  onClick={() =>
                    setDepartmentFilter((prev) => prev.filter((x) => x !== id))
                  }
                  className="rounded hover:bg-background/60"
                  aria-label={`Remove department ${d.name}`}
                >
                  <X className="h-3 w-3" />
                </button>
              </Badge>
            );
          })}
          {employeeFilter.map((id) => {
            const e = employees.find((x) => x.id === id);
            if (!e) return null;
            return (
              <Badge key={`e-${id}`} variant="secondary" className="gap-1">
                {e.name}
                <button
                  type="button"
                  onClick={() =>
                    setEmployeeFilter((prev) => prev.filter((x) => x !== id))
                  }
                  className="rounded hover:bg-background/60"
                  aria-label={`Remove employee ${e.name}`}
                >
                  <X className="h-3 w-3" />
                </button>
              </Badge>
            );
          })}
        </div>
      )}

      <div className="sx-react-calendar-wrapper" style={{ height: 640 }}>
        <ScheduleXCalendar calendarApp={calendar} />
      </div>

      <ShiftDialog
        open={open}
        onOpenChange={handleOpenChange}
        employees={employees}
        initialDate={initialDate}
        edit={edit}
      />
    </div>
  );
}

// ───────────────────────────────────────────────────────────────────────
// Filters
// ───────────────────────────────────────────────────────────────────────

function EmployeeFilter({
  employees,
  selected,
  onChange,
}: {
  employees: EmployeeOption[];
  selected: string[];
  onChange: (ids: string[]) => void;
}) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const filtered = useMemo(() => {
    const s = q.trim().toLowerCase();
    if (!s) return employees;
    return employees.filter(
      (e) =>
        e.name.toLowerCase().includes(s) ||
        e.email.toLowerCase().includes(s),
    );
  }, [employees, q]);

  function toggle(id: string) {
    onChange(selected.includes(id) ? selected.filter((x) => x !== id) : [...selected, id]);
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          size="sm"
          className="h-8 gap-1.5 text-xs"
        >
          <Filter className="h-3 w-3" />
          Employees
          {selected.length > 0 && (
            <Badge
              variant="secondary"
              className="h-4 rounded-sm px-1 font-mono text-[10px]"
            >
              {selected.length}
            </Badge>
          )}
        </Button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-72 p-0">
        <div className="relative border-b">
          <Search className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
          <Input
            placeholder="Search…"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            className="h-9 border-0 pl-8 shadow-none focus-visible:ring-0"
          />
        </div>
        <ul className="max-h-72 overflow-y-auto py-1">
          {filtered.length === 0 ? (
            <li className="py-6 text-center text-xs text-muted-foreground">
              No matches.
            </li>
          ) : (
            filtered.map((e) => {
              const on = selected.includes(e.id);
              return (
                <li key={e.id}>
                  <button
                    type="button"
                    onClick={() => toggle(e.id)}
                    className={`flex w-full items-center gap-2 px-2.5 py-1.5 text-left text-sm hover:bg-muted ${
                      on ? "bg-muted/60" : ""
                    }`}
                  >
                    <span
                      className={`grid h-4 w-4 place-items-center rounded border ${
                        on
                          ? "border-primary bg-primary text-primary-foreground"
                          : "border-input"
                      }`}
                    >
                      {on && <Check className="h-3 w-3" />}
                    </span>
                    <span className="flex-1 min-w-0 truncate">{e.name}</span>
                    {e.departmentName && (
                      <span className="truncate text-[10px] text-muted-foreground">
                        {e.departmentName}
                      </span>
                    )}
                  </button>
                </li>
              );
            })
          )}
        </ul>
      </PopoverContent>
    </Popover>
  );
}

function DepartmentFilter({
  departments,
  selected,
  onChange,
}: {
  departments: Department[];
  selected: string[];
  onChange: (ids: string[]) => void;
}) {
  const [open, setOpen] = useState(false);

  function toggle(id: string) {
    onChange(selected.includes(id) ? selected.filter((x) => x !== id) : [...selected, id]);
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button variant="outline" size="sm" className="h-8 gap-1.5 text-xs">
          <Filter className="h-3 w-3" />
          Departments
          {selected.length > 0 && (
            <Badge
              variant="secondary"
              className="h-4 rounded-sm px-1 font-mono text-[10px]"
            >
              {selected.length}
            </Badge>
          )}
        </Button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-60 p-0">
        <ul className="max-h-72 overflow-y-auto py-1">
          {departments.length === 0 ? (
            <li className="py-6 text-center text-xs text-muted-foreground">
              No departments.
            </li>
          ) : (
            departments.map((d) => {
              const on = selected.includes(d.id);
              return (
                <li key={d.id}>
                  <button
                    type="button"
                    onClick={() => toggle(d.id)}
                    className={`flex w-full items-center gap-2 px-2.5 py-1.5 text-left text-sm hover:bg-muted ${
                      on ? "bg-muted/60" : ""
                    }`}
                  >
                    <span
                      className={`grid h-4 w-4 place-items-center rounded border ${
                        on
                          ? "border-primary bg-primary text-primary-foreground"
                          : "border-input"
                      }`}
                    >
                      {on && <Check className="h-3 w-3" />}
                    </span>
                    <span className="flex-1 truncate">{d.name}</span>
                  </button>
                </li>
              );
            })
          )}
        </ul>
      </PopoverContent>
    </Popover>
  );
}

// Color helpers — produce HSL strings aligned with our chart palette.
function lightHsl(idx: number, lightness?: number): string {
  const palette: Array<[number, number]> = [
    [217, 60], // 1 default fallback
    [271, 65], // purple
    [217, 60], // blue
    [160, 39], // emerald
    [142, 45], // green
    [173, 40], // teal
    [25, 53], // orange
    [234, 65], // indigo
    [38, 50], // amber
  ];
  const [h, l] = palette[idx] ?? palette[0];
  const finalL = typeof lightness === "number" ? Math.round(lightness * 100) : l;
  const s = idx === 0 ? 91 : 82;
  return `hsl(${h} ${s}% ${finalL}%)`;
}
function darkHsl(idx: number, lightness?: number): string {
  const palette: Array<[number, number]> = [
    [168, 55], // teal — fallback (matches dark primary)
    [271, 75],
    [217, 70],
    [160, 55],
    [142, 55],
    [173, 55],
    [25, 65],
    [234, 75],
    [38, 60],
  ];
  const [h, l] = palette[idx] ?? palette[0];
  const finalL = typeof lightness === "number" ? Math.round(lightness * 100) : l;
  return `hsl(${h} 70% ${finalL}%)`;
}
