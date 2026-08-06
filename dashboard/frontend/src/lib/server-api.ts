// Server-side only — do not import from client components.

import { headers } from 'next/headers';

const INTERNAL_API = process.env.INTERNAL_API_URL ?? 'http://dashboard-api:8080/api/v1';
const TOKEN = process.env.DUNE_ADMIN_TOKEN ?? '';

/**
 * Fetch from the API during server rendering, as the signed-in caller.
 *
 * The caller's session cookie is forwarded so the backend applies *their* role.
 * Without it every server-rendered page would be fetched with the machine
 * token, the backend would treat it as an operator, and role-based redaction
 * would be silently bypassed — a viewer's own page would arrive with the
 * credentials redaction is meant to hide baked into the HTML.
 *
 * The backend prefers a valid session cookie over the token, so the token
 * stays as the fallback that keeps legacy (pre-sign-in) deployments working.
 */
export async function serverFetch<T>(path: string): Promise<T> {
  const cookie = (await headers()).get('cookie');

  const res = await fetch(`${INTERNAL_API}${path}`, {
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/json',
      ...(cookie ? { Cookie: cookie } : {}),
      ...(TOKEN ? { 'X-Admin-Token': TOKEN } : {}),
    },
    cache: 'no-store',
  });

  if (!res.ok) {
    throw new Error(`Server fetch failed: ${res.status} ${res.statusText}`);
  }

  return res.json() as Promise<T>;
}
