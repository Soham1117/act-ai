import { randomUUID } from "node:crypto";
import { test, expect, type Page } from "@playwright/test";
import { db } from "./support/db";
import { ADMIN_STATE, BASE_URL } from "./support/test-data";
import { SS, empDbId, loginState } from "./support/self-service";
import { toast } from "./support/helpers";

test.use({ storageState: ADMIN_STATE });
let employeeId: string;
const PREFIX = "HR notes e2e ";

test.beforeAll(async ({ browser }) => {
  employeeId = await empDbId(SS.dana);
  await loginState(browser, SS.dana, "hr-notes-dana");
});
test.afterAll(async () => {
  const notes = await db.employeeNote.findMany({ where: { title: { startsWith: PREFIX } }, select: { id: true } });
  await db.employeeNoteRevision.deleteMany({ where: { noteId: { in: notes.map((note) => note.id) } } });
  await db.employeeNote.deleteMany({ where: { id: { in: notes.map((note) => note.id) } } });
});

async function openNotes(page: Page) {
  await page.goto(`/admin/employees/${employeeId}`);
  await page.getByRole("tab", { name: "Employee notes", exact: true }).click();
  await expect(page.getByText("Add employee note", { exact: true })).toBeVisible();
}

test("records private notes and revisions without changing status or any time entry", async ({ page, browser }) => {
  const before = await db.employee.findUniqueOrThrow({ where: { id: employeeId }, select: { employmentStatus: true, terminationDate: true } });
  const punchesBefore = await db.timeEntry.findMany({ where: { employeeId }, orderBy: { id: "asc" } });
  const title = `${PREFIX}${randomUUID()}`;
  const body = "Private fictional HR discussion for automated testing.";
  await openNotes(page);
  await page.getByLabel("Note title", { exact: true }).fill(title);
  await page.getByLabel("Note date", { exact: true }).fill("2026-10-27");
  await page.getByLabel("Note type", { exact: true }).selectOption("TERMINATION");
  await page.getByLabel(/^Note details/).fill(body);
  await page.getByRole("button", { name: "Save employee note", exact: true }).click();
  await expect(toast(page, "Employee note saved")).toBeVisible();
  const note = await db.employeeNote.findFirstOrThrow({ where: { employeeId, title } });
  expect(note.kind).toBe("TERMINATION");
  expect(await db.employeeNoteRevision.count({ where: { noteId: note.id } })).toBe(1);
  expect(await db.employee.findUniqueOrThrow({ where: { id: employeeId }, select: { employmentStatus: true, terminationDate: true } })).toEqual(before);
  expect(await db.timeEntry.findMany({ where: { employeeId }, orderBy: { id: "asc" } })).toEqual(punchesBefore);
  expect(JSON.stringify(await db.auditLog.findMany({ where: { resource: `EmployeeNote:${note.id}` }, select: { diff: true } }))).not.toContain(body);

  const other = await browser.newContext({ baseURL: BASE_URL, storageState: ADMIN_STATE });
  const otherPage = await other.newPage();
  await openNotes(otherPage);
  await otherPage.getByRole("region", { name: `Employee note: ${title}`, exact: true }).getByRole("button", { name: "Edit note", exact: true }).click();
  await otherPage.getByLabel(/^Note details/).fill("A stale competing edit must not overwrite the first edit.");
  await otherPage.getByLabel("Reason for change", { exact: true }).fill("Second editor update");

  await page.getByRole("region", { name: `Employee note: ${title}`, exact: true }).getByRole("button", { name: "Edit note", exact: true }).click();
  await page.getByLabel(/^Note details/).fill("First editor corrected this fictional record.");
  await page.getByLabel("Reason for change", { exact: true }).fill("First editor correction");
  await page.getByRole("button", { name: "Save note changes", exact: true }).click();
  await expect(toast(page, "Employee note updated")).toBeVisible();
  await otherPage.getByRole("button", { name: "Save note changes", exact: true }).click();
  await expect(toast(otherPage, /This note changed/)).toBeVisible();
  expect((await db.employeeNote.findUniqueOrThrow({ where: { id: note.id } })).body).toBe("First editor corrected this fictional record.");
  expect(await db.employeeNoteRevision.count({ where: { noteId: note.id } })).toBe(2);

  await openNotes(page);
  const panel = page.getByRole("region", { name: `Employee note: ${title}`, exact: true });
  await panel.getByText("Revision history (2)", { exact: true }).click();
  await expect(panel.getByText(body, { exact: true })).toBeVisible();
  await panel.getByRole("button", { name: "Archive note", exact: true }).click();
  await panel.getByLabel("Reason for archiving", { exact: true }).fill("Retain as a historical record");
  await panel.getByRole("button", { name: "Confirm archive", exact: true }).click();
  await expect(toast(page, "Employee note archived")).toBeVisible();
  await expect(panel).toHaveCount(0);
  await page.getByLabel("Show archived notes", { exact: true }).check();
  await expect(page.getByRole("region", { name: `Employee note: ${title}`, exact: true })).toBeVisible();
  expect(await db.employeeNoteRevision.count({ where: { noteId: note.id } })).toBe(3);
  await other.close();

  const employeeContext = await browser.newContext({ baseURL: BASE_URL, storageState: "e2e/.auth/hr-notes-dana.json" });
  const employeePage = await employeeContext.newPage();
  await employeePage.goto(`/admin/employees/${employeeId}`);
  await expect(employeePage).not.toHaveURL(new RegExp(`/admin/employees/${employeeId}$`));
  expect(await employeePage.content()).not.toContain(body);
  expect(await employeePage.content()).not.toContain(title);
  await employeeContext.close();
});
