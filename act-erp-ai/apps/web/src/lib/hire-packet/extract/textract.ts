import { DetectDocumentTextCommand, TextractClient } from "@aws-sdk/client-textract";
import { env } from "@/lib/env";

function textractClient() {
  return new TextractClient({
    region: env.AWS_REGION,
    ...(env.AWS_ENDPOINT_URL ? { endpoint: env.AWS_ENDPOINT_URL } : {}),
  });
}

/** OCR fallback for scanned pages / images. Returns plain text or empty string. */
export async function textractText(bytes: Buffer, contentType: string): Promise<string> {
  const client = textractClient();
  const out = await client.send(
    new DetectDocumentTextCommand({
      Document: { Bytes: bytes },
    }),
  );
  void contentType;
  return (out.Blocks ?? [])
    .filter((b) => b.BlockType === "LINE" && b.Text)
    .map((b) => b.Text!)
    .join("\n");
}
