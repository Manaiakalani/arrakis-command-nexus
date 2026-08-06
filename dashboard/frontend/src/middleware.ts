import { NextRequest, NextResponse } from 'next/server';

/**
 * Gatekeeper for everything the browser asks for.
 *
 * Historically this unconditionally injected the shared admin token into every
 * proxied API call, which meant anyone who could load the page was already a
 * full administrator — the "users and roles" screen was decorative (#52).
 *
 * Now the token is only injected while the deployment has no sign-in accounts
 * configured, which keeps existing installs working after an upgrade. As soon
 * as an operator creates the first account, browser traffic must carry a
 * session cookie instead and the backend enforces identity, role, session
 * timeout and IP allowlist (#53).
 */

const SESSION_COOKIE = 'dune_session';
const LOGIN_PATH = '/login';

const API_ORIGIN = process.env.DUNE_DASHBOARD_API_URL || 'http://dashboard-api:8080';

// Paths that must stay reachable without a session.
const PUBLIC_PAGES = ['/login', '/public'];
const PUBLIC_API = ['/api/v1/auth/status', '/api/auth/status', '/api/v1/auth/login', '/api/auth/login'];

const STATUS_TTL_MS = 30_000;

let cachedAuthEnabled: boolean | undefined;
let cachedAt = 0;

/**
 * Ask the backend whether sign-in has been configured.
 *
 * Once we have seen sign-in enabled we never revert to the legacy token path,
 * even if a later probe fails. Otherwise anyone able to disrupt this call
 * could downgrade the dashboard back to unauthenticated access.
 */
async function isAuthEnabled(): Promise<boolean> {
  if (cachedAuthEnabled === true) return true;
  if (cachedAuthEnabled !== undefined && Date.now() - cachedAt < STATUS_TTL_MS) {
    return cachedAuthEnabled;
  }
  try {
    const res = await fetch(`${API_ORIGIN}/api/v1/auth/status`, {
      headers: { accept: 'application/json' },
      cache: 'no-store',
      signal: AbortSignal.timeout(3000),
    });
    if (!res.ok) throw new Error(`status ${res.status}`);
    const body = (await res.json()) as { authEnabled?: boolean };
    cachedAuthEnabled = body.authEnabled === true;
    cachedAt = Date.now();
  } catch {
    // Unknown state: fall back to the legacy path only if we have never
    // successfully observed sign-in being enabled.
    if (cachedAuthEnabled === undefined) return false;
  }
  return cachedAuthEnabled === true;
}

export async function middleware(request: NextRequest) {
  const { pathname, search } = request.nextUrl;
  const requestHeaders = new Headers(request.headers);

  // Always strip client-supplied privileged headers to prevent escalation.
  requestHeaders.delete('X-Admin-Role');
  requestHeaders.delete('X-Admin-Token');

  const hasSession = Boolean(request.cookies.get(SESSION_COOKIE)?.value);
  const authEnabled = await isAuthEnabled();

  if (pathname.startsWith('/api')) {
    if (PUBLIC_API.includes(pathname)) {
      return NextResponse.next({ request: { headers: requestHeaders } });
    }
    // With sign-in configured the session cookie travels same-origin to the
    // backend on its own; injecting the token here would defeat the login.
    if (!authEnabled) {
      const token = process.env.DUNE_ADMIN_TOKEN;
      if (token) requestHeaders.set('X-Admin-Token', token);
    }
    return NextResponse.next({ request: { headers: requestHeaders } });
  }

  if (!authEnabled || hasSession || PUBLIC_PAGES.some((p) => pathname.startsWith(p))) {
    return NextResponse.next({ request: { headers: requestHeaders } });
  }

  const loginUrl = new URL(LOGIN_PATH, request.url);
  if (pathname !== '/') {
    loginUrl.searchParams.set('next', `${pathname}${search}`);
  }
  return NextResponse.redirect(loginUrl);
}

export const config = {
  // Everything except Next internals and static assets.
  matcher: ['/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)'],
};
