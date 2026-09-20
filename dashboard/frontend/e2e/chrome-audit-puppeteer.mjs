import puppeteer from 'puppeteer';
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
const { hostname, port, protocol } = new URL(baseURL);

const browser = await puppeteer.launch({ headless: true });
const page = await browser.newPage();
await page.setViewport({ width: 1440, height: 900 });
await page.setCookie({
  name: cookieName,
  value: cookieValue,
  domain: hostname,
  path: '/',
  httpOnly: true,
  secure: false,
});
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
await new Promise((r) => setTimeout(r, 1200));

const measures = await page.evaluate(() => {
  const box = (sel) => {
    const el = document.querySelector(sel);
    if (!el) return null;
    const r = el.getBoundingClientRect();
    return { h: Math.round(r.height), w: Math.round(r.width), y: Math.round(r.y), text: (el.textContent || '').replace(/\s+/g, ' ').trim() };
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

await page.screenshot({ path: join(outDir, 'puppeteer-expanded.png') });
await page.click('[data-testid="sidebar-minimize"]');
await new Promise((r) => setTimeout(r, 450));
await page.screenshot({ path: join(outDir, 'puppeteer-collapsed.png') });
const collapsedWidth = await page.$eval('[data-testid="sidebar"]', (el) => el.getBoundingClientRect().width);
const persisted = await page.evaluate(() => localStorage.getItem('arrakis-sidebar-collapsed'));
await page.reload({ waitUntil: 'domcontentloaded' });
await page.waitForSelector('[data-testid="sidebar"]', { timeout: 15000 });
await new Promise((r) => setTimeout(r, 400));
const afterReload = await page.$eval('[data-testid="sidebar"]', (el) => el.getBoundingClientRect().width);

console.log(JSON.stringify({
  engine: 'puppeteer',
  measures,
  collapsedWidth: Math.round(collapsedWidth),
  persisted,
  afterReload: Math.round(afterReload),
}, null, 2));
await browser.close();
if (measures.path === '/login') process.exit(3);
if (collapsedWidth >= 100 || persisted !== '1' || afterReload >= 100) process.exit(4);
const chips = [measures.region, measures.live, measures.health].filter(Boolean);
if (chips.some((c) => Math.abs(c.h - chips[0].h) > 4) || chips.some((c) => Math.abs(c.y - chips[0].y) > 6)) {
  process.exit(5);
}
if (/Loading/.test(measures.title || '')) {
  process.exit(6);
}
