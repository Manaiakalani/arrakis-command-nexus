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
    expect(count).toBe(15);

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
    const backdrop = page.getByTestId('sidebar-backdrop');
    await expect(backdrop).toHaveCSS('opacity', '1');
  });

  test('clicking backdrop closes mobile sidebar', async ({ page }) => {
    await page.goto('/');
    await page.waitForLoadState('networkidle');

    // Open
    await page.getByLabel('Open navigation').click();
    await page.waitForTimeout(400);

    // Click backdrop
    const backdrop = page.getByTestId('sidebar-backdrop');
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
    { path: '/settings', title: 'Settings' },
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
      expect(statusText).toContain('Finished successfully');

      // The status indicator should be a green checkmark, not red
      const checkIcon = card.locator('svg');
      if (await checkIcon.count() > 0) {
        const wrapper = checkIcon.first().locator('..');
        const classes = await wrapper.getAttribute('class');
        expect(classes).not.toContain('bg-red');
      }
    }
  });
});

test.describe('Theme toggle', () => {
  test('theme toggle switches between light and dark mode', async ({ page }) => {
    await page.goto('/');
    await page.waitForLoadState('networkidle');

    // Default should be dark mode
    const html = page.locator('html');
    await expect(html).toHaveClass(/dark/);

    // Find and click the theme toggle
    const toggle = page.getByLabel(/Switch to light mode/i);
    await expect(toggle).toBeVisible();
    await toggle.click();
    await page.waitForTimeout(300);

    // Should now be in light mode
    await expect(html).not.toHaveClass(/dark/);

    // Background should be light
    const body = page.locator('body');
    const bgColor = await body.evaluate((el) => getComputedStyle(el).backgroundColor);
    // Light mode bg should be bright (high RGB values)
    const match = bgColor.match(/(\d+)/g);
    if (match) {
      const [r, g, b] = match.map(Number);
      expect(r).toBeGreaterThan(200);
      expect(g).toBeGreaterThan(200);
      expect(b).toBeGreaterThan(200);
    }

    // Toggle back to dark
    const darkToggle = page.getByLabel(/Switch to dark mode/i);
    await darkToggle.click();
    await page.waitForTimeout(300);
    await expect(html).toHaveClass(/dark/);
  });

  test('theme persists across page navigation', async ({ page }) => {
    await page.goto('/');
    await page.waitForLoadState('networkidle');

    // Switch to light mode
    const toggle = page.getByLabel(/Switch to light mode/i);
    await toggle.click();
    await page.waitForTimeout(300);

    // Navigate to another page
    await page.goto('/maps');
    await page.waitForLoadState('networkidle');

    // Should still be in light mode
    const html = page.locator('html');
    await expect(html).not.toHaveClass(/dark/);
  });

  test('all dashboard pages render in light mode without errors', async ({ page }) => {
    await page.goto('/');
    await page.waitForLoadState('networkidle');

    // Switch to light mode
    const toggle = page.getByLabel(/Switch to light mode/i);
    await toggle.click();
    await page.waitForTimeout(300);

    const pages = ['/', '/maps', '/players', '/logs', '/system', '/settings', '/public'];
    for (const path of pages) {
      const criticalErrors: string[] = [];
      page.on('pageerror', (err) => {
        if (/Internal Server Error|fetch|401|403|NetworkError/i.test(err.message)) return;
        criticalErrors.push(err.message);
      });

      const response = await page.goto(path);
      await page.waitForLoadState('domcontentloaded');

      expect(response?.status()).toBe(200);
      expect(criticalErrors).toEqual([]);
    }
  });

  test('light mode: text has sufficient contrast against background', async ({ page }) => {
    await page.goto('/');
    await page.waitForLoadState('networkidle');

    // Switch to light mode
    await page.getByLabel(/Switch to light mode/i).click();
    await page.waitForTimeout(300);

    // Check primary text color is dark on light background
    const heading = page.locator('h1').first();
    const textColor = await heading.evaluate((el) => getComputedStyle(el).color);
    const textMatch = textColor.match(/(\d+)/g);
    if (textMatch) {
      const [r, g, b] = textMatch.map(Number);
      // Dark text on light bg: RGB should be low (< 100)
      expect(r + g + b).toBeLessThan(300);
    }

    // Check sidebar background is light
    const sidebar = page.getByTestId('sidebar');
    const sidebarBg = await sidebar.evaluate((el) => getComputedStyle(el).backgroundColor);
    const sidebarMatch = sidebarBg.match(/(\d+)/g);
    if (sidebarMatch) {
      const [r, g, b] = sidebarMatch.map(Number);
      expect(r).toBeGreaterThan(200);
      expect(g).toBeGreaterThan(200);
      expect(b).toBeGreaterThan(200);
    }
  });

  test('light mode: glass panels have visible borders', async ({ page }) => {
    await page.goto('/');
    await page.waitForLoadState('networkidle');

    await page.getByLabel(/Switch to light mode/i).click();
    await page.waitForTimeout(300);

    // Glass panels should have visible borders in light mode
    const panel = page.locator('.glass-panel').first();
    const borderColor = await panel.evaluate((el) => getComputedStyle(el).borderColor);
    // Border should not be transparent
    expect(borderColor).not.toBe('rgba(0, 0, 0, 0)');
    expect(borderColor).not.toBe('transparent');
  });

  test('light mode: maps page shows map cards correctly', async ({ page }) => {
    await page.goto('/');
    await page.waitForLoadState('networkidle');

    await page.getByLabel(/Switch to light mode/i).click();
    await page.waitForTimeout(300);

    await page.goto('/maps');
    await page.waitForLoadState('networkidle');

    // Map cards should be visible with proper contrast
    const mapCards = page.locator('.glass-panel');
    const count = await mapCards.count();
    expect(count).toBeGreaterThan(0);

    // Check first map card heading text is readable (dark text)
    const firstHeading = page.locator('h3').first();
    if (await firstHeading.isVisible()) {
      const color = await firstHeading.evaluate((el) => getComputedStyle(el).color);
      const match = color.match(/(\d+)/g);
      if (match) {
        const [r, g, b] = match.map(Number);
        expect(r + g + b).toBeLessThan(300);
      }
    }
  });
});

test.describe('Interactive features', () => {
  test('settings page: save general settings', async ({ page }) => {
    await page.goto('/settings');
    await page.waitForLoadState('networkidle');

    // Fill and save general settings
    const serverNameInput = page.locator('#serverName');
    await expect(serverNameInput).toBeVisible();
    await serverNameInput.clear();
    await serverNameInput.fill('Test Nexus');

    const saveBtn = page.getByRole('button', { name: 'Save general' });
    await saveBtn.click();

    // Wait for save to complete (button text changes to "Saving…" then back)
    await expect(saveBtn).toHaveText('Save general', { timeout: 5000 });

    // Reload and verify persistence
    await page.reload();
    await page.waitForLoadState('networkidle');
    await expect(page.locator('#serverName')).toHaveValue('Test Nexus');

    // Restore original name
    await page.locator('#serverName').clear();
    await page.locator('#serverName').fill('Arrakis Command Nexus');
    await page.getByRole('button', { name: 'Save general' }).click();
    await expect(page.getByRole('button', { name: 'Save general' })).toHaveText('Save general', { timeout: 5000 });
  });

  test('settings page: add and remove admin', async ({ page }) => {
    await page.goto('/settings');
    await page.waitForLoadState('networkidle');

    // Add an admin
    const usernameInput = page.locator('#newAdminUser');
    await usernameInput.fill('playwright-test-admin');
    await page.getByRole('button', { name: 'Add' }).click();

    // Wait for the admin to appear
    await expect(page.getByText('playwright-test-admin')).toBeVisible({ timeout: 5000 });

    // Accept the confirm dialog and remove
    page.on('dialog', (dialog) => dialog.accept());
    const removeBtn = page.getByLabel('Remove playwright-test-admin');
    await removeBtn.click();

    // Should disappear
    await expect(page.getByText('playwright-test-admin')).not.toBeVisible({ timeout: 5000 });
  });

  test('settings page: export settings downloads JSON', async ({ page }) => {
    await page.goto('/settings');
    await page.waitForLoadState('networkidle');

    const [download] = await Promise.all([
      page.waitForEvent('download'),
      page.getByRole('button', { name: 'Export settings' }).click(),
    ]);

    expect(download.suggestedFilename()).toMatch(/^nexus-settings-.*\.json$/);
  });

  test('maps page: map cards render with action buttons', async ({ page }) => {
    await page.goto('/maps');
    await page.waitForLoadState('networkidle');

    // Wait for map cards to load
    const startBtn = page.getByRole('button', { name: 'Start' }).first();
    const stopBtn = page.getByRole('button', { name: 'Stop' }).first();
    const restartBtn = page.getByRole('button', { name: 'Restart' }).first();

    // At least one set of action buttons should be visible
    const hasButtons = await startBtn.or(stopBtn).or(restartBtn).count();
    expect(hasButtons).toBeGreaterThan(0);
  });

  test('overview page: action buttons render', async ({ page }) => {
    await page.goto('/');
    await page.waitForLoadState('networkidle');

    // Restart all and Backup now buttons should be visible
    await expect(page.getByRole('button', { name: /Restart all/i })).toBeVisible();
    await expect(page.getByRole('button', { name: /Backup now/i })).toBeVisible();
  });

  test('backups page: schedule controls render', async ({ page }) => {
    await page.goto('/backups');
    await page.waitForLoadState('networkidle');

    // Schedule section should have enable/disable and save buttons
    const scheduleToggle = page.getByRole('button', { name: /scheduling/i });
    await expect(scheduleToggle).toBeVisible();

    const saveBtn = page.getByRole('button', { name: /Save schedule/i });
    await expect(saveBtn).toBeVisible();
  });

  test('announcements page: send form renders', async ({ page }) => {
    await page.goto('/announcements');
    await page.waitForLoadState('networkidle');

    // Should have the send announcement button
    await expect(page.getByRole('button', { name: /Send announcement/i })).toBeVisible();
  });

  test('moderation page: chat guard renders', async ({ page }) => {
    await page.goto('/moderation');
    await page.waitForLoadState('networkidle');

    // Should show "Chat guard" heading
    await expect(page.getByRole('heading', { name: 'Chat guard' })).toBeVisible();
  });

  test('players page: player table or empty state renders', async ({ page }) => {
    await page.goto('/players');
    await page.waitForLoadState('networkidle');

    // Should have either a player table or the page content
    const body = page.locator('main');
    await expect(body).not.toBeEmpty();
  });

  test('watchdog page: status cards render', async ({ page }) => {
    await page.goto('/watchdog');
    await page.waitForLoadState('networkidle');

    // Should show watchdog state
    await expect(page.getByText(/Watchdog state/i)).toBeVisible();
  });

  test('economy page: alert form renders', async ({ page }) => {
    await page.goto('/economy');
    await page.waitForLoadState('networkidle');

    // Should show the manual injection section
    await expect(page.getByText(/Manual injection/i)).toBeVisible();
  });

  test('config page: config editor renders', async ({ page }) => {
    await page.goto('/config');
    await page.waitForLoadState('networkidle');

    // Should show configuration changes warning and drift summary
    await expect(page.getByText(/Changes require restart/i)).toBeVisible();
    await expect(page.getByText(/Drift summary/i)).toBeVisible();
  });

  test('system page: resource metrics render', async ({ page }) => {
    await page.goto('/system');
    await page.waitForLoadState('networkidle');

    // Should show CPU, Memory, Disk, Network sections
    await expect(page.getByRole('heading', { name: 'CPU load' }).first()).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Memory pressure' }).first()).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Disk usage' }).first()).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Network pulse' }).first()).toBeVisible();
  });

  test('discord page: webhook management renders', async ({ page }) => {
    await page.goto('/discord');
    await page.waitForLoadState('networkidle');

    // Should show the event history section
    await expect(page.getByText('Event history')).toBeVisible();
  });

  test('logs page: log stream renders', async ({ page }) => {
    await page.goto('/logs');
    await page.waitForLoadState('domcontentloaded');

    // Should show service logs heading and filter
    await expect(page.getByText('Service logs')).toBeVisible({ timeout: 10000 });
  });
});
