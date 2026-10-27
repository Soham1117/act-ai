import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  cookies: vi.fn(),
  findUnique: vi.fn(),
  update: vi.fn(),
  getSessionUserForPasswordChange: vi.fn(),
  set: vi.fn(),
  delete: vi.fn(),
  get: vi.fn(),
}));

vi.mock("react", () => ({ cache: (fn: (...args: never[]) => unknown) => fn }));
vi.mock("next/headers", () => ({ cookies: mocks.cookies }));
vi.mock("@/lib/db", () => ({
  db: { user: { findUnique: mocks.findUnique, update: mocks.update } },
}));
vi.mock("@/lib/auth", () => ({
  getSessionUserForPasswordChange: mocks.getSessionUserForPasswordChange,
}));

import { getPortalLanguage } from "@/lib/portal-i18n/server";
import { setPortalLanguage } from "@/server/actions/portal-language";
import { applyPendingPortalLanguage } from "@/server/portal-language-preference";

function setCookieJar(pending?: string, language?: string) {
  mocks.get.mockImplementation((key: string) => {
    const value =
      key === "act_portal_language_pending"
        ? pending
        : key === "act_portal_language"
          ? language
          : undefined;
    return value === undefined ? undefined : { value };
  });
  mocks.cookies.mockResolvedValue({
    get: mocks.get,
    set: mocks.set,
    delete: mocks.delete,
  });
}

describe("portal language preference persistence", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.update.mockResolvedValue({});
    mocks.findUnique.mockResolvedValue(null);
    mocks.getSessionUserForPasswordChange.mockResolvedValue(null);
    setCookieJar();
  });

  it("updates only the authenticated session user's preference", async () => {
    mocks.getSessionUserForPasswordChange.mockResolvedValue({ id: "session-user" });

    const result = await setPortalLanguage("es");

    expect(result).toEqual({ ok: true });
    expect(mocks.update).toHaveBeenCalledOnce();
    expect(mocks.update).toHaveBeenCalledWith({
      where: { id: "session-user" },
      data: { preferredLanguage: "es" },
    });
    expect(mocks.set).toHaveBeenCalledWith(
      "act_portal_language",
      "es",
      expect.any(Object),
    );
    expect(mocks.delete).toHaveBeenCalledWith("act_portal_language_pending");
  });

  it("stores an anonymous choice as a pending cookie", async () => {
    const result = await setPortalLanguage("es");

    expect(result).toEqual({ ok: true });
    expect(mocks.update).not.toHaveBeenCalled();
    expect(mocks.set).toHaveBeenCalledWith(
      "act_portal_language",
      "es",
      expect.any(Object),
    );
    expect(mocks.set).toHaveBeenCalledWith(
      "act_portal_language_pending",
      "es",
      expect.any(Object),
    );
    expect(mocks.delete).not.toHaveBeenCalled();
  });

  it("does not write for an invalid language", async () => {
    const result = await setPortalLanguage("fr" as "en");

    expect(result).toMatchObject({ ok: false });
    expect(mocks.update).not.toHaveBeenCalled();
    expect(mocks.set).not.toHaveBeenCalled();
    expect(mocks.delete).not.toHaveBeenCalled();
  });

  it("applies and consumes a valid pending choice for the successful login user", async () => {
    setCookieJar("es");

    await applyPendingPortalLanguage("successful-login-user");

    expect(mocks.update).toHaveBeenCalledWith({
      where: { id: "successful-login-user" },
      data: { preferredLanguage: "es" },
    });
    expect(mocks.delete).toHaveBeenCalledWith("act_portal_language_pending");
  });

  it.each([undefined, "fr"])(
    "does not write when the pending choice is %s",
    async (pending) => {
      setCookieJar(pending);

      await applyPendingPortalLanguage("successful-login-user");

      expect(mocks.update).not.toHaveBeenCalled();
      expect(mocks.set).not.toHaveBeenCalled();
      expect(mocks.delete).not.toHaveBeenCalled();
    },
  );

  it("does not throw or consume the pending choice when persistence fails", async () => {
    setCookieJar("en");
    mocks.update.mockRejectedValue(new Error("database unavailable"));
    const errorLog = vi.spyOn(console, "error").mockImplementation(() => {});

    await expect(
      applyPendingPortalLanguage("successful-login-user"),
    ).resolves.toBeUndefined();

    expect(mocks.delete).not.toHaveBeenCalled();
    expect(errorLog).toHaveBeenCalledOnce();
    errorLog.mockRestore();
  });

  it("uses the saved account language ahead of a stale browser cookie", async () => {
    mocks.getSessionUserForPasswordChange.mockResolvedValue({ id: "saved-user" });
    mocks.findUnique.mockResolvedValue({ preferredLanguage: "es" });
    setCookieJar(undefined, "en");

    const language = await getPortalLanguage();

    expect(mocks.findUnique).toHaveBeenCalledWith({
      where: { id: "saved-user" },
      select: { preferredLanguage: true },
    });
    expect(language.language).toBe("es");
    expect(language.t("timesheet.kioskTitle")).not.toBe("timesheet.kioskTitle");
  });
});
