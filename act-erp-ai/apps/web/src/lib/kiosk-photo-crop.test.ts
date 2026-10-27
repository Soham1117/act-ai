import { describe, expect, it } from "vitest";
import { getCenterSquareCrop } from "./kiosk-photo-crop";

describe("getCenterSquareCrop", () => {
  it("crops landscape frames to a centered square", () => {
    expect(getCenterSquareCrop(1920, 1080)).toEqual({
      x: 420,
      y: 0,
      width: 1080,
      height: 1080,
    });
  });

  it("crops portrait frames to a centered square", () => {
    expect(getCenterSquareCrop(1080, 1920)).toEqual({
      x: 0,
      y: 420,
      width: 1080,
      height: 1080,
    });
  });

  it("keeps square frames unchanged", () => {
    expect(getCenterSquareCrop(720, 720)).toEqual({
      x: 0,
      y: 0,
      width: 720,
      height: 720,
    });
  });
});
