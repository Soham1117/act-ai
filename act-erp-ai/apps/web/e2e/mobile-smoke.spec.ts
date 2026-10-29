import { test, expect } from "@playwright/test";
import { expectNoHorizontalPageScroll } from "./support/mobile";

test.describe("mobile chrome: auth", () => {
  test("login has no page overflow and language sits beside theme", async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== "mobile-chrome", "mobile project only");
    await page.goto("/login");
    await expect(page.getByRole("heading", { name: /welcome back|te damos la bienvenida/i })).toBeVisible();
    await expectNoHorizontalPageScroll(page);
    const lang = page.getByRole("button", { name: /change language|cambiar idioma/i });
    const theme = page.getByRole("button", { name: /toggle theme|cambiar tema/i });
    await expect(lang).toBeVisible();
    await expect(theme).toBeVisible();
    const lb = await lang.boundingBox();
    const tb = await theme.boundingBox();
    expect(lb && tb).toBeTruthy();
    if (lb && tb) {
      const overlapX = !(lb.x + lb.width <= tb.x || tb.x + tb.width <= lb.x);
      const overlapY = !(lb.y + lb.height <= tb.y || tb.y + tb.height <= lb.y);
      expect(overlapX && overlapY).toBe(false);
    }
  });
});
