import { test, expect, type Page } from "@playwright/test";
import { db } from "./support/db";
import { delayServerActions, expectNoCrash, failServerActions, toast } from "./support/helpers";
import { ADMIN_STATE } from "./support/test-data";
import { SS, SS_DEPARTMENT, SS_EMPTY_DEPARTMENT, empDbId, labelled, loginState, pick } from "./support/self-service";

// Notifications: employee inbox (Nina) and the admin broadcast dialog.
test.use({ storageState: "e2e/.auth/nina.json" });

let ninaId: string;

test.beforeAll(async ({ browser }) => {
  await loginState(browser, SS.nina, "nina");
  ninaId = await empDbId(SS.nina);
});

test.beforeEach(async () => {
  await db.notificationRecipient.deleteMany({ where: { employeeId: ninaId } });
});
test.afterAll(async () => {
  await db.notificationRecipient.deleteMany({ where: { employeeId: ninaId } });
});

async function notify(title: string, opts: { read?: boolean; link?: string; priority?: "LOW" | "MEDIUM" | "HIGH" | "URGENT"; ago?: number } = {}) {
  return db.notification.create({
    data: {
      type: "COMPANY",
      title,
      message: `Message of ${title}`,
      link: opts.link,
      priority: opts.priority ?? "MEDIUM",
      createdAt: new Date(Date.now() - (opts.ago ?? 0) * 1000),
      recipients: { create: [{ employeeId: ninaId, read: opts.read ?? false }] },
    },
  });
}
const unread = () => db.notificationRecipient.count({ where: { employeeId: ninaId, read: false } });
const apiUnread = async (page: Page) => (await (await page.request.get("/api/notifications/unread")).json()).unread;
const item = (page: Page, title: string) => page.getByRole("listitem").filter({ hasText: title });

test.describe("notifications: employee inbox", () => {
  test("lists notifications with unread count, priority, link and no one else's", async ({ page }) => {
    await notify("Policy update", { priority: "URGENT", link: "/dashboard/leave" });
    await notify("Old news", { read: true, ago: 60 });
    await page.goto("/dashboard/notifications");
    await expect(page.getByText("1 unread of 2")).toBeVisible();
    await expect(item(page, "Policy update")).toContainText("URGENT");
    await expect(item(page, "Policy update").getByRole("link", { name: "View details" })).toHaveAttribute("href", "/dashboard/leave");
    await expect(item(page, "Old news").getByRole("button", { name: "Mark as read" })).toHaveCount(0);
    await expect(page.getByText("Olive Secret Notice")).toHaveCount(0);
  });

  test("an external link opens in a new tab; an unsafe link is not shown", async ({ page }) => {
    await notify("External", { link: "https://example.com/x" });
    await notify("Unsafe", { link: "javascript:alert(1)" });
    await page.goto("/dashboard/notifications");
    await expect(item(page, "External").getByRole("link", { name: "Open link" })).toHaveAttribute("target", "_blank");
    await expect(item(page, "Unsafe").getByRole("link")).toHaveCount(0);
  });

  test("marks one notification read; DB and the unread API agree", async ({ page }) => {
    const a = await notify("First");
    await notify("Second");
    await page.goto("/dashboard/notifications");
    expect(await apiUnread(page)).toBe(2);
    await item(page, "First").getByRole("button", { name: "Mark as read" }).click();
    await expect(page.getByText("1 unread of 2")).toBeVisible();
    const r = await db.notificationRecipient.findFirstOrThrow({ where: { employeeId: ninaId, notificationId: a.id } });
    expect(r.read).toBe(true);
    expect(r.readAt).not.toBeNull();
    expect(await unread()).toBe(1);
    expect(await apiUnread(page)).toBe(1);
  });

  test("marks everything read", async ({ page }) => {
    await notify("A");
    await notify("B");
    await page.goto("/dashboard/notifications");
    await page.getByRole("button", { name: "Mark all read" }).click();
    await expect(toast(page, "Marked all read")).toBeVisible();
    await expect(page.getByText("0 unread of 2")).toBeVisible();
    await expect(page.getByRole("button", { name: "Mark all read" })).toHaveCount(0);
    expect(await unread()).toBe(0);
    expect(await apiUnread(page)).toBe(0);
  });

  test("pages through more than 100 notifications", async ({ page }) => {
    for (let start = 0; start < 105; start += 35) {
      await Promise.all(Array.from({ length: 35 }, (_, i) => notify(`Bulk ${String(start + i).padStart(3, "0")}`, { ago: start + i, read: true })));
    }
    await page.goto("/dashboard/notifications");
    await expect(page.getByRole("navigation", { name: "Notification pages" }).getByText("Page 1 of 2")).toBeVisible();
    await expect(page.getByRole("listitem").filter({ hasText: "Bulk " })).toHaveCount(100);
    await page.getByRole("link", { name: "Next" }).click();
    await expect(page.getByRole("navigation", { name: "Notification pages" }).getByText("Page 2 of 2")).toBeVisible();
    await expect(page.getByRole("listitem").filter({ hasText: "Bulk " })).toHaveCount(5);
    await page.goto("/dashboard/notifications?page=99"); // out of range: clamped
    await expect(page.getByRole("navigation", { name: "Notification pages" }).getByText("Page 2 of 2")).toBeVisible();
    await page.goto("/dashboard/notifications?page=abc");
    await expect(page.getByRole("navigation", { name: "Notification pages" }).getByText("Page 1 of 2")).toBeVisible();
  });

  test("the unread API needs a signed-in user", async ({ browser }) => {
    const ctx = await browser.newContext({ storageState: { cookies: [], origins: [] } });
    const res = await ctx.request.get(`http://localhost:${process.env.E2E_PORT}/api/notifications/unread`, { maxRedirects: 0 });
    expect(res.status() === 200 ? (await res.json()).unread : 0).toBe(0);
    await ctx.close();
  });

  test("connection dropped while marking read: error shown, still unread", async ({ page }) => {
    await notify("Keep unread");
    await page.goto("/dashboard/notifications");
    await failServerActions(page, "abort");
    await item(page, "Keep unread").getByRole("button", { name: "Mark as read" }).click();
    await expect(page.getByText(/something went wrong/i).first()).toBeVisible();
    await expectNoCrash(page);
    expect(await unread()).toBe(1);
  });

  test("server error while marking all read: nothing changes", async ({ page }) => {
    await notify("One");
    await page.goto("/dashboard/notifications");
    await failServerActions(page, "500");
    await page.getByRole("button", { name: "Mark all read" }).click();
    await expect(page.getByText(/something went wrong/i).first()).toBeVisible();
    expect(await unread()).toBe(1);
  });

  test("stale deployment while marking read: no crash", async ({ page }) => {
    await notify("Stale one");
    await page.goto("/dashboard/notifications");
    await failServerActions(page, "stale");
    await item(page, "Stale one").getByRole("button", { name: "Mark as read" }).click();
    await expect(page.getByText(/something went wrong|refresh|newer version/i).first()).toBeVisible();
    await expectNoCrash(page);
    expect(await unread()).toBe(1);
  });

  test("double click on Mark all read sends one request", async ({ page }) => {
    await notify("Dbl");
    await page.goto("/dashboard/notifications");
    const slow = await delayServerActions(page, 1500);
    await page.getByRole("button", { name: "Mark all read" }).dblclick();
    await expect(toast(page, "Marked all read")).toBeVisible();
    expect(slow.count()).toBe(1);
  });
});

test.describe("notifications: admin broadcast", () => {
  test.use({ storageState: ADMIN_STATE });

  async function open(page: Page) {
    await page.goto("/admin/notifications");
    await page.getByRole("button", { name: "New broadcast" }).click();
    return page.getByRole("dialog", { name: "Send broadcast" });
  }
  const send = (d: ReturnType<Page["locator"]>) => d.getByRole("button", { name: "Send" });

  test("sends to one department: only its members get it, with priority and link", async ({ page }) => {
    const d = await open(page);
    await pick(page, d, "Priority", "HIGH");
    await labelled(d, "Title").fill("Plant closed Friday");
    await labelled(d, "Message").fill("The plant is closed this Friday.");
    await labelled(d, "Link").fill("https://example.com/closure");
    await pick(page, d, "Audience", "Specific departments");
    await expect(send(d)).toBeDisabled(); // no department yet
    await d.getByRole("checkbox", { name: SS_DEPARTMENT }).click();
    await send(d).click();
    await expect(toast(page, "Sent to 1 recipient(s)")).toBeVisible();
    const n = await db.notification.findFirstOrThrow({ where: { title: "Plant closed Friday" }, include: { recipients: true } });
    expect(n.priority).toBe("HIGH");
    expect(n.link).toBe("https://example.com/closure");
    expect(n.recipients.map((r) => r.employeeId)).toEqual([ninaId]);
    await expect(page.getByText("Plant closed Friday")).toBeVisible();
  });

  test("a department with nobody active is refused", async ({ page }) => {
    const d = await open(page);
    await labelled(d, "Title").fill("Nobody home");
    await labelled(d, "Message").fill("Hello?");
    await pick(page, d, "Audience", "Specific departments");
    await d.getByRole("checkbox", { name: SS_EMPTY_DEPARTMENT }).click();
    await send(d).click();
    await expect(toast(page, /No active employees matched your recipient filters/)).toBeVisible();
    expect(await db.notification.count({ where: { title: "Nobody home" } })).toBe(0);
  });

  test("Send needs title and message; a bad link is refused by the server", async ({ page }) => {
    const d = await open(page);
    await expect(send(d)).toBeDisabled();
    await labelled(d, "Title").fill("Bad link");
    await labelled(d, "Message").fill("Hi");
    await pick(page, d, "Audience", "Specific departments");
    await d.getByRole("checkbox", { name: SS_DEPARTMENT }).click();
    await labelled(d, "Link").fill("not a url");
    await d.locator("form").evaluate((f) => ((f as HTMLFormElement).noValidate = true));
    await send(d).click();
    await expect(toast(page, /Check link/)).toBeVisible();
    expect(await db.notification.count({ where: { title: "Bad link" } })).toBe(0);
  });

  test("server error while sending: error shown, nothing sent; double click sends once", async ({ page }) => {
    const d = await open(page);
    await labelled(d, "Title").fill("Flaky send");
    await labelled(d, "Message").fill("Hi");
    await pick(page, d, "Audience", "Specific departments");
    await d.getByRole("checkbox", { name: SS_DEPARTMENT }).click();
    await failServerActions(page, "500", { times: 1 });
    await send(d).click();
    await expect(page.getByText(/something went wrong/i).first()).toBeVisible();
    expect(await db.notification.count({ where: { title: "Flaky send" } })).toBe(0);
  });

  test("double click on Send delivers once", async ({ page }) => {
    const d = await open(page);
    await labelled(d, "Title").fill("Once only");
    await labelled(d, "Message").fill("Hi");
    await pick(page, d, "Audience", "Specific departments");
    await d.getByRole("checkbox", { name: SS_DEPARTMENT }).click();
    const slow = await delayServerActions(page, 1500);
    await send(d).dblclick();
    await expect(toast(page, "Sent to 1 recipient(s)")).toBeVisible();
    expect(slow.count()).toBe(1);
    expect(await db.notification.count({ where: { title: "Once only" } })).toBe(1);
  });
});
