import { beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({
  admin: vi.fn(), upload: vi.fn(), remove: vi.fn(),
  tx: {companyDocumentVersion: {findUnique: vi.fn(), updateMany: vi.fn()}, auditLog: {create: vi.fn()}},
  database: {$transaction: vi.fn(), companyDocumentVersion: {findUnique: vi.fn()}},
}));
vi.mock("@/lib/auth", () => ({requireAdmin: mocks.admin}));
vi.mock("@/lib/storage", () => ({uploadFile: mocks.upload, deleteFile: mocks.remove}));
vi.mock("@/lib/db", () => ({db: mocks.database}));
vi.mock("next/cache", () => ({revalidatePath: vi.fn()}));
import { approveCompanyVersion, setCompanyDocumentArchived, uploadCompanyDocument } from "./company-documents";

beforeEach(() => {
  vi.resetAllMocks();
  mocks.admin.mockResolvedValue({id: "admin-test-id", email: "admin@example.test"});
  mocks.database.$transaction.mockImplementation((fn) => fn(mocks.tx));
});
describe("company library action authorization", () => {
  it("refuses every write before validation/storage when the admin guard denies", async () => {
    mocks.admin.mockRejectedValue(new Error("Admin required"));
    await expect(uploadCompanyDocument({title: "Return", category: "YEAR_END_TAX"}, {name: "return.pdf", type: "application/pdf", bytes: new ArrayBuffer(1)})).rejects.toThrow("Admin required");
    await expect(approveCompanyVersion({id: "v", purpose: "ONBOARDING_TEMPLATE", reason: "Reviewed"})).rejects.toThrow("Admin required");
    await expect(setCompanyDocumentArchived({id: "d", archived: true, reason: "Reviewed"})).rejects.toThrow("Admin required");
    expect(mocks.upload).not.toHaveBeenCalled();
    expect(mocks.database.$transaction).not.toHaveBeenCalled();
  });
  it.each(["ONBOARDING_TEMPLATE", "BENEFIT_RESOURCE"])("cannot approve a company tax record for %s", async (purpose) => {
    mocks.tx.companyDocumentVersion.findUnique.mockResolvedValue({status: "DRAFT", document: {category: "YEAR_END_TAX", isArchived: false}});
    const result = await approveCompanyVersion({id: "v", purpose, reason: "Reviewed file"});
    expect(result.ok).toBe(false);
    expect(mocks.tx.companyDocumentVersion.updateMany).not.toHaveBeenCalled();
  });
  it("does not reuse an approved version for a different purpose", async () => {
    mocks.tx.companyDocumentVersion.findUnique.mockResolvedValue({status: "APPROVED", purpose: "HR_ONLY", document: {category: "HANDBOOK", isArchived: false}});
    expect((await approveCompanyVersion({id: "v", purpose: "ONBOARDING_TEMPLATE", reason: "Reviewed file"})).ok).toBe(false);
    expect(mocks.tx.companyDocumentVersion.updateMany).not.toHaveBeenCalled();
  });
  it("does not upload an identical file again", async () => {
    mocks.database.companyDocumentVersion.findUnique.mockResolvedValue({document: {title: "Existing return"}});
    const bytes = new TextEncoder().encode("%PDF-1.4\nTest only").buffer;
    const result = await uploadCompanyDocument({title: "Renamed", category: "YEAR_END_TAX"}, {name: "renamed.pdf", type: "application/pdf", bytes});
    expect(result.ok).toBe(false);
    expect(mocks.upload).not.toHaveBeenCalled();
  });
});
