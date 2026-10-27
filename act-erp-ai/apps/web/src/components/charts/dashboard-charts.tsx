"use client";

import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  ComposedChart,
  Label,
  Line,
  LineChart,
  Pie,
  PieChart,
  PolarAngleAxis,
  PolarGrid,
  PolarRadiusAxis,
  Radar,
  RadarChart,
  RadialBar,
  RadialBarChart,
  ReferenceLine,
  XAxis,
  YAxis,
} from "recharts";
import {
  ChartConfig,
  ChartContainer,
  ChartLegend,
  ChartLegendContent,
  ChartTooltip,
  ChartTooltipContent,
} from "@/components/ui/chart";
import { usePortalLanguage } from "@/components/portal-language";

const CHART_PALETTE = [
  "var(--color-chart-1)",
  "var(--color-chart-2)",
  "var(--color-chart-3)",
  "var(--color-chart-4)",
  "var(--color-chart-5)",
  "var(--color-chart-6)",
  "var(--color-chart-7)",
  "var(--color-chart-8)",
];

// ─────────────────────────────────────────────────────────────────────
// Hours by department (stacked bar)
// ─────────────────────────────────────────────────────────────────────

export function HoursByDeptChart({
  data,
}: {
  data: Array<Record<string, string | number>>;
}) {
  const departmentKeys = Array.from(
    new Set(data.flatMap((d) => Object.keys(d).filter((k) => k !== "week"))),
  );
  const config: ChartConfig = Object.fromEntries(
    departmentKeys.map((k, i) => [
      k,
      { label: k, color: `hsl(var(--chart-${(i % 8) + 1}))` },
    ]),
  );
  if (data.length === 0) return <Empty label="hours" />;
  return (
    <ChartContainer config={config} className="h-60 w-full">
      <BarChart data={data}>
        <CartesianGrid vertical={false} strokeOpacity={0.2} />
        <XAxis dataKey="week" tickLine={false} axisLine={false} fontSize={11} />
        <YAxis tickLine={false} axisLine={false} fontSize={11} width={32} />
        <ChartTooltip content={<ChartTooltipContent />} />
        <ChartLegend content={<ChartLegendContent />} />
        {departmentKeys.map((k, i) => (
          <Bar
            key={k}
            dataKey={k}
            stackId="a"
            fill={`hsl(var(--chart-${(i % 8) + 1}))`}
            radius={i === departmentKeys.length - 1 ? [4, 4, 0, 0] : 0}
          />
        ))}
      </BarChart>
    </ChartContainer>
  );
}

// ─────────────────────────────────────────────────────────────────────
// Hours trend (area)
// ─────────────────────────────────────────────────────────────────────

export function HoursTrendChart({
  data,
}: {
  data: Array<{ week: string; hours: number }>;
}) {
  const { t } = usePortalLanguage();
  if (data.length === 0) return <Empty label="trend" />;
  const config: ChartConfig = {
    hours: { label: t("home.charts.hours"), color: "hsl(var(--primary))" },
  };
  return (
    <ChartContainer config={config} className="h-60 w-full">
      <AreaChart data={data}>
        <defs>
          <linearGradient id="trendFill" x1="0" y1="0" x2="0" y2="1">
            <stop offset="5%" stopColor="hsl(var(--primary))" stopOpacity={0.45} />
            <stop offset="95%" stopColor="hsl(var(--primary))" stopOpacity={0} />
          </linearGradient>
        </defs>
        <CartesianGrid vertical={false} strokeOpacity={0.2} />
        <XAxis dataKey="week" tickLine={false} axisLine={false} fontSize={11} />
        <YAxis tickLine={false} axisLine={false} fontSize={11} width={32} />
        <ChartTooltip content={<ChartTooltipContent />} />
        <Area
          type="monotone"
          dataKey="hours"
          stroke="hsl(var(--primary))"
          fill="url(#trendFill)"
          strokeWidth={2}
        />
      </AreaChart>
    </ChartContainer>
  );
}

// ─────────────────────────────────────────────────────────────────────
// Donut chart (department headcount, leave types, etc.)
// ─────────────────────────────────────────────────────────────────────

export function DonutChart({
  data,
  nameKey,
  valueKey,
  paletteOffset = 0,
}: {
  data: Array<Record<string, string | number>>;
  nameKey: string;
  valueKey: string;
  /** Shifts which `--chart-N` slot the slices start from. Useful when two
   * donuts sit next to each other and need distinct palettes. */
  paletteOffset?: number;
}) {
  if (data.length === 0) return <Empty />;
  const colorFor = (i: number) => `hsl(var(--chart-${((i + paletteOffset) % 8) + 1}))`;
  const config: ChartConfig = Object.fromEntries(
    data.map((d, i) => [
      String(d[nameKey]),
      { label: String(d[nameKey]), color: colorFor(i) },
    ]),
  );
  return (
    <ChartContainer config={config} className="h-52 w-full">
      <PieChart>
        <ChartTooltip content={<ChartTooltipContent hideLabel />} />
        <Pie
          data={data}
          dataKey={valueKey}
          nameKey={nameKey}
          innerRadius={32}
          outerRadius={80}
          strokeWidth={2}
          paddingAngle={2}
        >
          {data.map((_, i) => (
            <Cell key={i} fill={colorFor(i)} />
          ))}
        </Pie>
        <ChartLegend content={<ChartLegendContent nameKey={nameKey} />} />
      </PieChart>
    </ChartContainer>
  );
}

// ─────────────────────────────────────────────────────────────────────
// Radar (spider web) — used for department headcount
// ─────────────────────────────────────────────────────────────────────

export function RadarSpiderChart({
  data,
  nameKey,
  valueKey,
}: {
  data: Array<Record<string, string | number>>;
  nameKey: string;
  valueKey: string;
}) {
  if (data.length === 0) return <Empty />;
  const config: ChartConfig = {
    [valueKey]: { label: valueKey, color: "hsl(var(--primary))" },
  };
  return (
    <ChartContainer config={config} className="h-72 w-full">
      <RadarChart
        data={data}
        outerRadius="85%"
        margin={{ top: 8, right: 8, bottom: 8, left: 8 }}
      >
        <PolarGrid strokeOpacity={0.35} />
        <PolarAngleAxis dataKey={nameKey} tick={{ fontSize: 11 }} />
        <PolarRadiusAxis tick={false} axisLine={false} />
        <ChartTooltip content={<ChartTooltipContent />} />
        <Radar
          dataKey={valueKey}
          stroke="hsl(var(--primary))"
          fill="hsl(var(--primary))"
          fillOpacity={0.55}
          strokeWidth={2}
          dot={{ r: 3, fill: "hsl(var(--primary))" }}
        />
      </RadarChart>
    </ChartContainer>
  );
}

// ─────────────────────────────────────────────────────────────────────
// Reimbursement category bar (horizontal-feel, left-justified labels)
// ─────────────────────────────────────────────────────────────────────

export function CategoryBar({
  data,
  labelKey,
  valueKey,
}: {
  data: Array<{ [k: string]: string | number }>;
  labelKey: string;
  valueKey: string;
}) {
  const { formatCurrency } = usePortalLanguage();
  if (data.length === 0) return <Empty />;
  const max = Math.max(...data.map((d) => Number(d[valueKey])), 1);
  return (
    <ul className="space-y-2.5">
      {data.map((d, i) => {
        const v = Number(d[valueKey]);
        const pct = (v / max) * 100;
        return (
          <li key={String(d[labelKey])} className="space-y-1">
            <div className="flex items-baseline justify-between text-xs">
              <span className="text-muted-foreground">{String(d[labelKey])}</span>
              <span className="font-mono tabular-nums">{formatCurrency(v)}</span>
            </div>
            <div className="h-1.5 overflow-hidden rounded-full bg-muted">
              <div
                className="h-full rounded-full"
                style={{
                  width: `${pct}%`,
                  background: `hsl(var(--chart-${(i % 8) + 1}))`,
                }}
              />
            </div>
          </li>
        );
      })}
    </ul>
  );
}

// ─────────────────────────────────────────────────────────────────────
// Headcount growth line
// ─────────────────────────────────────────────────────────────────────

export function HeadcountGrowthChart({
  data,
}: {
  data: Array<{ month: string; count: number }>;
}) {
  const { t } = usePortalLanguage();
  if (data.length === 0) return <Empty />;
  const config: ChartConfig = {
    count: { label: t("home.charts.headcount"), color: "hsl(var(--chart-1))" },
  };
  return (
    <ChartContainer config={config} className="h-52 w-full">
      <LineChart data={data}>
        <CartesianGrid vertical={false} strokeOpacity={0.2} />
        <XAxis
          dataKey="month"
          tickLine={false}
          axisLine={false}
          fontSize={10}
          interval={Math.floor(data.length / 8)}
        />
        <YAxis tickLine={false} axisLine={false} fontSize={10} width={24} />
        <ChartTooltip content={<ChartTooltipContent />} />
        <Line
          type="monotone"
          dataKey="count"
          stroke="hsl(var(--chart-1))"
          strokeWidth={2}
          dot={false}
        />
      </LineChart>
    </ChartContainer>
  );
}

// ─────────────────────────────────────────────────────────────────────
// Weekly hours (bar) — hours clocked per day across a week
// ─────────────────────────────────────────────────────────────────────

export function WeeklyHoursChart({
  data,
}: {
  /** Each item: a day in the period. `weekday` (0=Sun..6=Sat) drives the color. */
  data: Array<{ day: string; hours: number; weekday: number }>;
}) {
  const { t, locale } = usePortalLanguage();
  const total = data.reduce((s, d) => s + d.hours, 0);
  if (total === 0) return <Empty label="hours" />;
  // Distinct color per weekday so Mon/Tue/.../Sun each have their own hue.
  const colorFor = (weekday: number) => `hsl(var(--chart-${(weekday % 8) + 1}))`;
  const config: ChartConfig = {
    hours: { label: t("home.charts.hours"), color: "hsl(var(--chart-1))" },
  };
  return (
    <ChartContainer config={config} className="h-44 w-full">
      <BarChart data={data}>
        <CartesianGrid vertical={false} strokeOpacity={0.2} />
        <XAxis
          dataKey="day"
          tickLine={false}
          axisLine={false}
          fontSize={10}
          interval={0}
        />
        <YAxis tickLine={false} axisLine={false} fontSize={11} width={24} />
        <ChartTooltip
          content={
            <ChartTooltipContent
              formatter={(value) =>
                `${new Intl.NumberFormat(locale, { minimumFractionDigits: 1, maximumFractionDigits: 1 }).format(Number(value))}h`
              }
            />
          }
        />
        <Bar dataKey="hours" radius={[4, 4, 0, 0]}>
          {data.map((d, i) => (
            <Cell key={i} fill={colorFor(d.weekday)} />
          ))}
        </Bar>
      </BarChart>
    </ChartContainer>
  );
}

function Empty({ label = "data" }: { label?: string }) {
  const { t } = usePortalLanguage();
  return (
    <div className="grid h-full min-h-40 place-items-center text-xs text-muted-foreground">
      {t(`home.charts.empty.${label}`)}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────
// Clocked-in vs scheduled — radial gauge w/ delta tiles
// ─────────────────────────────────────────────────────────────────────

export function ClockedVsScheduledChart({
  data,
}: {
  data: {
    clockedIn: number;
    scheduledNow: number;
    noShow: number;
    unscheduledClockedIn: number;
    scheduledTodayTotal: number;
  };
}) {
  const { t, locale } = usePortalLanguage();
  const config: ChartConfig = {
    clockedIn: { label: t("home.charts.clockedIn"), color: "hsl(var(--chart-1))" },
    scheduledNow: { label: t("home.charts.scheduledNow"), color: "hsl(var(--chart-3))" },
  };
  const radial = [
    {
      name: t("home.charts.scheduledNow"),
      value: data.scheduledNow,
      fill: "hsl(var(--chart-3))",
    },
    {
      name: t("home.charts.clockedIn"),
      value: data.clockedIn,
      fill: "hsl(var(--chart-1))",
    },
  ];
  const coverage =
    data.scheduledNow > 0
      ? Math.round((data.clockedIn / data.scheduledNow) * 100)
      : data.clockedIn > 0
        ? 100
        : 0;
  return (
    <div className="grid items-center gap-4 sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
      <ChartContainer config={config} className="mx-auto aspect-square h-44 w-44">
        <RadialBarChart
          data={radial}
          innerRadius="55%"
          outerRadius="100%"
          startAngle={90}
          endAngle={-270}
          barSize={14}
        >
          <RadialBar
            dataKey="value"
            cornerRadius={8}
            background={{ fill: "hsl(var(--muted))" }}
            isAnimationActive
            animationDuration={900}
          />
          <ChartTooltip content={<ChartTooltipContent hideLabel />} />
          <Label
            position="center"
            content={() => (
              <text x="50%" y="50%" textAnchor="middle" dominantBaseline="middle">
                <tspan
                  x="50%"
                  dy="-0.4em"
                  className="fill-foreground"
                  style={{ fontSize: 28, fontWeight: 700 }}
                >
                  {new Intl.NumberFormat(locale).format(coverage)}%
                </tspan>
                <tspan
                  x="50%"
                  dy="1.4em"
                  className="fill-muted-foreground"
                  style={{ fontSize: 10, textTransform: "uppercase", letterSpacing: 1 }}
                >
                  {t("home.charts.coverage")}
                </tspan>
              </text>
            )}
          />
        </RadialBarChart>
      </ChartContainer>
      <div className="grid grid-cols-2 gap-2">
        <Tile
          label={t("home.charts.clockedIn")}
          value={new Intl.NumberFormat(locale).format(data.clockedIn)}
          tone="primary"
        />
        <Tile
          label={t("home.charts.scheduledNow")}
          value={new Intl.NumberFormat(locale).format(data.scheduledNow)}
          tone="muted"
        />
        <Tile
          label={t("home.charts.noShows")}
          value={new Intl.NumberFormat(locale).format(data.noShow)}
          tone={data.noShow > 0 ? "danger" : "muted"}
        />
        <Tile
          label={t("home.charts.walkIns")}
          value={new Intl.NumberFormat(locale).format(data.unscheduledClockedIn)}
          tone="muted"
        />
      </div>
    </div>
  );
}

function Tile({
  label,
  value,
  tone = "muted",
}: {
  label: string;
  value: React.ReactNode;
  tone?: "primary" | "danger" | "muted";
}) {
  const toneCls =
    tone === "primary"
      ? "text-primary"
      : tone === "danger"
        ? "text-destructive"
        : "text-foreground";
  return (
    <div className="rounded-md border bg-card px-3 py-2">
      <p className="text-[10px] uppercase tracking-wider text-muted-foreground">
        {label}
      </p>
      <p className={`mt-0.5 text-xl font-semibold tabular-nums ${toneCls}`}>{value}</p>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────
// Department utilization — composed: bars (worked vs scheduled) + line (util %)
// ─────────────────────────────────────────────────────────────────────

export function DeptUtilizationChart({
  data,
}: {
  data: Array<{
    department: string;
    headcount: number;
    scheduled: number;
    worked: number;
    utilization: number;
  }>;
}) {
  const { t, locale } = usePortalLanguage();
  if (data.length === 0) return <Empty label="utilization" />;
  const config: ChartConfig = {
    scheduled: { label: t("home.charts.scheduledHours"), color: "hsl(var(--chart-2))" },
    worked: { label: t("home.charts.workedHours"), color: "hsl(var(--chart-1))" },
    utilization: { label: t("home.charts.utilization"), color: "hsl(var(--chart-5))" },
  };
  return (
    <ChartContainer config={config} className="h-64 w-full">
      <ComposedChart data={data}>
        <CartesianGrid vertical={false} strokeOpacity={0.2} />
        <XAxis dataKey="department" tickLine={false} axisLine={false} fontSize={11} />
        <YAxis
          yAxisId="hours"
          tickLine={false}
          axisLine={false}
          fontSize={11}
          width={32}
        />
        <YAxis
          yAxisId="pct"
          orientation="right"
          tickLine={false}
          axisLine={false}
          fontSize={11}
          width={32}
          tickFormatter={(v) => `${new Intl.NumberFormat(locale).format(v)}%`}
        />
        <ChartTooltip content={<ChartTooltipContent />} />
        <ChartLegend content={<ChartLegendContent />} />
        <Bar
          yAxisId="hours"
          dataKey="scheduled"
          fill="hsl(var(--chart-2))"
          radius={[4, 4, 0, 0]}
          isAnimationActive
          animationDuration={800}
        />
        <Bar
          yAxisId="hours"
          dataKey="worked"
          fill="hsl(var(--chart-1))"
          radius={[4, 4, 0, 0]}
          isAnimationActive
          animationDuration={900}
        />
        <Line
          yAxisId="pct"
          type="monotone"
          dataKey="utilization"
          stroke="hsl(var(--chart-5))"
          strokeWidth={2}
          dot={{ r: 3 }}
          isAnimationActive
          animationDuration={1000}
        />
      </ComposedChart>
    </ChartContainer>
  );
}

// ─────────────────────────────────────────────────────────────────────
// Payroll cost trend — area + bars combined
// ─────────────────────────────────────────────────────────────────────

export function PayrollTrendChart({
  data,
}: {
  data: Array<{ period: string; cost: number; hours: number }>;
}) {
  const { t, locale, formatCurrency } = usePortalLanguage();
  if (data.length === 0) return <Empty label="payroll" />;
  const config: ChartConfig = {
    cost: { label: t("home.charts.estimatedCost"), color: "hsl(var(--chart-1))" },
    hours: { label: t("home.charts.hours"), color: "hsl(var(--chart-4))" },
  };
  return (
    <ChartContainer config={config} className="h-60 w-full">
      <ComposedChart data={data}>
        <defs>
          <linearGradient id="payrollFill" x1="0" y1="0" x2="0" y2="1">
            <stop offset="5%" stopColor="hsl(var(--chart-1))" stopOpacity={0.45} />
            <stop offset="95%" stopColor="hsl(var(--chart-1))" stopOpacity={0} />
          </linearGradient>
        </defs>
        <CartesianGrid vertical={false} strokeOpacity={0.2} />
        <XAxis dataKey="period" tickLine={false} axisLine={false} fontSize={11} />
        <YAxis
          yAxisId="cost"
          tickLine={false}
          axisLine={false}
          fontSize={11}
          width={48}
          tickFormatter={(v) => `${formatCurrency(v / 1000, "USD")}k`}
        />
        <YAxis
          yAxisId="hrs"
          orientation="right"
          tickLine={false}
          axisLine={false}
          fontSize={11}
          width={32}
        />
        <ChartTooltip
          content={
            <ChartTooltipContent
              formatter={(value, name) =>
                name === "cost"
                  ? formatCurrency(Number(value))
                  : `${new Intl.NumberFormat(locale).format(Number(value))} ${t("home.charts.hoursShort")}`
              }
            />
          }
        />
        <ChartLegend content={<ChartLegendContent />} />
        <Bar
          yAxisId="hrs"
          dataKey="hours"
          fill="hsl(var(--chart-4))"
          radius={[4, 4, 0, 0]}
          opacity={0.55}
          isAnimationActive
          animationDuration={800}
        />
        <Area
          yAxisId="cost"
          type="monotone"
          dataKey="cost"
          stroke="hsl(var(--chart-1))"
          fill="url(#payrollFill)"
          strokeWidth={2}
          isAnimationActive
          animationDuration={900}
        />
      </ComposedChart>
    </ChartContainer>
  );
}

// ─────────────────────────────────────────────────────────────────────
// Overtime risk — top employees w/ 40h reference line
// ─────────────────────────────────────────────────────────────────────

export function OvertimeRiskChart({
  data,
}: {
  data: Array<{ name: string; hours: number; overtime: boolean; department: string }>;
}) {
  const { t, locale } = usePortalLanguage();
  if (data.length === 0) return <Empty label="hours" />;
  const config: ChartConfig = {
    hours: { label: t("home.charts.hours"), color: "hsl(var(--chart-1))" },
  };
  return (
    <ChartContainer config={config} className="h-72 w-full">
      <BarChart data={data} layout="vertical" margin={{ left: 12, right: 24 }}>
        <CartesianGrid horizontal={false} strokeOpacity={0.2} />
        <XAxis type="number" tickLine={false} axisLine={false} fontSize={11} />
        <YAxis
          dataKey="name"
          type="category"
          tickLine={false}
          axisLine={false}
          fontSize={11}
          width={110}
        />
        <ChartTooltip content={<ChartTooltipContent />} />
        <ReferenceLine
          x={40}
          stroke="hsl(var(--destructive))"
          strokeDasharray="4 4"
          label={{
            value: `${new Intl.NumberFormat(locale).format(40)}h`,
            position: "top",
            fill: "hsl(var(--destructive))",
            fontSize: 10,
          }}
        />
        <Bar
          dataKey="hours"
          radius={[0, 6, 6, 0]}
          isAnimationActive
          animationDuration={900}
        >
          {data.map((d, i) => (
            <Cell
              key={i}
              fill={d.overtime ? "hsl(var(--destructive))" : "hsl(var(--chart-1))"}
            />
          ))}
        </Bar>
      </BarChart>
    </ChartContainer>
  );
}

// ─────────────────────────────────────────────────────────────────────
// Pending approvals aging — stacked bars by queue
// ─────────────────────────────────────────────────────────────────────

export function ApprovalsAgingChart({
  data,
}: {
  data: Array<Record<string, string | number>>;
}) {
  const { t } = usePortalLanguage();
  const queues = ["Timesheets", "Leave", "Requests", "Reimbursements"] as const;
  const total = data.reduce(
    (s, row) => s + queues.reduce((q, k) => q + Number(row[k] ?? 0), 0),
    0,
  );
  if (total === 0) return <Empty label="pending items" />;
  const config: ChartConfig = Object.fromEntries(
    queues.map((q, i) => [
      q,
      {
        label: t(`home.charts.queue.${q.toLowerCase()}`),
        color: `hsl(var(--chart-${i + 1}))`,
      },
    ]),
  );
  return (
    <ChartContainer config={config} className="h-60 w-full">
      <BarChart data={data}>
        <CartesianGrid vertical={false} strokeOpacity={0.2} />
        <XAxis dataKey="age" tickLine={false} axisLine={false} fontSize={11} />
        <YAxis tickLine={false} axisLine={false} fontSize={11} width={28} />
        <ChartTooltip content={<ChartTooltipContent />} />
        <ChartLegend content={<ChartLegendContent />} />
        {queues.map((k, i) => (
          <Bar
            key={k}
            dataKey={k}
            stackId="a"
            fill={`hsl(var(--chart-${i + 1}))`}
            radius={i === queues.length - 1 ? [4, 4, 0, 0] : 0}
            isAnimationActive
            animationDuration={800}
          />
        ))}
      </BarChart>
    </ChartContainer>
  );
}

// ─────────────────────────────────────────────────────────────────────
// Leave heatmap — calendar grid of next 30 days
// ─────────────────────────────────────────────────────────────────────

export function LeaveHeatmap({
  data,
}: {
  data: Array<{ date: string; label: string; count: number; weekday: number }>;
}) {
  const { t, locale } = usePortalLanguage();
  if (data.length === 0) return <Empty label="leave" />;
  const max = Math.max(...data.map((d) => d.count), 1);
  // Pad start so columns align with weekday (Mon=1 .. Sun=0 -> shift Sun to end).
  const firstDow = data[0].weekday;
  const padCount = (firstDow + 6) % 7; // weeks start Monday
  const cells: Array<{ date?: string; label?: string; count?: number } | null> = [
    ...Array.from({ length: padCount }, () => null),
    ...data,
  ];
  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between text-[10px] uppercase tracking-wider text-muted-foreground">
        <span>{t("home.charts.next30Days")}</span>
        <span className="flex items-center gap-1.5">
          {t("home.charts.less")}
          {[0.15, 0.35, 0.6, 0.85, 1].map((o, i) => (
            <span
              key={i}
              className="h-3 w-3 rounded-sm"
              style={{ background: `hsl(var(--chart-1) / ${o})` }}
            />
          ))}
          {t("home.charts.more")}
        </span>
      </div>
      <div className="grid grid-cols-7 gap-1.5">
        {Array.from({ length: 7 }, (_, i) =>
          new Intl.DateTimeFormat(locale, { timeZone: "UTC", weekday: "narrow" }).format(
            new Date(Date.UTC(2024, 0, i + 1)),
          ),
        ).map((d, i) => (
          <div key={i} className="text-center text-[10px] text-muted-foreground">
            {d}
          </div>
        ))}
        {cells.map((c, i) =>
          c ? (
            <div
              key={i}
              className="group relative aspect-square rounded-md border transition-transform hover:scale-110"
              style={{
                background:
                  c.count && c.count > 0
                    ? `hsl(var(--chart-1) / ${0.15 + (c.count! / max) * 0.85})`
                    : "hsl(var(--muted) / 0.4)",
              }}
              title={t("home.charts.leaveHeatmapTooltip", {
                date: c.label ?? "",
                count: new Intl.NumberFormat(locale).format(c.count!),
              })}
            >
              <span className="absolute inset-0 grid place-items-center text-[10px] font-medium tabular-nums">
                {c.count && c.count > 0 ? c.count : ""}
              </span>
            </div>
          ) : (
            <div key={i} className="aspect-square" />
          ),
        )}
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────
// Requests funnel — horizontal stacked bars per type
// ─────────────────────────────────────────────────────────────────────

export function RequestsFunnel({
  data,
}: {
  data: Array<{
    type: string;
    total: number;
    pending: number;
    approved: number;
    rejected: number;
    other: number;
    medianHours: number;
  }>;
}) {
  const { t, locale, enumLabel } = usePortalLanguage();
  if (data.length === 0) return <Empty label="requests" />;
  const max = Math.max(...data.map((d) => d.total), 1);
  return (
    <ul className="space-y-3">
      {data.map((d) => {
        const segments = [
          { key: "approved", v: d.approved, color: "hsl(var(--chart-1))" },
          { key: "pending", v: d.pending, color: "hsl(var(--chart-3))" },
          { key: "rejected", v: d.rejected, color: "hsl(var(--destructive))" },
          { key: "other", v: d.other, color: "hsl(var(--chart-5))" },
        ];
        const widthPct = (d.total / max) * 100;
        return (
          <li key={d.type} className="space-y-1">
            <div className="flex items-baseline justify-between text-xs">
              <span className="font-medium">
                {enumLabel(d.type.replace(/\s+/g, "_").toUpperCase())}
              </span>
              <span className="font-mono tabular-nums text-muted-foreground">
                {new Intl.NumberFormat(locale).format(d.total)} ·{" "}
                {t("home.charts.toDecide", {
                  hours: new Intl.NumberFormat(locale).format(d.medianHours),
                })}
              </span>
            </div>
            <div className="h-3 overflow-hidden rounded-full bg-muted">
              <div
                className="flex h-full transition-[width] duration-700"
                style={{ width: `${widthPct}%` }}
              >
                {segments.map((s) =>
                  s.v > 0 ? (
                    <div
                      key={s.key}
                      title={t("home.charts.segmentCount", {
                        label: t(`home.charts.${s.key}`),
                        count: new Intl.NumberFormat(locale).format(s.v),
                      })}
                      style={{
                        flex: s.v,
                        background: s.color,
                      }}
                    />
                  ) : null,
                )}
              </div>
            </div>
          </li>
        );
      })}
    </ul>
  );
}

// ─────────────────────────────────────────────────────────────────────
// Employee charts — personal hours trend (8 weeks)
// ─────────────────────────────────────────────────────────────────────

export function PersonalHoursTrend({
  data,
}: {
  data: Array<{ week: string; hours: number }>;
}) {
  const { t } = usePortalLanguage();
  if (data.length === 0) return <Empty label="hours" />;
  const config: ChartConfig = {
    hours: { label: t("home.charts.hours"), color: "hsl(var(--chart-2))" },
  };
  return (
    <ChartContainer config={config} className="h-52 w-full">
      <AreaChart data={data}>
        <defs>
          <linearGradient id="personalTrendFill" x1="0" y1="0" x2="0" y2="1">
            <stop offset="5%" stopColor="hsl(var(--chart-2))" stopOpacity={0.5} />
            <stop offset="95%" stopColor="hsl(var(--chart-2))" stopOpacity={0} />
          </linearGradient>
        </defs>
        <CartesianGrid vertical={false} strokeOpacity={0.2} />
        <XAxis dataKey="week" tickLine={false} axisLine={false} fontSize={11} />
        <YAxis tickLine={false} axisLine={false} fontSize={11} width={28} />
        <ChartTooltip content={<ChartTooltipContent />} />
        <ReferenceLine
          y={40}
          stroke="hsl(var(--muted-foreground))"
          strokeDasharray="3 3"
          label={{
            value: "40h",
            position: "right",
            fontSize: 10,
            fill: "hsl(var(--muted-foreground))",
          }}
        />
        <Area
          type="monotone"
          dataKey="hours"
          stroke="hsl(var(--chart-2))"
          strokeWidth={2}
          fill="url(#personalTrendFill)"
          isAnimationActive
          animationDuration={900}
        />
      </AreaChart>
    </ChartContainer>
  );
}

// ─────────────────────────────────────────────────────────────────────
// Employee — scheduled vs worked per weekday
// ─────────────────────────────────────────────────────────────────────

export function ScheduledVsWorkedChart({
  data,
}: {
  data: Array<{ day: string; scheduled: number; worked: number }>;
}) {
  const { t, locale } = usePortalLanguage();
  const total = data.reduce((s, d) => s + d.scheduled + d.worked, 0);
  if (total === 0) return <Empty label="hours" />;
  const config: ChartConfig = {
    scheduled: { label: t("home.charts.scheduled"), color: "hsl(var(--chart-2))" },
    worked: { label: t("home.charts.worked"), color: "hsl(var(--chart-1))" },
  };
  return (
    <ChartContainer config={config} className="h-52 w-full">
      <BarChart data={data}>
        <CartesianGrid vertical={false} strokeOpacity={0.2} />
        <XAxis dataKey="day" tickLine={false} axisLine={false} fontSize={11} />
        <YAxis tickLine={false} axisLine={false} fontSize={11} width={28} />
        <ChartTooltip
          content={
            <ChartTooltipContent
              formatter={(value) =>
                `${new Intl.NumberFormat(locale, { minimumFractionDigits: 1, maximumFractionDigits: 1 }).format(Number(value))}h`
              }
            />
          }
        />
        <ChartLegend content={<ChartLegendContent />} />
        <Bar
          dataKey="scheduled"
          fill="hsl(var(--chart-2))"
          radius={[4, 4, 0, 0]}
          isAnimationActive
          animationDuration={800}
        />
        <Bar
          dataKey="worked"
          fill="hsl(var(--chart-1))"
          radius={[4, 4, 0, 0]}
          isAnimationActive
          animationDuration={900}
        />
      </BarChart>
    </ChartContainer>
  );
}

// ─────────────────────────────────────────────────────────────────────
// Employee — leave balance donut w/ center label
// ─────────────────────────────────────────────────────────────────────

export function LeaveBalanceDonut({
  taken,
  approved,
  remaining,
}: {
  taken: number;
  approved: number;
  remaining: number;
}) {
  const { t, locale } = usePortalLanguage();
  const total = taken + approved + remaining;
  if (total === 0) return <Empty label="leave" />;
  const data = [
    { name: t("home.charts.taken"), value: taken, fill: "hsl(var(--chart-1))" },
    {
      name: t("home.charts.approvedUpcoming"),
      value: approved,
      fill: "hsl(var(--chart-3))",
    },
    { name: t("home.charts.remaining"), value: remaining, fill: "hsl(var(--chart-2))" },
  ];
  const config: ChartConfig = {
    [t("home.charts.taken")]: {
      label: t("home.charts.taken"),
      color: "hsl(var(--chart-1))",
    },
    [t("home.charts.approvedUpcoming")]: {
      label: t("home.charts.approvedUpcoming"),
      color: "hsl(var(--chart-3))",
    },
    [t("home.charts.remaining")]: {
      label: t("home.charts.remaining"),
      color: "hsl(var(--chart-2))",
    },
  };
  return (
    <ChartContainer config={config} className="mx-auto aspect-square h-56 w-56">
      <PieChart>
        <ChartTooltip content={<ChartTooltipContent hideLabel />} />
        <Pie
          data={data}
          dataKey="value"
          nameKey="name"
          innerRadius={56}
          outerRadius={88}
          paddingAngle={2}
          strokeWidth={2}
          isAnimationActive
          animationDuration={900}
        >
          {data.map((d, i) => (
            <Cell key={i} fill={d.fill} />
          ))}
          <Label
            position="center"
            content={() => (
              <text x="50%" y="50%" textAnchor="middle" dominantBaseline="middle">
                <tspan
                  x="50%"
                  dy="-0.4em"
                  className="fill-foreground"
                  style={{ fontSize: 26, fontWeight: 700 }}
                >
                  {new Intl.NumberFormat(locale).format(remaining)}
                </tspan>
                <tspan
                  x="50%"
                  dy="1.4em"
                  className="fill-muted-foreground"
                  style={{ fontSize: 10, textTransform: "uppercase", letterSpacing: 1 }}
                >
                  {t("home.charts.daysLeft")}
                </tspan>
              </text>
            )}
          />
        </Pie>
        <ChartLegend content={<ChartLegendContent nameKey="name" />} />
      </PieChart>
    </ChartContainer>
  );
}

// ─────────────────────────────────────────────────────────────────────
// Employee — pay snapshot bar chart
// ─────────────────────────────────────────────────────────────────────

export function PaySnapshotChart({
  data,
}: {
  data: Array<{ period: string; estimate: number; hours: number }>;
}) {
  const { t, locale, formatCurrency } = usePortalLanguage();
  if (data.length === 0) return <Empty label="pay" />;
  const config: ChartConfig = {
    estimate: { label: t("home.charts.estimatedPay"), color: "hsl(var(--chart-1))" },
  };
  return (
    <ChartContainer config={config} className="h-52 w-full">
      <BarChart data={data}>
        <CartesianGrid vertical={false} strokeOpacity={0.2} />
        <XAxis dataKey="period" tickLine={false} axisLine={false} fontSize={11} />
        <YAxis
          tickLine={false}
          axisLine={false}
          fontSize={11}
          width={40}
          tickFormatter={(v) => `${formatCurrency(v / 1000, "USD")}k`}
        />
        <ChartTooltip
          content={
            <ChartTooltipContent
              formatter={(value, name) =>
                name === "estimate"
                  ? formatCurrency(Number(value))
                  : new Intl.NumberFormat(locale).format(Number(value))
              }
            />
          }
        />
        <Bar
          dataKey="estimate"
          fill="hsl(var(--chart-1))"
          radius={[6, 6, 0, 0]}
          isAnimationActive
          animationDuration={900}
        />
      </BarChart>
    </ChartContainer>
  );
}

// ─────────────────────────────────────────────────────────────────────
// Employee — reimbursement timeline (stacked status by month)
// ─────────────────────────────────────────────────────────────────────

export function ReimbursementTimelineChart({
  data,
}: {
  data: Array<{
    month: string;
    PENDING: number;
    APPROVED: number;
    PAID: number;
    REJECTED: number;
  }>;
}) {
  const { t } = usePortalLanguage();
  const total = data.reduce(
    (s, d) => s + d.PENDING + d.APPROVED + d.PAID + d.REJECTED,
    0,
  );
  if (total === 0) return <Empty label="reimbursements" />;
  const config: ChartConfig = {
    PENDING: { label: t("home.charts.pending"), color: "hsl(var(--chart-3))" },
    APPROVED: { label: t("home.charts.approved"), color: "hsl(var(--chart-2))" },
    PAID: { label: t("home.charts.paid"), color: "hsl(var(--chart-1))" },
    REJECTED: { label: t("home.charts.rejected"), color: "hsl(var(--destructive))" },
  };
  return (
    <ChartContainer config={config} className="h-52 w-full">
      <BarChart data={data}>
        <CartesianGrid vertical={false} strokeOpacity={0.2} />
        <XAxis dataKey="month" tickLine={false} axisLine={false} fontSize={11} />
        <YAxis tickLine={false} axisLine={false} fontSize={11} width={28} />
        <ChartTooltip content={<ChartTooltipContent />} />
        <ChartLegend content={<ChartLegendContent />} />
        {(["PENDING", "APPROVED", "PAID", "REJECTED"] as const).map((k, i, arr) => (
          <Bar
            key={k}
            dataKey={k}
            stackId="r"
            fill={config[k].color}
            radius={i === arr.length - 1 ? [4, 4, 0, 0] : 0}
            isAnimationActive
            animationDuration={800}
          />
        ))}
      </BarChart>
    </ChartContainer>
  );
}

// ─────────────────────────────────────────────────────────────────────
// Employee — punctuality ring + breakdown
// ─────────────────────────────────────────────────────────────────────

export function PunctualityChart({
  onTime,
  late,
  missed,
}: {
  onTime: number;
  late: number;
  missed: number;
}) {
  const { t, locale } = usePortalLanguage();
  const total = onTime + late + missed;
  if (total === 0) return <Empty label="attendance" />;
  const score = Math.round((onTime / total) * 100);
  const data = [
    { name: t("home.charts.onTime"), value: onTime, fill: "hsl(var(--chart-1))" },
    { name: t("home.charts.late"), value: late, fill: "hsl(var(--chart-3))" },
    { name: t("home.charts.missed"), value: missed, fill: "hsl(var(--destructive))" },
  ];
  const config: ChartConfig = {
    [t("home.charts.onTime")]: {
      label: t("home.charts.onTime"),
      color: "hsl(var(--chart-1))",
    },
    [t("home.charts.late")]: {
      label: t("home.charts.late"),
      color: "hsl(var(--chart-3))",
    },
    [t("home.charts.missed")]: {
      label: t("home.charts.missed"),
      color: "hsl(var(--destructive))",
    },
  };
  return (
    <div className="grid items-center gap-4 sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
      <ChartContainer config={config} className="mx-auto aspect-square h-44 w-44">
        <RadialBarChart
          data={[{ name: "score", value: score, fill: "hsl(var(--chart-1))" }]}
          innerRadius="70%"
          outerRadius="100%"
          startAngle={90}
          endAngle={90 - (score / 100) * 360}
        >
          <RadialBar
            dataKey="value"
            cornerRadius={8}
            background={{ fill: "hsl(var(--muted))" }}
            isAnimationActive
            animationDuration={1000}
          />
          <Label
            position="center"
            content={() => (
              <text x="50%" y="50%" textAnchor="middle" dominantBaseline="middle">
                <tspan
                  x="50%"
                  dy="-0.4em"
                  className="fill-foreground"
                  style={{ fontSize: 28, fontWeight: 700 }}
                >
                  {new Intl.NumberFormat(locale).format(score)}%
                </tspan>
                <tspan
                  x="50%"
                  dy="1.4em"
                  className="fill-muted-foreground"
                  style={{ fontSize: 10, textTransform: "uppercase", letterSpacing: 1 }}
                >
                  {t("home.charts.onTime")}
                </tspan>
              </text>
            )}
          />
        </RadialBarChart>
      </ChartContainer>
      <ul className="space-y-2 text-sm">
        {data.map((d) => (
          <li key={d.name} className="flex items-center justify-between gap-3">
            <span className="flex items-center gap-2">
              <span className="h-2.5 w-2.5 rounded-full" style={{ background: d.fill }} />
              {d.name}
            </span>
            <span className="font-mono tabular-nums">
              {new Intl.NumberFormat(locale).format(d.value)}
            </span>
          </li>
        ))}
        <li className="flex items-center justify-between gap-3 border-t pt-2 text-xs text-muted-foreground">
          <span>{t("home.charts.totalScheduledDays")}</span>
          <span className="font-mono tabular-nums">
            {new Intl.NumberFormat(locale).format(total)}
          </span>
        </li>
      </ul>
    </div>
  );
}

export { CHART_PALETTE };
