import { randomBytes } from "node:crypto";
import { expect, type Browser, type BrowserContext, type Page } from "@playwright/test";
import type { ApprovalStatus, TimeEntryStatus } from "@prisma/client";
import { businessDateOnly } from "../../src/lib/format";
import { businessLocalToDate } from "../../src/lib/time-rules";
import { db, businessYmd } from "./db";
import { isServerAction } from "./helpers";
import { BASE_URL, IP_INSIDE, JOB_CODE, env } from "./test-data";
import { CW_AGENCY, cwKioskSlug, cwKioskSuffix } from "./contract-data";

export const uniq = (prefix: string) => `${prefix} ${randomBytes(3).toString("hex")}`;

/** Business-time (America/Chicago) wall clock -> instant. */
export function chicago(ymd: string, hhmm: string): Date {
  const d = businessLocalToDate(`${ymd}T${hhmm}`);
  if (!d) throw new Error(`Bad Chicago time ${ymd} ${hhmm}`);
  return d;
}

export async function agencyId(name: string): Promise<string> {
  return (await db.staffingAgency.findFirstOrThrow({ where: { name } })).id;
}
export const alphaId = () => agencyId(CW_AGENCY.alpha);
export const betaId = () => agencyId(CW_AGENCY.beta);

export async function makeAgency(opts: { name?: string; isActive?: boolean } = {}) {
  return db.staffingAgency.create({
    data: { name: opts.name ?? uniq("CW Agency"), isActive: opts.isActive ?? true },
  });
}

/** A fresh contract worker straight in the DB. Business ID is `CWX-xxxxxx` so auto-numbering is untouched. */
export async function makeWorker(
  opts: {
    name?: string;
    agencyId?: string;
    jobCode?: string | null;
    status?: "ACTIVE" | "ENDED";
    startDaysAgo?: number; // negative = starts in the future
    endDaysAgo?: number | null; // negative = ends in the future
    project?: string | null;
  } = {},
) {
  const startDaysAgo = opts.startDaysAgo ?? 10;
  const day = (n: number) => new Date(`${businessYmd(n)}T00:00:00.000Z`);
  return db.contractWorker.create({
    data: {
      workerId: `CWX-${randomBytes(3).toString("hex").toUpperCase()}`,
      name: opts.name ?? uniq("Worker"),
      agencyId: opts.agencyId ?? (await alphaId()),
      jobCode: opts.jobCode === undefined ? JOB_CODE.code : opts.jobCode,
      status: opts.status ?? "ACTIVE",
      startDate: day(startDaysAgo),
      endDate: opts.endDaysAgo === undefined || opts.endDaysAgo === null ? null : day(opts.endDaysAgo),
      project: opts.project === undefined ? "E2E Project" : opts.project,
    },
  });
}

/** A finished entry on business day `daysAgo`, Central wall-clock `in`..`out`. */
export async function makeEntry(
  workerDbId: string,
  opts: {
    daysAgo?: number;
    in?: string;
    out?: string;
    approval?: ApprovalStatus;
    jobCode?: string;
    notes?: string | null;
  } = {},
) {
  const ymd = businessYmd(opts.daysAgo ?? 1);
  const clockIn = chicago(ymd, opts.in ?? "09:00");
  const clockOut = chicago(ymd, opts.out ?? "17:00");
  const approval = opts.approval ?? "PENDING";
  return db.contractTimeEntry.create({
    data: {
      contractWorkerId: workerDbId,
      date: new Date(`${ymd}T00:00:00.000Z`),
      clockIn,
      clockOut,
      totalWorkMin: Math.round((clockOut.getTime() - clockIn.getTime()) / 60_000),
      status: (approval === "PENDING" ? "COMPLETED" : approval) as TimeEntryStatus,
      jobCode: opts.jobCode ?? JOB_CODE.code,
      approvalStatus: approval,
      approvalNotes: opts.notes ?? null,
    },
  });
}

/** An open (clocked-in) entry that started `hoursAgo` hours ago. */
export async function makeOpenEntry(workerDbId: string, hoursAgo = 1) {
  const clockIn = new Date(Date.now() - hoursAgo * 3_600_000);
  return db.contractTimeEntry.create({
    data: {
      contractWorkerId: workerDbId,
      date: businessDateOnly(clockIn),
      clockIn,
      status: "ACTIVE",
      jobCode: JOB_CODE.code,
    },
  });
}

/** A finished break on an entry (legacy data: the contract UI has no break buttons). */
export async function makeBreak(entryId: string, ymd: string, from: string, to: string) {
  const startTime = chicago(ymd, from);
  const endTime = chicago(ymd, to);
  return db.contractTimeBreak.create({
    data: {
      timeEntryId: entryId,
      startTime,
      endTime,
      durationMin: Math.round((endTime.getTime() - startTime.getTime()) / 60_000),
    },
  });
}

export const entriesOf =(workerDbId: string) =>
  db.contractTimeEntry.findMany({ where: { contractWorkerId: workerDbId }, orderBy: { clockIn: "asc" } });

export const auditCount = (action: string, resourceContains: string) =>
  db.auditLog.count({ where: { action, resource: { contains: resourceContains } } });

/**
 * Rewrite the body of every server-action call (to craft requests the UI would
 * never send). Returns a counter of rewritten calls.
 */
export async function tamperActions(page: Page, rewrite: (body: string) => string) {
  let n = 0;
  await page.route("**/*", async (route) => {
    if (!isServerAction(route)) return route.continue();
    const body = route.request().postData() ?? "";
    const next = rewrite(body);
    if (next !== body) n += 1;
    return route.continue({ postData: next });
  });
  return { count: () => n };
}

type Captured = { url: string; headers: Record<string, string>; body: string };

/**
 * Record server-action requests (without changing them) so a test can replay
 * them straight at the server, e.g. concurrently.
 */
export async function captureActions(page: Page) {
  const seen: Captured[] = [];
  await page.route("**/*", async (route) => {
    if (isServerAction(route)) {
      const r = route.request();
      seen.push({ url: r.url(), headers: r.headers(), body: r.postData() ?? "" });
    }
    return route.continue();
  });
  return seen;
}

export async function replay(ctx: BrowserContext, c: Captured, body = c.body) {
  const headers = { ...c.headers };
  delete headers["content-length"];
  delete headers["host"];
  const res = await ctx.request.post(c.url, { headers, data: body });
  return res.text();
}

/**
 * Open the kiosk for contract crew number `n` (1..CW_KIOSK_COUNT) on the Contract crew tab.
 * `noCamera` makes the browser report "permission denied" for the camera.
 */
export async function openCrewKiosk(
  browser: Browser,
  n: number,
  opts: { noCamera?: boolean; beforeCrew?: (page: Page) => Promise<void>; clock?: boolean } = {},
): Promise<Page> {
  const context = await browser.newContext({
    baseURL: BASE_URL,
    permissions: ["camera"],
    extraHTTPHeaders: { "x-forwarded-for": IP_INSIDE },
  });
  await context.addCookies([
    { name: "act_kiosk", value: env("E2E_KIOSK_COOKIE") + cwKioskSuffix(n), url: BASE_URL },
  ]);
  const page = await context.newPage();
  if (opts.noCamera) {
    await page.addInitScript(() => {
      navigator.mediaDevices.getUserMedia = () =>
        Promise.reject(new DOMException("Permission denied", "NotAllowedError"));
    });
  }
  if (opts.clock) await page.clock.install();
  await page.goto(`/kiosk/${cwKioskSlug(n)}`);
  await opts.beforeCrew?.(page);
  await page.getByRole("button", { name: /contract crew/i }).click();
  await expect(page.getByText(/agency staff/i).first()).toBeVisible();
  return page;
}

/** Click a worker row in the kiosk list; waits for the confirm card. */
export async function pickKioskWorker(page: Page, name: string) {
  await page.getByPlaceholder(/search by name or cw id/i).fill(name);
  await page.getByRole("button", { name: new RegExp(name) }).first().click();
  await expect(page.getByText("Agency staff", { exact: true })).toBeVisible();
}

export const kioskList = (page: Page, name: string) =>
  page.getByRole("button", { name: new RegExp(name) });

/** Admin page URLs. */
export const hoursUrl = (extra = "", from = businessYmd(6), to = businessYmd(0)) =>
  `/admin/contract-workers?tab=hours&from=${from}&to=${to}${extra}`;
export const workersUrl = (q = "") => `/admin/contract-workers?tab=workers${q ? `&q=${encodeURIComponent(q)}` : ""}`;

/** Click `trigger` and return the downloaded file's name and text. */
export async function downloadText(page: Page, trigger: () => Promise<void>) {
  const [download] = await Promise.all([page.waitForEvent("download"), trigger()]);
  const { createReadStream } = await import("node:fs");
  const path = await download.path();
  const chunks: Buffer[] = [];
  for await (const c of createReadStream(path)) chunks.push(c as Buffer);
  return { filename: download.suggestedFilename(), text: Buffer.concat(chunks).toString("utf8") };
}

/** Minimal CSV parse for our own always-quoted output (`"a","b"`). */
export function parseCsv(text: string): string[][] {
  return text
    .split("\r\n")
    .filter((l) => l.length > 0)
    .map((l) => [...l.matchAll(/"((?:[^"]|"")*)"(?:,|$)/g)].map((m) => m[1]!.replace(/""/g, '"')));
}
