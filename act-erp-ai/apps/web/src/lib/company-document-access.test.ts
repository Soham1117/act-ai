import { beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({
  session: vi.fn(), response: vi.fn(),
  db: {companyDocumentVersion: {findUnique: vi.fn()}, onboardingChecklistItem: {findFirst: vi.fn()}, onboardingInvite: {findUnique: vi.fn()}, auditLog: {create: vi.fn()}},
}));
vi.mock("@/lib/auth", () => ({getSessionUser: mocks.session}));
vi.mock("@/lib/db", () => ({db: mocks.db}));
vi.mock("@/lib/file-response", () => ({storedFileResponse: mocks.response}));
import { GET as authenticatedFile } from "@/app/api/company-documents/[versionId]/file/route";
import { GET as inviteFile } from "@/app/onboard/[token]/files/[versionId]/route";
const request = new Request("http://localhost/test");
const version = {id: "version", status: "APPROVED", purpose: "ONBOARDING_TEMPLATE", fileName: "private/test.pdf", originalName: "test.pdf", fileType: "application/pdf", document: {category: "ONBOARDING", isArchived: false, title: "Test form"}};
const employee = {id: "user-test", role: "EMPLOYEE", employeeId: "employee-a"};
beforeEach(() => {vi.resetAllMocks(); mocks.response.mockResolvedValue(new Response("test"));});
describe("company library downloads", () => {
  it("rejects unauthenticated requests without inspecting a file", async () => {
    mocks.session.mockResolvedValue(null);
    expect((await authenticatedFile(request, {params: Promise.resolve({versionId: "version"})})).status).toBe(401);
    expect(mocks.db.companyDocumentVersion.findUnique).not.toHaveBeenCalled();
  });
  it("never streams payroll records to an employee, even with a fabricated assignment", async () => {
    mocks.session.mockResolvedValue(employee);
    mocks.db.companyDocumentVersion.findUnique.mockResolvedValue({...version, document: {...version.document, category: "YEAR_END_TAX"}});
    expect((await authenticatedFile(request, {params: Promise.resolve({versionId: "version"})})).status).toBe(404);
    expect(mocks.response).not.toHaveBeenCalled();
  });
  it("requires the current employee's exact assignment", async () => {
    mocks.session.mockResolvedValue(employee);
    mocks.db.companyDocumentVersion.findUnique.mockResolvedValue(version);
    mocks.db.onboardingChecklistItem.findFirst.mockResolvedValue(null);
    expect((await authenticatedFile(request, {params: Promise.resolve({versionId: "version"})})).status).toBe(404);
    expect(mocks.db.onboardingChecklistItem.findFirst).toHaveBeenCalledWith(expect.objectContaining({where: {employeeId: "employee-a", versionId: "version"}}));
    expect(mocks.response).not.toHaveBeenCalled();
  });
  it("streams only assigned approved templates and audits the read", async () => {
    mocks.session.mockResolvedValue(employee);
    mocks.db.companyDocumentVersion.findUnique.mockResolvedValue(version);
    mocks.db.onboardingChecklistItem.findFirst.mockResolvedValue({id: "item"});
    expect((await authenticatedFile(request, {params: Promise.resolve({versionId: "version"})})).status).toBe(200);
    expect(mocks.response).toHaveBeenCalledWith(expect.objectContaining({key: "documents/private/test.pdf"}));
    expect(mocks.db.auditLog.create).toHaveBeenCalled();
  });
  it.each(["EXPIRED", "COMPLETED"])("refuses %s invite tokens", async (status) => {
    mocks.db.onboardingInvite.findUnique.mockResolvedValue({id: "invite", status, expiresAt: new Date(Date.now() + 60_000)});
    expect((await inviteFile(request, {params: Promise.resolve({token: "token", versionId: "version"})})).status).toBe(404);
    expect(mocks.response).not.toHaveBeenCalled();
  });
  it("does not let an open invite read an unassigned file", async () => {
    mocks.db.onboardingInvite.findUnique.mockResolvedValue({id: "invite-a", status: "PENDING", expiresAt: new Date(Date.now() + 60_000)});
    mocks.db.onboardingChecklistItem.findFirst.mockResolvedValue(null);
    expect((await inviteFile(request, {params: Promise.resolve({token: "token", versionId: "version"})})).status).toBe(404);
    expect(mocks.db.onboardingChecklistItem.findFirst).toHaveBeenCalledWith(expect.objectContaining({where: {inviteId: "invite-a", versionId: "version"}}));
    expect(mocks.response).not.toHaveBeenCalled();
  });
});
