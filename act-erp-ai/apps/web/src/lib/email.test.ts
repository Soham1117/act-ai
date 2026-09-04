import { afterEach, describe, expect, it, vi } from "vitest";

describe("Microsoft Graph email delivery", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
    vi.resetModules();
  });

  it("gets an app token and sends the login code from the configured mailbox", async () => {
    vi.stubEnv("SKIP_ENV_VALIDATION", "true");
    vi.stubEnv("EMAIL_PROVIDER", "microsoft-graph");
    vi.stubEnv("MICROSOFT_TENANT_ID", "tenant-id");
    vi.stubEnv("MICROSOFT_CLIENT_ID", "client-id");
    vi.stubEnv("MICROSOFT_CLIENT_SECRET", "client-secret");
    vi.stubEnv("MICROSOFT_SENDER_USER", "noreply@americancompletiontools.com");

    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ access_token: "access-token", expires_in: 3600 }), {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
      )
      .mockResolvedValueOnce(new Response(null, { status: 202 }));
    vi.stubGlobal("fetch", fetchMock);

    const { sendLoginCode } = await import("./email");
    await sendLoginCode("employee@example.com", "123456");

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock.mock.calls[0]?.[0]).toBe(
      "https://login.microsoftonline.com/tenant-id/oauth2/v2.0/token",
    );
    expect(fetchMock.mock.calls[1]?.[0]).toBe(
      "https://graph.microsoft.com/v1.0/users/noreply%40americancompletiontools.com/sendMail",
    );
    const sendOptions = fetchMock.mock.calls[1]?.[1];
    expect(JSON.parse(String(sendOptions?.body))).toMatchObject({
      message: {
        subject: "Your ACT ERP sign-in code",
        toRecipients: [{ emailAddress: { address: "employee@example.com" } }],
      },
      saveToSentItems: false,
    });
  });
});
