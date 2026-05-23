import { test, expect } from '@playwright/test';

test.describe('Sidebar navigation', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await page.waitForLoadState('networkidle');
  });

  test('sidebar is visible on desktop', async ({ page }) => {
    const sidebar = page.getByTestId('sidebar');
    await expect(sidebar).toBeVisible();
  });

  test('sidebar collapse toggle works smoothly', async ({ page }) => {
    const sidebar = page.getByTestId('sidebar');
    const toggle = page.getByTestId('sidebar-toggle');

    // Sidebar starts expanded at 320px (w-80)
    const initialBox = await sidebar.boundingBox();
    expect(initialBox).toBeTruthy();
    expect(initialBox!.width).toBeGreaterThanOrEqual(300);

    // Click collapse
    await toggle.click();
    await page.waitForTimeout(400); // wait for transition

    // Sidebar should be narrow (~72px / 4.5rem)
    const collapsedBox = await sidebar.boundingBox();
    expect(collapsedBox).toBeTruthy();
    expect(collapsedBox!.width).toBeLessThan(100);

    // Nav labels should be hidden
    const navLabels = sidebar.locator('nav a span');
    const firstLabel = navLabels.first();
    await expect(firstLabel).toHaveCSS('opacity', '0');

    // Expand again
    await toggle.click();
    await page.waitForTimeout(400);

    const expandedBox = await sidebar.boundingBox();
    expect(expandedBox).toBeTruthy();
    expect(expandedBox!.width).toBeGreaterThanOrEqual(300);
  });

  test('collapsed sidebar shows icon tooltips via title', async ({ page }) => {
    const toggle = page.getByTestId('sidebar-toggle');
    await toggle.click();
    await page.waitForTimeout(400);

    const overviewLink = page.getByTestId('sidebar').locator('nav a').first();
    await expect(overviewLink).toHaveAttribute('title', 'Overview');
  });

  test('all navigation links render and are clickable', async ({ page }) => {
    const sidebar = page.getByTestId('sidebar');
    const links = sidebar.locator('nav a');

    const count = await links.count();
    expect(count).toBe(14);

    // Click a few and verify navigation
    await links.filter({ hasText: 'Players' }).click();
    await expect(page).toHaveURL(/\/players/);

    await links.filter({ hasText: 'System' }).click();
    await expect(page).toHaveURL(/\/system/);
  });

  test('cluster status indicator is visible', async ({ page }) => {
    const sidebar = page.getByTestId('sidebar');
    const statusDot = sidebar.locator('.rounded-full').first();
    await expect(statusDot).toBeVisible();
  });
});

test.describe('Sidebar mobile behavior', () => {
  test.use({ viewport: { width: 390, height: 844 } });

  test('sidebar is hidden on mobile by default', async ({ page }) => {
    await page.goto('/');
    await page.waitForLoadState('networkidle');

    const sidebar = page.getByTestId('sidebar');
    // Should be translated off-screen
    const box = await sidebar.boundingBox();
    // On mobile, sidebar is -translate-x-full, so it should be off-screen
    if (box) {
      expect(box.x + box.width).toBeLessThanOrEqual(0);
    }
  });

  test('hamburger menu opens sidebar on mobile', async ({ page }) => {
    await page.goto('/');
    await page.waitForLoadState('networkidle');

    // Click hamburger
    const hamburger = page.getByLabel('Open navigation');
    await hamburger.click();
    await page.waitForTimeout(400);

    const sidebar = page.getByTestId('sidebar');
    const box = await sidebar.boundingBox();
    expect(box).toBeTruthy();
    expect(box!.x).toBeGreaterThanOrEqual(0);

    // Close button should be visible
    const closeBtn = page.getByTestId('sidebar-close');
    await expect(closeBtn).toBeVisible();

    // Backdrop should be visible
    const backdrop = page.locator('[aria-hidden="true"]');
    await expect(backdrop).toHaveCSS('opacity', '1');
  });

  test('clicking backdrop closes mobile sidebar', async ({ page }) => {
    await page.goto('/');
    await page.waitForLoadState('networkidle');

    // Open
    await page.getByLabel('Open navigation').click();
    await page.waitForTimeout(400);

    // Click backdrop
    const backdrop = page.locator('[aria-hidden="true"]');
    await backdrop.click({ position: { x: 350, y: 400 } });
    await page.waitForTimeout(400);

    // Sidebar should be off-screen again
    const sidebar = page.getByTestId('sidebar');
    const box = await sidebar.boundingBox();
    if (box) {
      expect(box.x + box.width).toBeLessThanOrEqual(0);
    }
  });

  test('clicking nav link closes mobile sidebar', async ({ page }) => {
    await page.goto('/');
    await page.waitForLoadState('networkidle');

    // Open sidebar
    await page.getByLabel('Open navigation').click();
    await page.waitForTimeout(400);

    // Click a nav link
    const sidebar = page.getByTestId('sidebar');
    await sidebar.locator('nav a').filter({ hasText: 'Maps' }).click();
    await page.waitForTimeout(400);

    // Sidebar should close
    const box = await sidebar.boundingBox();
    if (box) {
      expect(box.x + box.width).toBeLessThanOrEqual(0);
    }
  });
});

test.describe('Dashboard pages load correctly', () => {
  const pages = [
    { path: '/', title: 'Overview' },
    { path: '/maps', title: 'Maps' },
    { path: '/players', title: 'Players' },
    { path: '/config', title: 'Configuration' },
    { path: '/logs', title: 'Logs' },
    { path: '/system', title: 'System' },
    { path: '/backups', title: 'Backups' },
    { path: '/discord', title: 'Discord' },
    { path: '/announcements', title: 'Announcements' },
    { path: '/watchdog', title: 'Watchdog' },
    { path: '/moderation', title: 'Moderation' },
    { path: '/economy', title: 'Economy' },
    { path: '/characters', title: 'Characters' },
  ];

  for (const pg of pages) {
    test(`${pg.title} page loads without crashing`, async ({ page }) => {
      const criticalErrors: string[] = [];
      page.on('pageerror', (err) => {
        // Ignore API-related errors (expected without auth token)
        if (/Internal Server Error|fetch|401|403|NetworkError/i.test(err.message)) return;
        criticalErrors.push(err.message);
      });

      const response = await page.goto(pg.path);
      await page.waitForLoadState('domcontentloaded');

      // Page should return 200 (SSR/static shell)
      expect(response?.status()).toBe(200);

      // No critical JS errors (API failures are expected)
      expect(criticalErrors).toEqual([]);

      // Page should have content (not blank)
      const body = page.locator('main');
      await expect(body).not.toBeEmpty();
    });
  }

  test('public status page loads', async ({ page }) => {
    const response = await page.goto('/public');
    await page.waitForLoadState('domcontentloaded');

    expect(response?.status()).toBe(200);

    // Should still have content
    const body = page.locator('body');
    await expect(body).not.toBeEmpty();
  });
});

test.describe('Service status display', () => {
  test('db-init shows as completed, not failed', async ({ page }) => {
    await page.goto('/');
    await page.waitForLoadState('networkidle');

    // Find the db-init service card
    const dbInit = page.locator('text=Db-Init').first();
    if (await dbInit.isVisible()) {
      // The status message next to it should say "completed", not "stopped" or "offline"
      const card = dbInit.locator('..');
      const statusText = await card.textContent();
      expect(statusText).toContain('completed');

      // The status dot should be sky/blue colored (completed), not red
      const dot = card.locator('.rounded-full');
      if (await dot.count() > 0) {
        const classes = await dot.first().getAttribute('class');
        expect(classes).not.toContain('bg-red');
      }
    }
  });
});
