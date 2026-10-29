import { beforeEach, describe, expect, it, vi } from "vitest";
import { PutObjectCommand } from "@aws-sdk/client-s3";

const mocks = vi.hoisted(() => ({
  send: vi.fn(),
  env: {
    S3_BUCKET: "private-test-bucket",
    S3_KMS_KEY_ARN: undefined as string | undefined,
  },
}));

vi.mock("@/lib/aws", () => ({ s3: () => ({ send: mocks.send }) }));
vi.mock("@/lib/env", () => ({ env: mocks.env }));

import { uploadFile } from "./storage";

const keyArn = "arn:aws:kms:us-east-2:123456789012:key/12345678-1234-1234-1234-123456789abc";

describe("storage KMS protection", () => {
  beforeEach(() => {
    mocks.send.mockReset().mockResolvedValue({});
    mocks.env.S3_KMS_KEY_ARN = undefined;
  });

  it("requests SSE-KMS with the configured key for new private uploads", async () => {
    mocks.env.S3_KMS_KEY_ARN = keyArn;
    const bytes = Buffer.from("dummy sensitive document");

    await expect(uploadFile("documents", "test.pdf", bytes, {
      contentType: "application/pdf",
    })).resolves.toEqual({ path: "test.pdf", key: "documents/test.pdf" });

    expect(mocks.send).toHaveBeenCalledTimes(1);
    const command = mocks.send.mock.calls[0][0];
    expect(command).toBeInstanceOf(PutObjectCommand);
    expect(command.input).toEqual({
      Bucket: "private-test-bucket",
      Key: "documents/test.pdf",
      Body: bytes,
      ContentType: "application/pdf",
      CacheControl: "private, no-store",
      ServerSideEncryption: "aws:kms",
      SSEKMSKeyId: keyArn,
      BucketKeyEnabled: true,
    });
  });

  it("keeps local and pre-rollout storage compatible without an optional key", async () => {
    await uploadFile("payroll", "dummy.pdf", Buffer.from("dummy"));

    const command = mocks.send.mock.calls[0][0];
    expect(command.input.Key).toBe("payroll/dummy.pdf");
    expect(command.input.CacheControl).toBe("private, no-store");
    expect(command.input).not.toHaveProperty("ServerSideEncryption");
    expect(command.input).not.toHaveProperty("SSEKMSKeyId");
    expect(command.input).not.toHaveProperty("BucketKeyEnabled");
  });

  it("propagates KMS access failures without retrying an unencrypted upload", async () => {
    mocks.env.S3_KMS_KEY_ARN = keyArn;
    mocks.send.mockRejectedValueOnce(new Error("KMS access denied"));

    await expect(uploadFile("documents", "test.pdf", Buffer.from("dummy")))
      .rejects.toThrow("KMS access denied");

    expect(mocks.send).toHaveBeenCalledTimes(1);
    expect(mocks.send.mock.calls[0][0].input.ServerSideEncryption).toBe("aws:kms");
  });
});
