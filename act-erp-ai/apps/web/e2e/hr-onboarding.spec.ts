import { randomUUID, createHash } from "node:crypto";
import { test, expect, type Page } from "@playwright/test";
import { db } from "./support/db";
import { ADMIN_STATE, BASE_URL, env } from "./support/test-data";
import { SS, empDbId, loginState, pdfFile, putFakeS3 } from "./support/self-service";
import { toast } from "./support/helpers";
import { anonContext, textField } from "./support/people";

test.use({ storageState: ADMIN_STATE });
let danaId: string;
let ninaId: string;
let adminId: string;
const PREFIX = "HR checklist e2e ";

test.beforeAll(async ({ browser }) => {
  danaId = await empDbId(SS.dana); ninaId = await empDbId(SS.nina);
  adminId = (await db.user.findFirstOrThrow({ where: { email: env("E2E_ADMIN_EMAIL") } })).id;
  await loginState(browser, SS.dana, "hr-dana");
});

async function cleanup() {
  const versions = await db.companyDocumentVersion.findMany({ where: { document: { title: { startsWith: PREFIX } } }, select: { id: true } });
  const versionIds = versions.map((version) => version.id);
  await db.handbookAcknowledgment.deleteMany({ where: { versionId: { in: versionIds } } });
  await db.onboardingChecklistItem.deleteMany({ where: { versionId: { in: versionIds } } });
  await db.companyDocumentVersion.deleteMany({ where: { id: { in: versionIds } } });
  await db.companyDocument.deleteMany({ where: { title: { startsWith: PREFIX } } });
  await db.document.deleteMany({ where: { title: { startsWith: PREFIX } } });
  await db.onboardingInvite.deleteMany({ where: { token: { startsWith: "hr-checklist-" } } });
  await db.user.deleteMany({ where: { username: { startsWith: "hr-checklist-" } } });
}
test.afterAll(cleanup);

async function makeTemplate(category: "HANDBOOK" | "ONBOARDING" = "HANDBOOK") {
  const suffix = randomUUID();
  const file = pdfFile(`template-${suffix}.pdf`, suffix);
  const document = await db.companyDocument.create({ data: { title: `${PREFIX}${category} ${suffix}`, category, createdById: adminId } });
  const version = await db.companyDocumentVersion.create({ data: {
    documentId: document.id, version: 1, originalName: file.name, fileName: `company-library/e2e/${suffix}.pdf`,
    fileType: "application/pdf", sha256: createHash("sha256").update(file.buffer).digest("hex"), sizeBytes: file.buffer.length,
    purpose: "ONBOARDING_TEMPLATE", status: "APPROVED", createdById: adminId, approvedById: adminId, approvedAt: new Date(),
  } });
  await putFakeS3(`documents/${version.fileName}`, file.buffer, file.mimeType);
  return { document, version, file };
}

async function assign(page: Page, versionId: string, owner: string) {
  await page.goto("/admin/onboarding/checklists");
  await page.getByLabel("Employee or open invite").selectOption(owner);
  await page.getByLabel("Approved template").selectOption(versionId);
  await page.getByRole("button", { name: "Assign template", exact: true }).click();
  await expect(toast(page, "Template assigned")).toBeVisible();
}

test("assigns one handbook, records an explicit immutable receipt, and requires HR review", async ({ page, browser }) => {
  const fixture = await makeTemplate();
  await assign(page, fixture.version.id, `employee:${danaId}`);
  await assign(page, fixture.version.id, `employee:${danaId}`);
  expect(await db.onboardingChecklistItem.count({ where: { employeeId: danaId, versionId: fixture.version.id } })).toBe(1);
  const item = await db.onboardingChecklistItem.findFirstOrThrow({ where: { employeeId: danaId, versionId: fixture.version.id } });

  const context = await browser.newContext({ baseURL: BASE_URL, storageState: "e2e/.auth/hr-dana.json" });
  const employeePage = await context.newPage();
  await employeePage.goto("/dashboard/onboarding");
  const panel = employeePage.getByRole("region", { name: fixture.document.title, exact: true });
  await expect(panel.getByRole("button", { name: "Acknowledge receipt" })).toBeDisabled();
  const download = await employeePage.request.get(`/api/company-documents/${fixture.version.id}/file`);
  expect(download.status()).toBe(200);
  expect(Buffer.compare(await download.body(), fixture.file.buffer)).toBe(0);
  expect(await db.handbookAcknowledgment.count({ where: { checklistItemId: item.id } })).toBe(0);
  await panel.getByRole("checkbox").check();
  await panel.getByRole("button", { name: "Acknowledge receipt" }).click();
  await expect(toast(employeePage, "Handbook receipt recorded for HR review")).toBeVisible();
  expect((await db.onboardingChecklistItem.findUniqueOrThrow({ where: { id: item.id } })).status).toBe("SUBMITTED");
  expect(await db.handbookAcknowledgment.count({ where: { checklistItemId: item.id } })).toBe(1);
  await employeePage.reload();
  await expect(employeePage.getByText("Handbook receipt recorded", { exact: false }).first()).toBeVisible();
  expect(await db.handbookAcknowledgment.count({ where: { checklistItemId: item.id } })).toBe(1);

  await page.goto(`/admin/onboarding/checklists?employee=${danaId}`);
  const adminPanel = page.getByRole("region", { name: fixture.document.title, exact: true });
  await adminPanel.getByLabel("Review reason").fill("Reviewed the exact handbook receipt");
  await adminPanel.getByRole("button", { name: "Save review" }).click();
  await expect(toast(page, "HR review recorded")).toBeVisible();
  expect((await db.onboardingChecklistItem.findUniqueOrThrow({ where: { id: item.id } })).status).toBe("ACCEPTED");
  expect((await db.handbookAcknowledgment.findUniqueOrThrow({ where: { checklistItemId: item.id } })).acknowledgmentText).toContain("version 1");
  await context.close();
});

test("keeps employee templates isolated and accepts only their submitted document", async ({ page, browser }) => {
  const own = await makeTemplate("ONBOARDING");
  const other = await makeTemplate("ONBOARDING");
  await assign(page, own.version.id, `employee:${danaId}`);
  await assign(page, other.version.id, `employee:${ninaId}`);
  const file = pdfFile(`completed-${randomUUID()}.pdf`);
  const completed = await db.document.create({ data: { title: `${PREFIX}completed form`, documentType: "ONBOARDING", employeeId: danaId, fileName: `e2e/${file.name}`, fileType: file.mimeType, fileUrl: `documents/e2e/${file.name}` } });
  await putFakeS3(`documents/${completed.fileName}`, file.buffer, file.mimeType);
  const context = await browser.newContext({ baseURL: BASE_URL, storageState: "e2e/.auth/hr-dana.json" });
  const employeePage = await context.newPage();
  await employeePage.goto("/dashboard/onboarding");
  await expect(employeePage.getByText(other.document.title)).toHaveCount(0);
  expect((await employeePage.request.get(`/api/company-documents/${other.version.id}/file`)).status()).toBe(404);
  const ownPanel = employeePage.getByRole("region", { name: own.document.title, exact: true });
  await ownPanel.getByLabel("Your completed document").selectOption(completed.id);
  await ownPanel.getByRole("button", { name: "Submit for review" }).click();
  await expect(toast(employeePage, "Document submitted for HR review")).toBeVisible();
  const item = await db.onboardingChecklistItem.findFirstOrThrow({ where: { employeeId: danaId, versionId: own.version.id } });
  expect(item).toMatchObject({ status: "SUBMITTED", submittedDocumentId: completed.id });
  await context.close();
});

test("binds anonymous template access to one live invite and transfers its assignment on completion", async ({ page, browser }) => {
  const fixture = await makeTemplate();
  const invite = await db.onboardingInvite.create({ data: { token: `hr-checklist-${randomUUID()}`, createdById: adminId, expiresAt: new Date(Date.now() + 86_400_000), employmentType: "FULL_PART_TIME", compensationType: "HOURLY_RATE" } });
  const otherInvite = await db.onboardingInvite.create({ data: { token: `hr-checklist-${randomUUID()}`, createdById: adminId, expiresAt: new Date(Date.now() + 86_400_000) } });
  await assign(page, fixture.version.id, `invite:${invite.id}`);
  const ctx = await anonContext(browser);
  const guest = await ctx.newPage();
  const url = `/onboard/${invite.token}/files/${fixture.version.id}`;
  expect((await guest.request.get(url)).status()).toBe(200);
  expect((await guest.request.get(`/onboard/${otherInvite.token}/files/${fixture.version.id}`)).status()).not.toBe(200);
  await db.onboardingInvite.update({ where: { id: invite.id }, data: { expiresAt: new Date(Date.now() - 1000) } });
  expect((await guest.request.get(url)).status()).not.toBe(200);
  await db.onboardingInvite.update({ where: { id: invite.id }, data: { expiresAt: new Date(Date.now() + 86_400_000) } });

  await guest.goto(`/onboard/${invite.token}`);
  await expect(guest.getByRole("link", { name: new RegExp(fixture.document.title) })).toBeVisible();
  const next = () => guest.getByRole("button", { name: /^next/i }).click();
  const name = "HR Checklist Example";
  await textField(guest, "Full name *").fill(name);
  await textField(guest, "SSN — last 4 digits *").fill("1234");
  await next(); // address
  await next(); // application
  await textField(guest, "Type your full name *").first().fill(name);
  await guest.getByText(/agree to the drug\/alcohol testing consent/i).click();
  await textField(guest, "Type your full name *").nth(1).fill(name);
  await guest.getByText(/agree to the background check authorization/i).click();
  await next();
  await textField(guest, "Bank name *").fill("First National Bank");
  await textField(guest, "Routing number *").fill("111000025");
  await textField(guest, "Account number *").fill("123456789");
  await textField(guest, "Type your full name *").fill(name);
  await guest.getByText(/authorize direct deposit/i).click();
  await next();
  await textField(guest, "Type your full name *").fill(name);
  await guest.getByText(/acknowledge receipt/i).click();
  await next(); // documents
  await next(); // account
  const username = `hr-checklist-${randomUUID().slice(0, 8)}`;
  await textField(guest, "Username (only if no work email above) *").fill(username);
  await textField(guest, "Password *").fill("Example-Password-123!");
  await textField(guest, "Confirm password *").fill("Example-Password-123!");
  await guest.getByRole("button", { name: /^submit$/i }).click();
  await expect(guest.getByText(/thanks, you.re all set/i)).toBeVisible();
  const finished = await db.onboardingInvite.findUniqueOrThrow({ where: { id: invite.id } });
  expect(finished.completedByEmployeeId).toBeTruthy();
  const transferred = await db.onboardingChecklistItem.findFirstOrThrow({ where: { versionId: fixture.version.id } });
  expect(transferred).toMatchObject({ inviteId: null, employeeId: finished.completedByEmployeeId, status: "NOT_STARTED" });
  expect((await guest.request.get(url)).status()).not.toBe(200);
  expect(await db.handbookAcknowledgment.count({ where: { checklistItemId: transferred.id } })).toBe(0);
  await ctx.close();
});
