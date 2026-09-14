#!/usr/bin/env node
/**
 * Refresh docs/screenshots against a live Next + mock API so README shots
 * match current chrome (16-item nav, honest health, ConfirmDialog pages)
 * without signing into a production host.
 *
 *   node e2e/capture-docs-screenshots.mjs
 */
import { createServer } from 'node:http';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from '@playwright/test';

const here = path.dirname(fileURLToPath(import.meta.url));
const frontendRoot = path.resolve(here, '..');
const repoRoot = path.resolve(frontendRoot, '../..');
const shotsDir = path.join(repoRoot, 'docs/screenshots');

const API_PORT = Number(process.env.CAPTURE_API_PORT || 18099);
const WEB_PORT = Number(process.env.CAPTURE_WEB_PORT || 18081);
const API_ORIGIN = `http://127.0.0.1:${API_PORT}`;
const WEB_ORIGIN = process.env.PLAYWRIGHT_BASE_URL || `http://localhost:${WEB_PORT}`;

const now = new Date().toISOString();
const history = Array.from({ length: 12 }, (_, i) => ({
  timestamp: new Date(Date.now() - (11 - i) * 300_000).toISOString(),
  cpuPercent: 28 + (i % 4) * 3,
  memoryPercent: 41 + (i % 3),
  diskPercent: 22,
  networkInMbps: 0.4 + i * 0.05,
  networkOutMbps: 0.2 + i * 0.03,
}));

const maps = [
  { name: 'Overmap', status: 'running', players: 2, maxPlayers: 70, memoryUsedMb: 4100, memoryLimitMb: 8192, cpuPercent: 18, uptimeSeconds: 62000 },
  { name: 'Survival', status: 'running', players: 4, maxPlayers: 70, memoryUsedMb: 10500, memoryLimitMb: 16384, cpuPercent: 32, uptimeSeconds: 62000 },
  { name: 'Arrakeen', status: 'running', players: 0, maxPlayers: 40, memoryUsedMb: 2800, memoryLimitMb: 6144, cpuPercent: 8, uptimeSeconds: 62000 },
  { name: 'Harko Village', status: 'running', players: 1, maxPlayers: 40, memoryUsedMb: 2600, memoryLimitMb: 6144, cpuPercent: 7, uptimeSeconds: 62000 },
];

const services = [
  { name: 'dune-awakening-overmap-1', label: 'Overmap', status: 'healthy', latencyMs: 12, message: 'healthy', isInit: false },
  { name: 'dune-awakening-survival_1-1', label: 'Survival 1', status: 'healthy', latencyMs: 18, message: 'healthy', isInit: false },
  { name: 'dune-awakening-arrakeen-1', label: 'Arrakeen', status: 'healthy', latencyMs: 9, message: 'healthy', isInit: false },
  { name: 'dune-awakening-harko-1', label: 'Harko', status: 'healthy', latencyMs: 11, message: 'healthy', isInit: false },
  { name: 'dune-awakening-db-init-1', label: 'Db Init', status: 'completed', latencyMs: 0, message: 'Finished successfully', isInit: true },
];

const overview = {
  status: {
    serverName: 'One Sandworm One Tacoma',
    region: 'Self-hosted cluster',
    status: 'healthy',
    uptimeSeconds: 62000,
    playersOnline: 7,
    mapsActive: 2,
    maxPlayers: 70,
    version: '2064155-0-shipping',
    services,
  },
  readiness: {
    status: 'ok',
    timestamp: now,
    checks: [
      { name: 'docker', status: 'ok', message: 'reachable' },
      { name: 'postgres', status: 'ok', message: 'reachable' },
    ],
  },
  maps,
  metrics: {
    cpuPercent: 31,
    memoryPercent: 42,
    memoryUsedGb: 12.6,
    memoryTotalGb: 30,
    diskPercent: 22,
    diskUsedGb: 180,
    diskTotalGb: 800,
    networkInMbps: 0.82,
    networkOutMbps: 0.41,
    uptimeSeconds: 62000,
  },
  systemHistory: { range: '1h', points: history },
  uptime: {
    range: '24h',
    availabilityPercent: 99.8,
    totalUpSeconds: 86100,
    totalDownSeconds: 180,
    events: [{ timestamp: now, status: 'up', durationSeconds: 62000 }],
  },
  backups: [],
};

function json(res, body, status = 200) {
  res.writeHead(status, { 'content-type': 'application/json', 'access-control-allow-origin': '*' });
  res.end(JSON.stringify(body));
}

function mockApi() {
  return createServer((req, res) => {
    const url = req.url || '/';
    if (url.includes('session-check')) {
      return json(res, { authEnabled: false, authenticated: false });
    }
    if (url.includes('/auth/me')) {
      return json(res, { method: 'token' });
    }
    if (url.includes('/dashboard/overview')) return json(res, overview);
    if (url.includes('/system/version')) {
      return json(res, { version: '1.8.0', profile: 'standard-lean', environment: 'retail' });
    }
    if (url.includes('/system/metrics')) return json(res, overview.metrics);
    if (url.includes('/system/history')) return json(res, overview.systemHistory);
    if (url.includes('/system/uptime')) return json(res, overview.uptime);
    if (url.includes('/system/shutdown-status')) {
      return json(res, { phase: 'idle', details: [] });
    }
    if (url.includes('/restart/schedule')) {
      return json(res, {
        enabled: false,
        intervalHours: 24,
        restartTimeUtc: null,
        warningMinutes: [15, 5, 1],
        lastRestartAt: null,
        nextRestartAt: null,
      });
    }
    if (url.includes('/maps/bases') || url.includes('/vehicles') || url.includes('/characters')) {
      return json(res, []);
    }
    if (url.includes('/maps')) return json(res, maps);
    if (url.includes('/players/positions') || url.endsWith('/players') || url.includes('/players?')) {
      return json(res, []);
    }
    if (url.includes('/bases')) return json(res, []);
    if (url.includes('/backups')) return json(res, []);
    if (url.includes('/events/stream')) {
      res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache' });
      res.write(':\n\n');
      return;
    }
    if (url === '/ready' || url === '/status' || url.includes('/health')) {
      return json(res, { status: 'ok' });
    }
    console.warn('unmocked', req.method, url);
    return json(res, { detail: 'not mocked', path: url }, 404);
  });
}

async function waitForHttp(origin, tries = 60) {
  for (let i = 0; i < tries; i += 1) {
    try {
      const res = await fetch(origin, { redirect: 'manual' });
      if (res.status) return;
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 500));
    }
  }
  throw new Error(`Timed out waiting for ${origin}`);
}

async function main() {
  const api = mockApi();
  await new Promise((resolve) => api.listen(API_PORT, '127.0.0.1', resolve));

  let nextProc;
  const startedNext = !process.env.PLAYWRIGHT_BASE_URL;
  if (startedNext) {
    nextProc = spawn('npx', ['next', 'dev', '-p', String(WEB_PORT)], {
      cwd: frontendRoot,
      env: {
        ...process.env,
        DUNE_DASHBOARD_API_URL: API_ORIGIN,
        NEXT_TELEMETRY_DISABLED: '1',
      },
      stdio: 'inherit',
    });
  }

  try {
    await waitForHttp(WEB_ORIGIN);
    const browser = await chromium.launch();
    const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, colorScheme: 'dark' });
    const hideDevUi = async () => {
      await page.addStyleTag({
        content: 'nextjs-portal, [data-next-badge-root] { display: none !important; }',
      });
    };

    await page.goto(`${WEB_ORIGIN}/`, { waitUntil: 'domcontentloaded' });
    await page.waitForSelector('[data-testid="sidebar"]');
    await page.getByRole('heading', { name: 'One Sandworm One Tacoma' }).waitFor({ timeout: 30_000 });
    await hideDevUi();
    await page.screenshot({ path: path.join(shotsDir, 'home-overview.png') });

    await page.goto(`${WEB_ORIGIN}/maps`, { waitUntil: 'domcontentloaded' });
    await page.getByRole('heading', { name: 'Map fleet' }).waitFor();
    await page.getByText('players online').first().waitFor({ timeout: 30_000 });
    await hideDevUi();
    await page.screenshot({ path: path.join(shotsDir, 'map-orchestration.png') });

    await page.goto(`${WEB_ORIGIN}/system`, { waitUntil: 'domcontentloaded' });
    await page.getByRole('heading', { name: 'CPU load' }).waitFor({ timeout: 30_000 });
    await hideDevUi();
    await page.screenshot({ path: path.join(shotsDir, 'system-telemetry.png') });

    await browser.close();
    console.log(`Wrote screenshots to ${shotsDir}`);
  } finally {
    if (nextProc) nextProc.kill('SIGTERM');
    api.close();
    if (nextProc) await once(nextProc, 'exit').catch(() => {});
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
