// End-to-end smoke test: runs the real app (mock LLM provider, see playwright.config.ts)
// through the core loop on the sample lease.
import { expect, test } from "@playwright/test";

test("sample lease → highlighted results with a cited red flag", async ({ page, context }) => {
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  await page.goto("/");

  await page.getByRole("tab", { name: "Paste text" }).click();
  await page.getByRole("button", { name: "Try a sample lease" }).click();
  await expect(page.locator("textarea")).toHaveValue(/RESIDENTIAL LEASE AGREEMENT/);

  // Coverage questions: in Chicago, not owner-occupied ≤6 units, no other exclusion.
  await page.locator('input[name="in_chicago"][value="yes"]').check();
  await page.locator('input[name="owner_occupied_six_or_fewer"][value="no"]').check();
  await page.locator('input[name="other_exclusion"][value="no"]').check();

  await page.getByRole("button", { name: "Check my lease" }).click();
  await page.waitForURL("**/results", { timeout: 30_000 });

  // Disclaimer + legal aid are always visible on results.
  await expect(page.getByText("Not legal advice.").first()).toBeVisible();
  await expect(page.getByRole("link", { name: /Law Center for Better Housing/ }).first()).toBeVisible();

  // Demo-mode banner, because the e2e server runs the mock provider.
  await expect(page.getByText(/Demo mode/i).first()).toBeVisible();

  // Open the confession-of-judgment finding and check its citation + message.
  const card = page.locator("button[aria-expanded]", { hasText: /confess|judgment/i }).first();
  await card.click();
  await expect(card).toHaveAttribute("aria-expanded", "true");
  await expect(page.getByText("Chicago Mun. Code § 5-12-140(b)").first()).toBeVisible();

  const copy = page.getByRole("button", { name: "Copy message" }).first();
  await copy.click();
  const copied = await page.evaluate(() => navigator.clipboard.readText());
  expect(copied.length).toBeGreaterThan(10);

  // Missing protections are reported.
  await expect(page.getByText(/RLTO summary/i).first()).toBeVisible();

  // The word "illegal" never appears anywhere on the page.
  const body = await page.locator("body").innerText();
  expect(body).not.toMatch(/\billegal/i);
});

test("results page without data offers a way back", async ({ page }) => {
  await page.goto("/results");
  await expect(page.getByRole("link", { name: /start|home|check a lease|back/i }).first()).toBeVisible();
});

test("PDF upload path produces results", async ({ page }) => {
  await page.goto("/");
  await page.locator('input[type="file"]').setInputFiles("eval/trap-lease.pdf");
  await page.locator('input[name="in_chicago"][value="yes"]').check();
  await page.locator('input[name="owner_occupied_six_or_fewer"][value="no"]').check();
  await page.locator('input[name="other_exclusion"][value="no"]').check();
  await page.getByRole("button", { name: "Check my lease" }).click();
  await page.waitForURL("**/results", { timeout: 30_000 });
  await expect(page.getByText(/10 clauses may be likely unenforceable/)).toBeVisible();
  await expect(page.locator("mark").first()).toBeVisible();
});
