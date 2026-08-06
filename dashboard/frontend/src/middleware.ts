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
 *
 * Page routes are gated on a session the *backend* has confirmed. Checking only
 * that a `dune_session` cookie exists would be worthless: the token is opaque,
 * so any random value would pass, and Server Components then fetch privileged
 * data with the machine token via `lib/server-api.ts`.
 */

const LOGIN_PATH = '/login';

const API_ORIGIN = process.env.DUNE_DASHBOARD_API_URL || 'http://dashboard-api:8080';

// Paths that must stay reachable without a session.
const PUBLIC_PAGES = ['/login', '/public'];
const PUBLIC_API = [
  '/api/v1/auth/status',
  '/api/auth/status',
  '/api/v1/auth/login',
  '/api/auth/login',
  '/api/v1/auth/session-check',
  '/api/auth/session-check',
];

interface SessionCheck {
  authEnabled: boolean;
  authenticated: boolean;
}

// Only the "sign-in is off" answer is cached, and only briefly. Caching it for
// long enough to be useful is exactly what would leave a window after first-run
// setup where the middleware still injects the machine token (#52 bootstrap).
const NEGATIVE_TTL_MS = 3_000;

let sawAuthEnabled = false;
let cachedDisabledAt = 0;

async function sessionCheck(request: NextRequest): Promise<SessionCheck> {
  const cookie = request.headers.get('cookie');

  // Fast path: sign-in is known to be off and nothing has changed recently.
  // A caller with no cookie cannot be authenticated, so skip the round trip.
  if (!sawAuthEnabled && !cookie && Date.now() - cachedDisabledAt < NEGATIVE_TTL_MS) {
    return { authEnabled: false, authenticated: false };
  }

  try {
    const res = await fetch(`${API_ORIGIN}/api/v1/auth/session-check`, {
      headers: cookie ? { accept: 'application/json', cookie } : { accept: 'application/json' },
      cache: 'no-store',
      signal: AbortSignal.timeout(3000),
    });
    if (!res.ok) throw new Error(`status ${res.status}`);
    const body = (await res.json()) as Partial<SessionCheck>;
    const authEnabled = body.authEnabled === true;
    if (authEnabled) {
      // Never revert within this worker: an attacker who can disrupt the check
      // should not be able to talk us back into unauthenticated access.
      sawAuthEnabled = true;
    } else {
      cachedDisabledAt = Date.now();
    }
    return { authEnabled: authEnabled || sawAuthEnabled, authenticated: body.authenticated === true };
  } catch {
    // We could not find out. Fail closed.
    //
    // Falling back to the legacy token path here would be a silent privilege
    // grant: `sawAuthEnabled` is per-worker module state, so a freshly spawned
    // or recycled worker starts with no memory of sign-in being enabled, and
    // any transient failure of this call would hand out DUNE_ADMIN_TOKEN as
    // operator. Refusing instead degrades a broken backend into a login page,
    // which is recoverable; the alternative is not.
    return { authEnabled: true, authenticated: false };
  }
}

export async function middleware(request: NextRequest) {
  const { pathname, search } = request.nextUrl;
  const requestHeaders = new Headers(request.headers);

  // Always strip client-supplied privileged headers to prevent escalation.
  requestHeaders.delete('X-Admin-Role');
  requestHeaders.delete('X-Admin-Token');

  const isPublicApi = pathname.startsWith('/api') && PUBLIC_API.includes(pathname);
  const isPublicPage = !pathname.startsWith('/api') && PUBLIC_PAGES.some((p) => pathname.startsWith(p));

  if (isPublicApi) {
    return NextResponse.next({ request: { headers: requestHeaders } });
  }

  const { authEnabled, authenticated } = await sessionCheck(request);

  if (pathname.startsWith('/api')) {
    // With sign-in configured the session cookie travels same-origin to the
    // backend on its own; injecting the token here would defeat the login.
    if (!authEnabled) {
      const token = process.env.DUNE_ADMIN_TOKEN;
      if (token) requestHeaders.set('X-Admin-Token', token);
    }
    return NextResponse.next({ request: { headers: requestHeaders } });
  }

  if (!authEnabled || authenticated || isPublicPage) {
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
