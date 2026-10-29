vi.mock("server-only", () => ({}));
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  findInvite: vi.fn(), saveDraft: vi.fn(), encrypt: vi.fn(), admin: vi.fn(),
}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/db", () => ({ db: { onboardingInvite: { findUnique: mocks.findInvite, updateMany: mocks.saveDraft } } }));
vi.mock("@/lib/auth", () => ({ requireAdmin: mocks.admin }));
vi.mock("@/lib/auth/password", () => ({ hashPassword: vi.fn() }));
vi.mock("@/lib/storage", () => ({ uploadFile: vi.fn(), deleteFile: vi.fn() }));
vi.mock("@/lib/audit", () => ({ audit: vi.fn() }));
vi.mock("@/lib/notify", () => ({ notifyAdmins: vi.fn() }));
vi.mock("@/lib/rate-limit", () => ({ rateLimited: () => false }));
vi.mock("@/server/sensitive-data", () => ({ encryptSensitiveJson: mocks.encrypt, decryptSensitiveJson: vi.fn() }));

import { saveOnboardingDraft } from "./actions/onboarding";

type DraftWrite = {
  where: {
    id: string;
    status: string;
    expiresAt: { gt: Date };
    OR: [{ draftUpdatedAt: null }, { draftUpdatedAt: { lt: Date } }];
  };
  data: { draftJson: unknown; draftStep: number; draftUpdatedAt: Date };
};
type InviteState = {
  id: string;
  status: string;
  expiresAt: Date;
  draftJson: unknown;
  draftUpdatedAt: Date | null;
  draftStep: number | null;
};
const startedAt = new Date("2026-10-29T12:00:00.000Z");
const encrypted = { $encrypted: "act-kms-json", version: 1, ciphertext: "Zml4dHVyZQ==" };
let state: InviteState;
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(done => { resolve = done; });
  return { promise, resolve };
}

beforeEach(() => {
  vi.resetAllMocks();
  vi.useFakeTimers();
  vi.setSystemTime(startedAt);
  state = {
    id: "invite-test", status: "PENDING", expiresAt: new Date("2026-11-01"),
    draftJson: null, draftUpdatedAt: null, draftStep: null,
  };
  mocks.findInvite.mockImplementation(async () => ({
    id: state.id, status: state.status, expiresAt: state.expiresAt,
  }));
  mocks.encrypt.mockResolvedValue(encrypted);
  mocks.saveDraft.mockImplementation(async ({ where, data }: DraftWrite) => {
    const newerThanSaved = state.draftUpdatedAt === null ||
      state.draftUpdatedAt < where.OR[1].draftUpdatedAt.lt;
    if (where.id !== state.id || where.status !== state.status ||
        !(state.expiresAt > where.expiresAt.gt) || !newerThanSaved) return { count: 0 };
    state = { ...state, ...data };
    return { count: 1 };
  });
});
afterEach(() => vi.useRealTimers());

describe("encrypted onboarding draft action", () => {
  it("writes only encrypted JSON bound to the invite and draft field", async () => {
    const result = await saveOnboardingDraft("test-token-valid", {
      step: 2,
      fields: { name: "Dummy Hire", ddAccount: "000000000", ssnLast4: "0000", password: "never-save" },
    });
    expect(result).toEqual({ ok: true, savedAt: startedAt.toISOString() });
    expect(mocks.encrypt).toHaveBeenCalledWith({
      step: 2,
      fields: { name: "Dummy Hire", ddAccount: "000000000", ssnLast4: "0000" },
      savedAt: startedAt.toISOString(),
    }, { purpose: "onboarding-draft", recordId: "invite-test", field: "draftJson" });
    expect(mocks.saveDraft).toHaveBeenCalledWith({
      where: {
        id: "invite-test", status: "PENDING", expiresAt: { gt: startedAt },
        OR: [{ draftUpdatedAt: null }, { draftUpdatedAt: { lt: startedAt } }],
      },
      data: { draftJson: encrypted, draftStep: 2, draftUpdatedAt: startedAt },
    });
    expect(state.draftJson).toEqual(encrypted);
    expect(JSON.stringify(state.draftJson)).not.toContain("000000000");
  });

  it("does not write plaintext when encryption rejects", async () => {
    mocks.encrypt.mockRejectedValue(new Error("Secure storage unavailable"));
    expect((await saveOnboardingDraft("test-token-valid", { step: 2, fields: { name: "Dummy Hire" } })).ok).toBe(false);
    expect(mocks.saveDraft).not.toHaveBeenCalled();
    expect(state.draftJson).toBeNull();
  });

  it.each(["COMPLETED", "EXPIRED"])("does not resurrect a draft when the invite becomes %s during encryption", async status => {
    const pending = deferred<typeof encrypted>();
    mocks.encrypt.mockReturnValueOnce(pending.promise);
    const request = saveOnboardingDraft("test-token-valid", { step: 2, fields: { name: "Dummy Hire" } });
    await Promise.resolve();
    await Promise.resolve();
    expect(mocks.encrypt).toHaveBeenCalledTimes(1);
    state.status = status;
    state.draftJson = null;
    pending.resolve(encrypted);
    expect((await request).ok).toBe(false);
    expect(state.draftJson).toBeNull();
  });

  it("keeps the newer request when older KMS encryption finishes last", async () => {
    const olderEncryption = deferred<typeof encrypted>();
    mocks.encrypt.mockReturnValueOnce(olderEncryption.promise);
    const older = saveOnboardingDraft("test-token-valid", { step: 1, fields: { name: "Older Dummy" } });
    await Promise.resolve();
    await Promise.resolve();
    expect(mocks.encrypt).toHaveBeenCalledTimes(1);
    const newerTime = new Date(startedAt.getTime() + 10);
    vi.setSystemTime(newerTime);
    const newerEncrypted = { ...encrypted, ciphertext: "bmV3ZXI=" };
    mocks.encrypt.mockResolvedValueOnce(newerEncrypted);
    const newer = await saveOnboardingDraft("test-token-valid", { step: 3, fields: { name: "Newer Dummy" } });
    expect(newer).toEqual({ ok: true, savedAt: newerTime.toISOString() });
    olderEncryption.resolve(encrypted);
    expect((await older).ok).toBe(false);
    expect(state.draftJson).toEqual(newerEncrypted);
    expect(state.draftUpdatedAt).toEqual(newerTime);
    expect(state.draftStep).toBe(3);
    expect(mocks.saveDraft.mock.calls[1][0].where.OR[1].draftUpdatedAt.lt).toEqual(startedAt);
  });
});
