import { SESClient, SendEmailCommand } from "@aws-sdk/client-ses";
import { env } from "./env";

let _ses: SESClient | null = null;
function ses(): SESClient {
  if (!_ses) {
    _ses = new SESClient({
      region: env.AWS_REGION,
      ...(env.AWS_ENDPOINT_URL ? { endpoint: env.AWS_ENDPOINT_URL } : {}),
    });
  }
  return _ses;
}

async function sendWithSes(to: string, subject: string, text: string) {
  await ses().send(
    new SendEmailCommand({
      Source: env.SES_FROM_EMAIL!,
      Destination: { ToAddresses: [to] },
      Message: { Subject: { Data: subject }, Body: { Text: { Data: text } } },
    }),
  );
}

let graphToken: { value: string; expiresAt: number } | null = null;

async function getGraphToken() {
  if (graphToken && graphToken.expiresAt > Date.now() + 60_000) {
    return graphToken.value;
  }

  const body = new URLSearchParams({
    client_id: env.MICROSOFT_CLIENT_ID!,
    client_secret: env.MICROSOFT_CLIENT_SECRET!,
    scope: "https://graph.microsoft.com/.default",
    grant_type: "client_credentials",
  });
  const response = await fetch(
    `https://login.microsoftonline.com/${encodeURIComponent(env.MICROSOFT_TENANT_ID!)}/oauth2/v2.0/token`,
    {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body,
    },
  );
  if (!response.ok) {
    throw new Error(`Microsoft Graph token request failed (${response.status}).`);
  }
  const data = (await response.json()) as {
    access_token?: string;
    expires_in?: number;
  };
  if (!data.access_token) {
    throw new Error("Microsoft Graph token response had no access token.");
  }
  graphToken = {
    value: data.access_token,
    expiresAt: Date.now() + (data.expires_in ?? 3600) * 1000,
  };
  return graphToken.value;
}

async function sendWithMicrosoftGraph(to: string, subject: string, text: string) {
  const token = await getGraphToken();
  const sender = env.MICROSOFT_SENDER_USER!;
  const response = await fetch(
    `https://graph.microsoft.com/v1.0/users/${encodeURIComponent(sender)}/sendMail`,
    {
      method: "POST",
      headers: {
        authorization: `Bearer ${token}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        message: {
          subject,
          body: { contentType: "Text", content: text },
          toRecipients: [{ emailAddress: { address: to } }],
        },
        saveToSentItems: false,
      }),
    },
  );
  if (!response.ok) {
    throw new Error(`Microsoft Graph sendMail failed (${response.status}).`);
  }
}

/** Login 2FA code. Plain text only — no need for a styled HTML email here. */
export async function sendLoginCode(to: string, code: string): Promise<void> {
  const subject = "Your ACT ERP sign-in code";
  const text = `Your sign-in code is ${code}.\n\nIt expires in 10 minutes. If you didn't try to sign in, you can ignore this email.`;
  if (env.EMAIL_PROVIDER === "microsoft-graph") {
    return sendWithMicrosoftGraph(to, subject, text);
  }
  return sendWithSes(to, subject, text);
}
