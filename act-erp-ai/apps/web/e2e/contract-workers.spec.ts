import { test, expect, type Locator, type Page } from "@playwright/test";
import { nextContractWorkerIdFrom } from "../src/lib/contract-workers";
import { businessYmd, db } from "./support/db";
import { delayServerActions, expectNoCrash, failServerActions, toast } from "./support/helpers";
import { ADMIN_STATE, BASE_URL, INACTIVE_JOB_CODE, JOB_CODE, env } from "./support/test-data";
import { CW_AGENCY, CW_JOB, CW_SEED_OLDCODE_WORKER } from "./support/contract-data";
import {
  alphaId,
  auditCount,
  betaId,
  captureActions,
  entriesOf,
  makeAgency,
  makeOpenEntry,
  makeWorker,
  replay,
  tamperActions,
  uniq,
  workersUrl,
} from "./support/contract";

test.use({ storageState: ADMIN_STATE });

const row = (page: Page, name: string) => page.getByRole("row").filter({ hasText: name });
const workerCount = () => db.contractWorker.count();
const byName = (name: string) => db.contractWorker.findFirst({ where: { name } });
const ymdDate = (ymd: string) => new Date(`${ymd}T00:00:00.000Z`);

async function openWorkers(page: Page, q = "") {
  await page.goto(workersUrl(q));
  await expect(page.getByRole("button", { name: /add contract worker/i })).toBeVisible();
}

async function openAddWorker(page: Page) {
  await openWorkers(page);
  await page.getByRole("button", { name: /add contract worker/i }).click();
  const dialog = page.getByRole("dialog");
  await expect(dialog.getByRole("heading", { name: /add contract worker/i })).toBeVisible();
  return dialog;
}

type Fill = {
  name?: string;
  phone?: string;
  agency?: string; // agency id
  jobCode?: string;
  project?: string;
  start?: string;
  end?: string;
  notes?: string;
};
async function fillWorker(dialog: Locator, f: Fill) {
  if (f.name !== undefined) await dialog.getByLabel("Name", { exact: true }).fill(f.name);
  if (f.phone !== undefined) await dialog.getByLabel("Phone").fill(f.phone);
  if (f.agency !== undefined) await dialog.getByLabel("Agency").selectOption(f.agency);
  if (f.jobCode !== undefined) await dialog.getByLabel("Job code").selectOption(f.jobCode);
  if (f.project !== undefined) await dialog.getByLabel("Project").fill(f.project);
  if (f.start !== undefined) await dialog.getByLabel("Start date").fill(f.start);
  if (f.end !== undefined) await dialog.getByLabel("End date (optional)").fill(f.end);
  if (f.notes !== undefined) await dialog.getByLabel("Notes").fill(f.notes);
}
const submitAdd = (dialog: Locator) => dialog.getByRole("button", { name: /^add worker$/i }).click();
const submitEdit = (dialog: Locator) => dialog.getByRole("button", { name: /save changes/i }).click();

async function openEdit(page: Page, name: string) {
  await openWorkers(page, name);
  await page.getByRole("button", { name: `Edit ${name}` }).click();
  const dialog = page.getByRole("dialog");
  await expect(dialog.getByLabel("Name", { exact: true })).toHaveValue(name);
  return dialog;
}

test.describe("admin: workers - create", () => {
  test("creates a worker with the next CW id, saves every field and audits", async ({ page }) => {
    const existing = (await db.contractWorker.findMany({ select: { workerId: true } })).map((w) => w.workerId);
    const expectedId = nextContractWorkerIdFrom(existing);
    expect(expectedId).toMatch(/^CW-\d{4,}$/);
    const name = uniq("Newhire");
    const dialog = await openAddWorker(page);
    await fillWorker(dialog, {
      name: `  ${name}  `,
      phone: "555-0123",
      agency: await betaId(),
      jobCode: CW_JOB.second.code,
      project: "Line 4 rebuild",
      start: businessYmd(2),
      end: businessYmd(-20),
      notes: "Bring PPE",
    });
    await submitAdd(dialog);
    await expect(toast(page, new RegExp(`added ${expectedId}`, "i"))).toBeVisible();

    const w = await byName(name);
    expect(w).toMatchObject({
      workerId: expectedId,
      phone: "555-0123",
      agencyId: await betaId(),
      jobCode: CW_JOB.second.code,
      project: "Line 4 rebuild",
      status: "ACTIVE",
      notes: "Bring PPE",
    });
    expect(w!.startDate.toISOString().slice(0, 10)).toBe(businessYmd(2));
    expect(w!.endDate?.toISOString().slice(0, 10)).toBe(businessYmd(-20));
    expect(w!.createdById).not.toBeNull();
    expect(await auditCount("contract.worker.create", w!.id)).toBe(1);
    await expect(page.getByRole("dialog")).toBeHidden();
    await page.goto(workersUrl(name));
    await expect(row(page, name)).toContainText(expectedId);
  });

  test("optional fields left empty are stored as null (no job code is allowed)", async ({ page }) => {
    const name = uniq("Bare");
    const dialog = await openAddWorker(page);
    await fillWorker(dialog, { name, agency: await alphaId() });
    await submitAdd(dialog);
    await expect(toast(page, /added cw-/i)).toBeVisible();
    expect(await byName(name)).toMatchObject({
      phone: null,
      jobCode: null,
      project: null,
      endDate: null,
      notes: null,
    });
    // Start date defaults to today (business date).
    const w = await byName(name);
    expect(w!.startDate.toISOString().slice(0, 10)).toBe(businessYmd(0));
  });

  test("the job code list shows real active codes only", async ({ page }) => {
    const dialog = await openAddWorker(page);
    const select = dialog.getByLabel("Job code");
    await expect(select.locator("option", { hasText: JOB_CODE.code })).toHaveCount(1);
    await expect(select.locator("option", { hasText: CW_JOB.active.code })).toHaveCount(1);
    await expect(select.locator("option", { hasText: INACTIVE_JOB_CODE.code })).toHaveCount(0);
    await expect(select.locator("option", { hasText: CW_JOB.inactive.code })).toHaveCount(0);
    await expect(select.locator("option", { hasText: "ACT001" })).toHaveCount(0);
  });

  test("name, agency and start date are required (nothing saved)", async ({ page }) => {
    const before = await workerCount();
    const dialog = await openAddWorker(page);
    await submitAdd(dialog);
    await expect(toast(page, /enter the worker's name/i)).toBeVisible();
    await fillWorker(dialog, { name: "   " });
    await submitAdd(dialog);
    await expect(toast(page, /enter the worker's name/i)).toBeVisible();
    await fillWorker(dialog, { name: uniq("NoAgency") });
    await submitAdd(dialog);
    await expect(toast(page, /choose an agency/i)).toBeVisible();
    await fillWorker(dialog, { agency: await alphaId() });
    await dialog.getByLabel("Start date").fill("");
    await submitAdd(dialog);
    await expect(toast(page, /enter a start date/i)).toBeVisible();
    await expect(dialog).toBeVisible();
    expect(await workerCount()).toBe(before);
  });

  test("an end date before the start date is refused", async ({ page }) => {
    const before = await workerCount();
    const dialog = await openAddWorker(page);
    await fillWorker(dialog, {
      name: uniq("BackwardsDates"),
      agency: await alphaId(),
      start: businessYmd(0),
      end: businessYmd(5),
    });
    await submitAdd(dialog);
    await expect(toast(page, /end date can't be before the start date/i)).toBeVisible();
    await expect(dialog).toBeVisible();
    expect(await workerCount()).toBe(before);
  });

  test("an end date equal to the start date is allowed (one-day assignment)", async ({ page }) => {
    const name = uniq("OneDay");
    const dialog = await openAddWorker(page);
    await fillWorker(dialog, { name, agency: await alphaId(), start: businessYmd(0), end: businessYmd(0) });
    await submitAdd(dialog);
    await expect(toast(page, /added cw-/i)).toBeVisible();
    expect(await byName(name)).not.toBeNull();
  });

  test("impossible dates are refused on the server", async ({ page }) => {
    const before = await workerCount();
    const dialog = await openAddWorker(page);
    // The date inputs only produce real dates; craft the request.
    await tamperActions(page, (b) =>
      b.replace("2031-01-01", "2031-02-30").replace("2031-01-05", "not-a-date"),
    );
    await fillWorker(dialog, {
      name: uniq("BadDates"),
      agency: await alphaId(),
      start: "2031-01-01",
      end: "2031-01-05",
    });
    await submitAdd(dialog);
    await expect(toast(page, /start date isn't a valid date/i)).toBeVisible();
    await page.unroute("**/*");
    await tamperActions(page, (b) => b.replace("2031-01-05", "31/01/2031"));
    await submitAdd(dialog);
    await expect(toast(page, /end date isn't a valid date/i)).toBeVisible();
    expect(await workerCount()).toBe(before);
  });

  test("a job code that does not exist or is retired is refused", async ({ page }) => {
    const before = await workerCount();
    const dialog = await openAddWorker(page);
    await fillWorker(dialog, { name: uniq("BadCode"), agency: await alphaId(), jobCode: CW_JOB.active.code });
    await tamperActions(page, (b) => b.replace(`"${CW_JOB.active.code}"`, '"NOPE999"'));
    await submitAdd(dialog);
    await expect(toast(page, /job code NOPE999 doesn't exist/i)).toBeVisible();
    await page.unroute("**/*");
    await tamperActions(page, (b) => b.replace(`"${CW_JOB.active.code}"`, `"${CW_JOB.inactive.code}"`));
    await submitAdd(dialog);
    await expect(toast(page, new RegExp(`job code ${CW_JOB.inactive.code} is inactive`, "i"))).toBeVisible();
    expect(await workerCount()).toBe(before);
  });

  test("an agency that no longer exists is refused", async ({ page }) => {
    const ag = await makeAgency();
    const before = await workerCount();
    const dialog = await openAddWorker(page);
    await fillWorker(dialog, { name: uniq("GoneAgency"), agency: ag.id });
    await db.staffingAgency.delete({ where: { id: ag.id } });
    await submitAdd(dialog);
    await expect(toast(page, /that agency no longer exists/i)).toBeVisible();
    expect(await workerCount()).toBe(before);
  });

  // The UI hides inactive agencies, but the server does not enforce it: a crafted or
  // stale request can still attach a new worker to a deactivated agency.
  // Bug (low): src/server/actions/contract-workers.ts checkWorkerRefs() only checks that the
  // agency exists. Proposed fix: also reject `!agency.isActive` ("That agency is inactive...")
  // when creating (and when changing agency on update).
  test.fixme("a deactivated agency is refused on the server when adding a worker", async ({ page }) => {
    const ag = await makeAgency();
    const before = await workerCount();
    const dialog = await openAddWorker(page);
    await fillWorker(dialog, { name: uniq("InactiveAgency"), agency: ag.id });
    await db.staffingAgency.update({ where: { id: ag.id }, data: { isActive: false } });
    await submitAdd(dialog);
    await expect(toast(page, /inactive/i)).toBeVisible();
    expect(await workerCount()).toBe(before);
  });

  test("over-long text is refused on the server", async ({ page }) => {
    const before = await workerCount();
    const dialog = await openAddWorker(page);
    const cases: [string, number, RegExp][] = [
      ["MARK-NAME", 121, /check name/i],
      ["MARK-PHONE", 41, /keep this under 40 characters/i],
      ["MARK-PROJECT", 201, /keep this under 200 characters/i],
      ["MARK-NOTES", 2001, /keep this under 2000 characters/i],
    ];
    let current = cases[0]!;
    await tamperActions(page, (b) => b.replace(current[0], "x".repeat(current[1])));
    for (const c of cases) {
      current = c;
      await fillWorker(dialog, {
        name: c[0] === "MARK-NAME" ? c[0] : uniq("LongText"),
        phone: c[0] === "MARK-PHONE" ? c[0] : "",
        project: c[0] === "MARK-PROJECT" ? c[0] : "",
        notes: c[0] === "MARK-NOTES" ? c[0] : "",
        agency: await alphaId(),
      });
      await submitAdd(dialog);
      await expect(toast(page, c[2])).toBeVisible();
    }
    expect(await workerCount()).toBe(before);
  });

  test("server failure while adding shows an error and saves nothing", async ({ page }) => {
    const name = uniq("FailAdd");
    const dialog = await openAddWorker(page);
    await fillWorker(dialog, { name, agency: await alphaId() });
    await failServerActions(page, "abort");
    await submitAdd(dialog);
    await expect(page.getByText(/something went wrong/i).first()).toBeVisible();
    await expectNoCrash(page);
    expect(await byName(name)).toBeNull();
  });

  test("server 500 while adding shows an error and saves nothing", async ({ page }) => {
    const name = uniq("Fail500");
    const dialog = await openAddWorker(page);
    await fillWorker(dialog, { name, agency: await alphaId() });
    await failServerActions(page, "500");
    await submitAdd(dialog);
    await expect(page.getByText(/something went wrong/i).first()).toBeVisible();
    await expectNoCrash(page);
    expect(await byName(name)).toBeNull();
  });

  test("a stale page (old deployment) fails cleanly and saves nothing", async ({ page }) => {
    const name = uniq("StaleAdd");
    const dialog = await openAddWorker(page);
    await fillWorker(dialog, { name, agency: await alphaId() });
    await failServerActions(page, "stale");
    await submitAdd(dialog);
    await expect(page.getByText(/something went wrong|refresh|reload/i).first()).toBeVisible();
    await expectNoCrash(page);
    expect(await byName(name)).toBeNull();
  });

  test("double-clicking Add worker creates one worker", async ({ page }) => {
    const name = uniq("DoubleAdd");
    const dialog = await openAddWorker(page);
    await fillWorker(dialog, { name, agency: await alphaId() });
    const slow = await delayServerActions(page, 1500);
    const save = dialog.getByRole("button", { name: /^add worker$/i });
    await save.click();
    await save.click({ force: true, timeout: 1000 }).catch(() => undefined);
    await expect(toast(page, /added cw-/i)).toBeVisible();
    expect(slow.count()).toBe(1);
    expect(await db.contractWorker.count({ where: { name } })).toBe(1);
  });

  test("two creates at the same instant get two different CW ids", async ({ page }) => {
    const seen = await captureActions(page);
    const name = uniq("RaceAdd");
    const dialog = await openAddWorker(page);
    await fillWorker(dialog, { name, agency: await alphaId() });
    await submitAdd(dialog);
    await expect(toast(page, /added cw-/i)).toBeVisible();
    const create = seen.find((c) => c.body.includes(name))!;
    const bodies = await Promise.all([replay(page.context(), create), replay(page.context(), create)]);
    for (const b of bodies) expect(b).not.toMatch(/could not allocate|something went wrong/i);
    const made = await db.contractWorker.findMany({ where: { name } });
    expect(made).toHaveLength(3);
    expect(new Set(made.map((w) => w.workerId)).size).toBe(3);
  });
});

test.describe("admin: workers - edit", () => {
  test("edits every field and audits the change", async ({ page }) => {
    const w = await makeWorker({ jobCode: CW_JOB.active.code });
    const dialog = await openEdit(page, w.name);
    const newName = uniq("Renamed");
    await fillWorker(dialog, {
      name: newName,
      phone: "555-0999",
      agency: await betaId(),
      jobCode: CW_JOB.second.code,
      project: "New project",
      start: businessYmd(5),
      end: businessYmd(-30),
      notes: "Moved to nights",
    });
    await submitEdit(dialog);
    await expect(toast(page, /worker updated/i)).toBeVisible();
    const saved = await db.contractWorker.findUniqueOrThrow({ where: { id: w.id } });
    expect(saved).toMatchObject({
      name: newName,
      phone: "555-0999",
      agencyId: await betaId(),
      jobCode: CW_JOB.second.code,
      project: "New project",
      notes: "Moved to nights",
      workerId: w.workerId, // the business id never changes
    });
    expect(saved.endDate?.toISOString().slice(0, 10)).toBe(businessYmd(-30));
    expect(await auditCount("contract.worker.update", w.id)).toBe(1);
  });

  test("clearing the optional fields stores null", async ({ page }) => {
    const w = await makeWorker({ jobCode: CW_JOB.active.code, project: "Old project", endDaysAgo: -10 });
    const dialog = await openEdit(page, w.name);
    await fillWorker(dialog, { project: "", end: "", jobCode: "" });
    await submitEdit(dialog);
    await expect(toast(page, /worker updated/i)).toBeVisible();
    expect(await db.contractWorker.findUniqueOrThrow({ where: { id: w.id } })).toMatchObject({
      jobCode: null,
      project: null,
      endDate: null,
    });
  });

  test("validation: empty name, end before start, nothing saved", async ({ page }) => {
    const w = await makeWorker();
    const dialog = await openEdit(page, w.name);
    await fillWorker(dialog, { name: "" });
    await submitEdit(dialog);
    await expect(toast(page, /enter the worker's name/i)).toBeVisible();
    await fillWorker(dialog, { name: w.name, start: businessYmd(0), end: businessYmd(3) });
    await submitEdit(dialog);
    await expect(toast(page, /end date can't be before the start date/i)).toBeVisible();
    expect(await db.contractWorker.findUniqueOrThrow({ where: { id: w.id } })).toMatchObject({
      name: w.name,
      startDate: w.startDate,
    });
  });

  test("a job code or agency that cannot be used is refused", async ({ page }) => {
    const w = await makeWorker({ jobCode: CW_JOB.active.code });
    const dialog = await openEdit(page, w.name);
    await fillWorker(dialog, { jobCode: CW_JOB.second.code });
    await tamperActions(page, (b) => b.replace(`"${CW_JOB.second.code}"`, '"NOPE999"'));
    await submitEdit(dialog);
    await expect(toast(page, /job code NOPE999 doesn't exist/i)).toBeVisible();
    await page.unroute("**/*");
    await tamperActions(page, (b) => b.replace(`"${CW_JOB.second.code}"`, `"${CW_JOB.inactive.code}"`));
    await submitEdit(dialog);
    await expect(toast(page, /is inactive/i)).toBeVisible();
    await page.unroute("**/*");
    await fillWorker(dialog, { jobCode: CW_JOB.active.code, agency: await betaId() });
    const beta = await betaId();
    await tamperActions(page, (b) => b.replace(beta, "no-such-agency"));
    await submitEdit(dialog);
    await expect(toast(page, /that agency no longer exists/i)).toBeVisible();
    expect(await db.contractWorker.findUniqueOrThrow({ where: { id: w.id } })).toMatchObject({
      jobCode: CW_JOB.active.code,
      agencyId: w.agencyId,
    });
  });

  test("a worker whose job code was retired can still be edited (unchanged code is kept)", async ({ page }) => {
    const w = await makeWorker({ jobCode: CW_JOB.inactive.code });
    const dialog = await openEdit(page, w.name);
    // The retired code stays visible and selected, marked inactive.
    await expect(dialog.getByLabel("Job code")).toHaveValue(CW_JOB.inactive.code);
    await expect(
      dialog.getByLabel("Job code").locator("option", { hasText: `${CW_JOB.inactive.code} - inactive` }),
    ).toHaveCount(1);
    await fillWorker(dialog, { project: "Still editable" });
    await submitEdit(dialog);
    await expect(toast(page, /worker updated/i)).toBeVisible();
    expect(await db.contractWorker.findUniqueOrThrow({ where: { id: w.id } })).toMatchObject({
      project: "Still editable",
      jobCode: CW_JOB.inactive.code,
    });
  });

  test("editing a worker that was deleted in the meantime says so", async ({ page }) => {
    const w = await makeWorker();
    const dialog = await openEdit(page, w.name);
    await db.contractWorker.delete({ where: { id: w.id } });
    await fillWorker(dialog, { project: "Too late" });
    await submitEdit(dialog);
    await expect(toast(page, /that worker no longer exists/i)).toBeVisible();
  });

  test("server failure while editing shows an error and changes nothing", async ({ page }) => {
    const w = await makeWorker();
    const dialog = await openEdit(page, w.name);
    await fillWorker(dialog, { name: uniq("NeverSaved") });
    await failServerActions(page, "abort");
    await submitEdit(dialog);
    await expect(page.getByText(/something went wrong/i).first()).toBeVisible();
    await expectNoCrash(page);
    expect((await db.contractWorker.findUniqueOrThrow({ where: { id: w.id } })).name).toBe(w.name);
  });

  test("double-clicking Save changes sends one request", async ({ page }) => {
    const w = await makeWorker();
    const dialog = await openEdit(page, w.name);
    await fillWorker(dialog, { project: "Saved once" });
    const slow = await delayServerActions(page, 1500);
    const save = dialog.getByRole("button", { name: /save changes/i });
    await save.click();
    await save.click({ force: true, timeout: 1000 }).catch(() => undefined);
    await expect(toast(page, /worker updated/i)).toBeVisible();
    expect(slow.count()).toBe(1);
    expect(await auditCount("contract.worker.update", w.id)).toBe(1);
  });
});

test.describe("admin: workers - end and reactivate", () => {
  test("ends a contract today; the worker moves to Ended and can be reactivated", async ({ page }) => {
    const w = await makeWorker();
    await openWorkers(page, w.name);
    await row(page, w.name).getByRole("button", { name: /^end$/i }).click();
    const dialog = page.getByRole("dialog");
    await expect(dialog.getByRole("heading", { name: new RegExp(`end assignment for ${w.name}`, "i") })).toBeVisible();
    await dialog.getByRole("button", { name: /end assignment/i }).click();
    await expect(toast(page, new RegExp(`${w.name} ended`))).toBeVisible();
    const ended = await db.contractWorker.findUniqueOrThrow({ where: { id: w.id } });
    expect(ended.status).toBe("ENDED");
    expect(ended.endDate?.toISOString().slice(0, 10)).toBe(businessYmd(0));
    expect(await auditCount("contract.worker.end", w.id)).toBe(1);
    await expect(row(page, w.name)).toContainText(/ended/i);
    await expect(row(page, w.name).getByRole("button", { name: /^end$/i })).toHaveCount(0);

    // Reactivate with no new end date clears the end date.
    await row(page, w.name).getByRole("button", { name: /reactivate/i }).click();
    await page.getByRole("dialog").getByRole("button", { name: /^reactivate$/i }).click();
    await expect(toast(page, new RegExp(`${w.name} reactivated`))).toBeVisible();
    expect(await db.contractWorker.findUniqueOrThrow({ where: { id: w.id } })).toMatchObject({
      status: "ACTIVE",
      endDate: null,
    });
    expect(await auditCount("contract.worker.reactivate", w.id)).toBe(1);
  });

  test("ending with a future date; reactivating with a new end date", async ({ page }) => {
    const w = await makeWorker();
    await openWorkers(page, w.name);
    await row(page, w.name).getByRole("button", { name: /^end$/i }).click();
    await page.getByRole("dialog").getByLabel(/end date/i).fill(businessYmd(-14));
    await page.getByRole("dialog").getByRole("button", { name: /end assignment/i }).click();
    await expect(toast(page, new RegExp(`${w.name} ended`))).toBeVisible();
    let saved = await db.contractWorker.findUniqueOrThrow({ where: { id: w.id } });
    expect(saved.status).toBe("ENDED");
    expect(saved.endDate?.toISOString().slice(0, 10)).toBe(businessYmd(-14));

    await row(page, w.name).getByRole("button", { name: /reactivate/i }).click();
    await page.getByRole("dialog").getByLabel(/new end date/i).fill(businessYmd(-30));
    await page.getByRole("dialog").getByRole("button", { name: /^reactivate$/i }).click();
    await expect(toast(page, new RegExp(`${w.name} reactivated`))).toBeVisible();
    saved = await db.contractWorker.findUniqueOrThrow({ where: { id: w.id } });
    expect(saved.status).toBe("ACTIVE");
    expect(saved.endDate?.toISOString().slice(0, 10)).toBe(businessYmd(-30));
  });

  test("ending a worker who is clocked in closes the shift and leaves it pending", async ({ page }) => {
    const w = await makeWorker();
    const open = await makeOpenEntry(w.id, 2);
    await openWorkers(page, w.name);
    await row(page, w.name).getByRole("button", { name: /^end$/i }).click();
    await page.getByRole("dialog").getByRole("button", { name: /end assignment/i }).click();
    await expect(toast(page, /open shift was clocked out and needs approval/i)).toBeVisible();
    const [entry] = await entriesOf(w.id);
    expect(entry!.id).toBe(open.id);
    expect(entry).toMatchObject({ status: "COMPLETED", approvalStatus: "PENDING" });
    expect(entry!.clockOut).not.toBeNull();
    expect(entry!.editReason).toMatch(/contract was ended by an admin/i);
    expect(entry!.totalWorkMin).toBeGreaterThanOrEqual(119);
    expect((await db.contractWorker.findUniqueOrThrow({ where: { id: w.id } })).status).toBe("ENDED");
  });

  test("an end date before the start date is refused and the worker stays active", async ({ page }) => {
    const w = await makeWorker({ startDaysAgo: 5 });
    await openWorkers(page, w.name);
    await row(page, w.name).getByRole("button", { name: /^end$/i }).click();
    await page.getByRole("dialog").getByLabel(/end date/i).fill(businessYmd(20));
    await page.getByRole("dialog").getByRole("button", { name: /end assignment/i }).click();
    await expect(toast(page, /end date can't be before the start date/i)).toBeVisible();
    expect((await db.contractWorker.findUniqueOrThrow({ where: { id: w.id } })).status).toBe("ACTIVE");
  });

  test("an impossible end date is refused on the server (end and reactivate)", async ({ page }) => {
    const w = await makeWorker();
    await openWorkers(page, w.name);
    await tamperActions(page, (b) => b.replace(/\d{4}-\d{2}-\d{2}/, "2031-02-30"));
    await row(page, w.name).getByRole("button", { name: /^end$/i }).click();
    await page.getByRole("dialog").getByLabel(/end date/i).fill(businessYmd(0));
    await page.getByRole("dialog").getByRole("button", { name: /end assignment/i }).click();
    await expect(toast(page, /end date isn't a valid date/i)).toBeVisible();
    expect((await db.contractWorker.findUniqueOrThrow({ where: { id: w.id } })).status).toBe("ACTIVE");

    const w2 = await makeWorker({ status: "ENDED", endDaysAgo: 2 });
    await openWorkers(page, w2.name);
    await row(page, w2.name).getByRole("button", { name: /reactivate/i }).click();
    await page.getByRole("dialog").getByLabel(/new end date/i).fill(businessYmd(-5));
    await page.getByRole("dialog").getByRole("button", { name: /^reactivate$/i }).click();
    await expect(toast(page, /end date isn't a valid date/i).last()).toBeVisible();
    expect((await db.contractWorker.findUniqueOrThrow({ where: { id: w2.id } })).status).toBe("ENDED");
  });

  test("reactivating with an end date before the start date is refused", async ({ page }) => {
    const w = await makeWorker({ status: "ENDED", startDaysAgo: 3, endDaysAgo: 1 });
    await openWorkers(page, w.name);
    await row(page, w.name).getByRole("button", { name: /reactivate/i }).click();
    await page.getByRole("dialog").getByLabel(/new end date/i).fill(businessYmd(20));
    await page.getByRole("dialog").getByRole("button", { name: /^reactivate$/i }).click();
    await expect(toast(page, /end date can't be before the start date/i)).toBeVisible();
    expect((await db.contractWorker.findUniqueOrThrow({ where: { id: w.id } })).status).toBe("ENDED");
  });

  test("ending or reactivating a worker that was deleted in the meantime says so", async ({ page }) => {
    const a = await makeWorker();
    const b = await makeWorker({ status: "ENDED", endDaysAgo: 1 });
    await openWorkers(page, "");
    await db.contractWorker.deleteMany({ where: { id: { in: [a.id, b.id] } } });
    await row(page, a.name).getByRole("button", { name: /^end$/i }).click();
    await page.getByRole("dialog").getByRole("button", { name: /end assignment/i }).click();
    await expect(toast(page, /that worker no longer exists/i)).toBeVisible();
    await page.keyboard.press("Escape");
    await row(page, b.name).getByRole("button", { name: /reactivate/i }).click();
    await page.getByRole("dialog").getByRole("button", { name: /^reactivate$/i }).click();
    await expect(toast(page, /that worker no longer exists/i).last()).toBeVisible();
  });

  test("server failure while ending changes nothing", async ({ page }) => {
    const w = await makeWorker();
    const open = await makeOpenEntry(w.id, 1);
    await openWorkers(page, w.name);
    await row(page, w.name).getByRole("button", { name: /^end$/i }).click();
    await failServerActions(page, "500");
    await page.getByRole("dialog").getByRole("button", { name: /end assignment/i }).click();
    await expect(page.getByText(/something went wrong/i).first()).toBeVisible();
    await expectNoCrash(page);
    expect((await db.contractWorker.findUniqueOrThrow({ where: { id: w.id } })).status).toBe("ACTIVE");
    expect((await db.contractTimeEntry.findUniqueOrThrow({ where: { id: open.id } })).status).toBe("ACTIVE");
  });

  test("server failure while reactivating changes nothing", async ({ page }) => {
    const w = await makeWorker({ status: "ENDED", endDaysAgo: 1 });
    await openWorkers(page, w.name);
    await row(page, w.name).getByRole("button", { name: /reactivate/i }).click();
    await failServerActions(page, "abort");
    await page.getByRole("dialog").getByRole("button", { name: /^reactivate$/i }).click();
    await expect(page.getByText(/something went wrong/i).first()).toBeVisible();
    await expectNoCrash(page);
    expect((await db.contractWorker.findUniqueOrThrow({ where: { id: w.id } })).status).toBe("ENDED");
  });

  test("double-clicking End assignment ends once", async ({ page }) => {
    const w = await makeWorker();
    await openWorkers(page, w.name);
    await row(page, w.name).getByRole("button", { name: /^end$/i }).click();
    const slow = await delayServerActions(page, 1500);
    const confirm = page.getByRole("dialog").getByRole("button", { name: /end assignment/i });
    await confirm.click();
    await confirm.click({ force: true, timeout: 1000 }).catch(() => undefined);
    await expect(toast(page, new RegExp(`${w.name} ended`))).toBeVisible();
    expect(slow.count()).toBe(1);
    expect(await auditCount("contract.worker.end", w.id)).toBe(1);
  });

  test("ending the same worker twice at once is safe (second call just re-ends)", async ({ page }) => {
    const w = await makeWorker();
    const seen = await captureActions(page);
    await openWorkers(page, w.name);
    await row(page, w.name).getByRole("button", { name: /^end$/i }).click();
    await page.getByRole("dialog").getByRole("button", { name: /end assignment/i }).click();
    await expect(toast(page, new RegExp(`${w.name} ended`))).toBeVisible();
    const call = seen.find((c) => c.body.includes(w.id))!;
    const out = await Promise.all([replay(page.context(), call), replay(page.context(), call)]);
    for (const o of out) expect(o).not.toMatch(/something went wrong/i);
    expect((await db.contractWorker.findUniqueOrThrow({ where: { id: w.id } })).status).toBe("ENDED");
  });
});

test.describe("admin: workers - list, filters and detail", () => {
  test("search, agency and status filters", async ({ page }) => {
    const ag = await makeAgency();
    const a = await makeWorker({ agencyId: ag.id, name: uniq("Filterable") });
    const b = await makeWorker({ agencyId: ag.id, name: uniq("Filterable"), status: "ENDED", endDaysAgo: 1 });
    const c = await makeWorker({ name: uniq("Elsewhere") });

    await page.goto(`/admin/contract-workers?tab=workers&agency=${ag.id}`);
    await expect(row(page, a.name)).toBeVisible();
    await expect(row(page, b.name)).toBeVisible();
    await expect(row(page, c.name)).toHaveCount(0);

    await page.goto(`/admin/contract-workers?tab=workers&agency=${ag.id}&status=ENDED`);
    await expect(row(page, b.name)).toBeVisible();
    await expect(row(page, a.name)).toHaveCount(0);

    await page.goto(`/admin/contract-workers?tab=workers&agency=${ag.id}&status=ACTIVE`);
    await expect(row(page, a.name)).toBeVisible();
    await expect(row(page, b.name)).toHaveCount(0);

    // Search by worker ID and by agency name, case-insensitive.
    await page.goto(workersUrl(c.workerId.toLowerCase()));
    await expect(row(page, c.name)).toBeVisible();
    await page.goto(workersUrl(ag.name.toUpperCase()));
    await expect(row(page, a.name)).toBeVisible();

    await page.goto(workersUrl("zzz-nobody-matches-this"));
    await expect(page.getByText(/no contract workers match/i)).toBeVisible();
  });

  test("the filter form applies and resets", async ({ page }) => {
    const w = await makeWorker({ name: uniq("FormFilter") });
    await page.goto("/admin/contract-workers?tab=workers");
    await page.getByLabel("Search").fill(w.name);
    await page.getByRole("button", { name: /^apply$/i }).click();
    await expect(page).toHaveURL(/q=/);
    await expect(row(page, w.name)).toBeVisible();
    await page.getByRole("link", { name: /^reset$/i }).click();
    await expect(page).not.toHaveURL(/q=/);
  });

  test("shows 'Ending soon' for a contract ending this week, and on-site status", async ({ page }) => {
    const soon = await makeWorker({ endDaysAgo: -1 });
    const later = await makeWorker({ endDaysAgo: -60 });
    const inNow = await makeWorker();
    await makeOpenEntry(inNow.id, 1);
    await page.goto(workersUrl(soon.name));
    await expect(row(page, soon.name)).toContainText(/ending soon/i);
    await page.goto(workersUrl(later.name));
    await expect(row(page, later.name)).not.toContainText(/ending soon/i);
    await page.goto(workersUrl(inNow.name));
    await expect(row(page, inNow.name)).toContainText(/on site/i);
    // An admin can clock them out right from the list.
    await expect(row(page, inNow.name).getByRole("button", { name: /clock out/i })).toBeVisible();
  });

  test("the seeded worker with a retired job code is listed", async ({ page }) => {
    await page.goto(workersUrl(CW_SEED_OLDCODE_WORKER.name));
    await expect(row(page, CW_SEED_OLDCODE_WORKER.name)).toContainText(CW_JOB.inactive.code);
    await expect(row(page, CW_SEED_OLDCODE_WORKER.name)).toContainText(CW_AGENCY.alpha);
  });

  test("the worker detail page shows the assignment and recent entries", async ({ page }) => {
    const w = await makeWorker({ jobCode: CW_JOB.active.code, project: "Detail project" });
    const { makeEntry } = await import("./support/contract");
    await makeEntry(w.id, { daysAgo: 1, approval: "APPROVED" });
    await page.goto(workersUrl(w.name));
    await page.getByRole("link", { name: w.name }).click();
    await expect(page).toHaveURL(new RegExp(`/admin/contract-workers/${w.id}`));
    await expect(page.getByRole("heading", { name: w.name })).toBeVisible();
    await expect(page.getByText(w.workerId).first()).toBeVisible();
    await expect(page.getByText("Detail project")).toBeVisible();
    await expect(page.getByText(CW_JOB.active.code)).toBeVisible();
    await expect(page.getByText(/recent entries \(1\)/i)).toBeVisible();
    await expect(page.getByText("Approved", { exact: true })).toBeVisible();
    await expect(page.getByText("8h 00m")).toBeVisible();
  });

  test("an unknown worker id shows a not-found page, not a crash", async ({ page }) => {
    await page.goto("/admin/contract-workers/does-not-exist");
    await expect(page.getByText(/not found|could not be found|404/i).first()).toBeVisible();
    await expect(page.getByRole("heading", { name: /^contract workers$/i })).toHaveCount(0);
    await expectNoCrash(page);
  });
});

test.describe("contract worker pages need an admin", () => {
  test("anonymous visitors are sent to the login page", async ({ browser }) => {
    const ctx = await browser.newContext({ baseURL: BASE_URL, storageState: { cookies: [], origins: [] } });
    const page = await ctx.newPage();
    await page.goto("/admin/contract-workers");
    await expect(page).toHaveURL(/\/login/);
    await page.goto("/admin/contract-workers/anything");
    await expect(page).toHaveURL(/\/login/);
    await ctx.close();
  });

  test("an employee cannot open the contract worker pages", async ({ browser }) => {
    const ctx = await browser.newContext({ baseURL: BASE_URL, storageState: { cookies: [], origins: [] } });
    const page = await ctx.newPage();
    await page.goto("/login");
    await page.getByLabel(/email or username/i).fill(env("E2E_EMPLOYEE_EMAIL"));
    await page.getByLabel(/^password/i).fill(env("E2E_EMPLOYEE_PASSWORD"));
    await page.getByRole("button", { name: /sign in/i }).click();
    await page.waitForURL((u) => !u.pathname.startsWith("/login"));
    await page.goto("/admin/contract-workers");
    await expect(page).toHaveURL(/unauthorized/);
    await expect(page.getByText(/contract workers/i)).toHaveCount(0);
    await ctx.close();
  });
});
