import { describe, expect, it } from "vitest";
import {
  PUNCH_PHOTO_MAX_BYTES,
  PUNCH_PHOTO_PREFIX,
  parsePunchPhoto,
  punchPhotoPath,
} from "./punch-photo";

const jpeg = (extra = 10) =>
  PUNCH_PHOTO_PREFIX + Buffer.from([0xff, 0xd8, 0xff, ...new Array(extra).fill(1)]).toString("base64");

describe("parsePunchPhoto", () => {
  it("accepts a small JPEG data URL", () => {
    expect(parsePunchPhoto(jpeg())?.length).toBe(13);
  });
  it("rejects missing values and wrong prefixes", () => {
    expect(parsePunchPhoto(undefined)).toBeNull();
    expect(parsePunchPhoto("")).toBeNull();
    expect(parsePunchPhoto("data:image/png;base64,AAAA")).toBeNull();
  });
  it("rejects bytes without the JPEG magic", () => {
    expect(parsePunchPhoto(PUNCH_PHOTO_PREFIX + Buffer.from("hello world").toString("base64"))).toBeNull();
  });
  it("rejects invalid base64", () => {
    expect(parsePunchPhoto(PUNCH_PHOTO_PREFIX + "not base64!!")).toBeNull();
  });
  it("rejects photos over the size limit", () => {
    expect(parsePunchPhoto(jpeg(PUNCH_PHOTO_MAX_BYTES))).toBeNull();
  });
});

describe("punchPhotoPath", () => {
  it("builds year/month paths", () => {
    expect(punchPhotoPath("contract", "abc", "out", new Date("2026-03-05T12:00:00Z"))).toBe(
      "contract/2026/03/abc-out.jpg",
    );
  });
});
