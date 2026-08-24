import { SESClient, SendEmailCommand } from "@aws-sdk/client-ses";
import { env } from "@/lib/env";

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

/** Login 2FA code. Plain text only — no need for a styled HTML email here. */
export async function sendLoginCode(to: string, code: string): Promise<void> {
  await ses().send(
    new SendEmailCommand({
      Source: env.SES_FROM_EMAIL,
      Destination: { ToAddresses: [to] },
      Message: {
        Subject: { Data: "Your ACT ERP sign-in code" },
        Body: {
          Text: {
            Data: `Your sign-in code is ${code}.\n\nIt expires in 10 minutes. If you didn't try to sign in, you can ignore this email.`,
          },
        },
      },
    }),
  );
}
