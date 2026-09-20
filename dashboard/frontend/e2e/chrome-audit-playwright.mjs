import { chromium } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const outDir = join(__dirname, '..', 'e2e-results');
mkdirSync(outDir, { recursive: true });

const baseURL = process.env.PLAYWRIGHT_BASE_URL || 'http://127.0.0.1:18080';
const cookie = process.env.DASHBOARD_SESSION;
if (!cookie || !cookie.includes('=')) {
  console.error('DASHBOARD_SESSION=name=value is required');
  process.exit(2);
}
const [cookieName, ...rest] = cookie.split('=');
const cookieValue = rest.join('=');
const url = new URL(baseURL);

const browser = await chromium.launch();
const context = await browser.newContext({
  viewport: { width: 1440, height: 900 },
  colorScheme: 'dark',
});
await context.addCookies([
  {
    name: cookieName,
    value: cookieValue,
    domain: url.hostname,
    path: '/',
    httpOnly: true,
    secure: false,
    sameSite: 'Lax',
  },
]);
const page = await context.newPage();
await page.goto(`${baseURL}/`, { waitUntil: 'domcontentloaded' });
await page.waitForSelector('[data-testid="sidebar"]', { timeout: 15000 });
await page.waitForFunction(
  () => {
    const title = document.querySelector('h1');
    const live = document.querySelector('[data-testid="sse-status"]');
    return Boolean(
      title && !/Loading/.test(title.textContent || '') &&
      live && /Live|Polling|Connecting/.test(live.textContent || ''),
    );
  },
  { timeout: 20000 },
);
await page.waitForTimeout(1200);

const measures = await page.evaluate(() => {
  const box = (sel) => {
    const el = document.querySelector(sel);
    if (!el) return null;
    const r = el.getBoundingClientRect();
    const cs = getComputedStyle(el);
    return {
      h: Math.round(r.height),
      w: Math.round(r.width),
      y: Math.round(r.y),
      text: (el.textContent || '').replace(/\s+/g, ' ').trim(),
    };
  };
  const htmlCs = getComputedStyle(document.documentElement);
  return {
    path: location.pathname,
    region: box('[data-testid="region-chip"]'),
    live: box('[data-testid="sse-status"]'),
    session: box('[data-testid="session-menu"]'),
    health: box('[data-testid="header-health"]'),
    cluster: box('[data-testid="header-cluster"]'),
    sidebar: box('[data-testid="sidebar"]'),
    title: document.querySelector('h1')?.textContent?.trim() ?? '',
    scrollbarWidth: htmlCs.scrollbarWidth,
    scrollbarColor: htmlCs.scrollbarColor,
    gutter: htmlCs.scrollbarGutter,
  };
});

await page.screenshot({ path: join(outDir, 'playwright-expanded.png'), fullPage: false });

const minimize = page.getByTestId('sidebar-minimize');
await minimize.click();
await page.waitForTimeout(450);
await page.screenshot({ path: join(outDir, 'playwright-collapsed.png'), fullPage: false });
const collapsedWidth = await page.getByTestId('sidebar').evaluate((el) => el.getBoundingClientRect().width);
const persisted = await page.evaluate(() => localStorage.getItem('arrakis-sidebar-collapsed'));

try {
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.waitForSelector('[data-testid="sidebar"]', { timeout: 15000 });
} catch (error) {
  await page.screenshot({ path: join(outDir, 'playwright-reload-fail.png'), fullPage: false });
  throw error;
}
await page.waitForTimeout(400);
const afterReload = await page.getByTestId('sidebar').evaluate((el) => el.getBoundingClientRect().width);

console.log(JSON.stringify({
  engine: 'playwright',
  measures,
  collapsedWidth: Math.round(collapsedWidth),
  persisted,
  afterReload: Math.round(afterReload),
}, null, 2));

await browser.close();
if (measures.path === '/login') {
  process.exit(3);
}
if (collapsedWidth >= 100 || persisted !== '1' || afterReload >= 100) {
  process.exit(4);
}
const chips = [measures.region, measures.live, measures.health].filter(Boolean);
if (chips.some((c) => Math.abs(c.h - chips[0].h) > 4) || chips.some((c) => Math.abs(c.y - chips[0].y) > 6)) {
  process.exit(5);
}
if (/Loading/.test(measures.title || '')) {
  process.exit(6);
}
