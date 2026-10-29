import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  admin: vi.fn(), writable: vi.fn(), transaction: vi.fn(), lock: vi.fn(),
  itemFind: vi.fn(), itemUpdate: vi.fn(), itemCreate: vi.fn(), versionFind: vi.fn(),
  employeeFind: vi.fn(), inviteFind: vi.fn(), documentFind: vi.fn(), receiptCreate: vi.fn(),
  audit: vi.fn(), refresh: vi.fn(),
}));
vi.mock("@/lib/auth", () => ({ requireAdmin: mocks.admin, requireWritableUser: mocks.writable }));
vi.mock("next/cache", () => ({ revalidatePath: mocks.refresh }));
vi.mock("@/lib/db", () => ({ db: { $transaction: mocks.transaction } }));
import { acknowledgeHandbook, assignOnboardingTemplate, reviewOnboardingItem, submitChecklistDocument } from "./actions/onboarding-checklist";

const actor = { id: "00000000-0000-0000-0000-000000000001", email: "test@example.test", employeeId: "employee-a" };
const version = { id: "version-a", version: 2, status: "APPROVED", purpose: "ONBOARDING_TEMPLATE", document: { title: "Handbook", category: "HANDBOOK", isArchived: false } };
const now = new Date("2026-10-28T12:00:00Z");
const item = { id: "item-a", employeeId: "employee-a", inviteId: null, versionId: version.id, title: "Handbook", itemType: "HANDBOOK", required: true, status: "NOT_STARTED", acknowledgment: null, version, updatedAt: now, submittedDocumentId: null };
const tx = {
  $executeRaw: mocks.lock,
  onboardingChecklistItem: { findUnique: mocks.itemFind, findFirst: mocks.itemFind, create: mocks.itemCreate, update: mocks.itemUpdate },
  companyDocumentVersion: { findUnique: mocks.versionFind, findUniqueOrThrow: mocks.versionFind },
  employee: { findUnique: mocks.employeeFind }, onboardingInvite: { findUnique: mocks.inviteFind },
  document: { findUnique: mocks.documentFind }, handbookAcknowledgment: { create: mocks.receiptCreate },
  auditLog: { create: mocks.audit },
};

beforeEach(() => {
  vi.resetAllMocks();
  mocks.admin.mockResolvedValue(actor); mocks.writable.mockResolvedValue(actor);
  mocks.transaction.mockImplementation(async (callback: (client: typeof tx) => Promise<unknown>) => callback(tx));
  mocks.itemFind.mockResolvedValue(item); mocks.versionFind.mockResolvedValue(version);
  mocks.employeeFind.mockResolvedValue({ id: "employee-a" });
  mocks.documentFind.mockResolvedValue({ employeeId: "employee-a" });
  mocks.itemCreate.mockResolvedValue({ id: "new-item" });
});

describe("onboarding checklist action authorization and review", () => {
  it("requires admin permission before assignment or review touches the database", async () => {
    mocks.admin.mockRejectedValue(new Error("Not an admin"));
    await expect(assignOnboardingTemplate({ employeeId: "employee-a", versionId: version.id })).rejects.toThrow("Not an admin");
    await expect(reviewOnboardingItem({ id: item.id, expectedUpdatedAt: now.toISOString(), decision: "NOT_APPLICABLE", reason: "Not required" })).rejects.toThrow("Not an admin");
    expect(mocks.transaction).not.toHaveBeenCalled();
  });
  it("does not allow read-only accounts to acknowledge or submit", async () => {
    mocks.writable.mockRejectedValue(new Error("Read only"));
    expect((await acknowledgeHandbook({ id: item.id, confirmed: true })).ok).toBe(false);
    expect((await submitChecklistDocument({ id: item.id, documentId: "document-a" })).ok).toBe(false);
    expect(mocks.transaction).not.toHaveBeenCalled();
  });
  it("rejects another employee's item and evidence without writing", async () => {
    mocks.itemFind.mockResolvedValueOnce({ ...item, employeeId: "employee-b" });
    expect((await acknowledgeHandbook({ id: item.id, confirmed: true })).ok).toBe(false);
    mocks.itemFind.mockResolvedValue({ ...item, itemType: "FORM" });
    mocks.documentFind.mockResolvedValue({ employeeId: "employee-b" });
    expect((await submitChecklistDocument({ id: item.id, documentId: "document-b" })).ok).toBe(false);
    expect(mocks.itemUpdate).not.toHaveBeenCalled(); expect(mocks.receiptCreate).not.toHaveBeenCalled();
  });
  it("refuses drafts, private payroll records, and archived templates", async () => {
    for (const unsafe of [
      { ...version, status: "DRAFT" },
      { ...version, document: { ...version.document, category: "PAYROLL_COMPLIANCE" } },
      { ...version, document: { ...version.document, isArchived: true } },
    ]) {
      mocks.versionFind.mockResolvedValue(unsafe); mocks.itemFind.mockResolvedValue(null);
      expect((await assignOnboardingTemplate({ employeeId: "employee-a", versionId: version.id })).ok).toBe(false);
    }
    expect(mocks.itemCreate).not.toHaveBeenCalled();
  });
  it("records an explicit receipt once and leaves the item pending HR review", async () => {
    expect((await acknowledgeHandbook({ id: item.id, confirmed: false as true })).ok).toBe(false);
    expect(mocks.receiptCreate).not.toHaveBeenCalled();
    expect((await acknowledgeHandbook({ id: item.id, confirmed: true })).ok).toBe(true);
    expect(mocks.receiptCreate).toHaveBeenCalledWith({ data: expect.objectContaining({ versionId: version.id, employeeId: "employee-a", method: "ELECTRONIC", acknowledgmentText: expect.stringContaining("version 2") }) });
    expect(mocks.itemUpdate).toHaveBeenCalledWith({ where: { id: item.id }, data: expect.objectContaining({ status: "SUBMITTED" }) });
    mocks.itemFind.mockResolvedValue({ ...item, acknowledgment: { id: "receipt" } });
    expect((await acknowledgeHandbook({ id: item.id, confirmed: true })).ok).toBe(true);
    expect(mocks.receiptCreate).toHaveBeenCalledTimes(1); expect(mocks.audit).toHaveBeenCalledTimes(1);
  });
  it("requires an employee-owned signed receipt for a paper handbook review", async () => {
    const review = { id: item.id, expectedUpdatedAt: now.toISOString(), decision: "ACCEPTED" as const, reason: "Checked receipt" };
    expect((await reviewOnboardingItem(review)).ok).toBe(false);
    mocks.documentFind.mockResolvedValueOnce({ employeeId: "employee-b" });
    expect((await reviewOnboardingItem({ ...review, paperEvidenceDocumentId: "wrong-document" })).ok).toBe(false);
    expect(mocks.receiptCreate).not.toHaveBeenCalled();
    expect((await reviewOnboardingItem({ ...review, paperEvidenceDocumentId: "own-document" })).ok).toBe(true);
    expect(mocks.receiptCreate).toHaveBeenCalledWith({ data: expect.objectContaining({ method: "PAPER", evidenceDocumentId: "own-document" }) });
  });
  it("refuses stale review decisions and unsubmitted forms", async () => {
    expect((await reviewOnboardingItem({ id: item.id, expectedUpdatedAt: new Date(now.getTime() - 1).toISOString(), decision: "ACCEPTED", reason: "Checked receipt" })).ok).toBe(false);
    mocks.itemFind.mockResolvedValue({ ...item, itemType: "FORM" });
    expect((await reviewOnboardingItem({ id: item.id, expectedUpdatedAt: now.toISOString(), decision: "ACCEPTED", reason: "Checked form" })).ok).toBe(false);
    expect(mocks.itemUpdate).not.toHaveBeenCalled();
  });
  it("preserves an existing immutable handbook receipt instead of requesting an impossible resubmission", async () => {
    mocks.itemFind.mockResolvedValue({ ...item, acknowledgment: { id: "receipt" } });
    const result = await reviewOnboardingItem({ id: item.id, expectedUpdatedAt: now.toISOString(), decision: "NEEDS_CORRECTION", reason: "Please sign again" });
    expect(result).toMatchObject({ ok: false, error: expect.stringContaining("Assign a new handbook version") });
    expect(mocks.itemUpdate).not.toHaveBeenCalled();
    expect(mocks.receiptCreate).not.toHaveBeenCalled();
  });
});
