import { describe, expect, it } from "vitest";
import {
  notificationPage,
  notificationPageCount,
  notificationPageHref,
} from "../app/(employee)/dashboard/notifications/notification-pagination";

describe("notification pagination", () => {
  it("normalizes invalid requested pages", () => {
    expect(notificationPage(undefined)).toBe(1);
    expect(notificationPage("0")).toBe(1);
    expect(notificationPage("not-a-page")).toBe(1);
    expect(notificationPage("2")).toBe(2);
  });

  it("keeps records beyond the first 100 reachable", () => {
    expect(notificationPageCount(101, 100)).toBe(2);
    expect(notificationPageHref(2)).toBe("/dashboard/notifications?page=2");
  });

  it("uses the canonical first-page URL", () => {
    expect(notificationPageCount(0, 100)).toBe(1);
    expect(notificationPageHref(1)).toBe("/dashboard/notifications");
  });
});
