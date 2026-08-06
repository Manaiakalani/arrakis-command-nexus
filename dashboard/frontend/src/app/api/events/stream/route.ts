/**
 * SSE proxy route — injects the admin token server-side so the browser
 * never needs to know it. The frontend connects to /api/events/stream
 * with no auth; this route proxies to the backend SSE endpoint with the
 * token injected from the server environment.
 *
 * Because this is a real route handler it shadows the /api/* rewrite in
 * next.config.js, so the backend's auth middleware never sees the browser's
 * request. Once sign-in is configured (#52) that would let any unauthenticated
 * visitor read the live event feed, so we validate the caller's session here
 * before borrowing the machine token.
 */
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const BACKEND_URL = process.env.BACKEND_URL ?? process.env.DUNE_DASHBOARD_API_URL ?? 'http://dashboard-api:8080';

/**
 * Ask the backend whether sign-in is configured and whether this caller's
 * cookie maps to a live session. Mirrors the anti-downgrade behaviour in
 * src/middleware.ts: once sign-in has been observed as enabled we never fall
 * back to serving the stream unauthenticated.
 */
let sawAuthEnabled = false;

async function isAllowed(request: Request): Promise<boolean> {
  const cookie = request.headers.get('cookie');
  try {
    const res = await fetch(`${BACKEND_URL}/api/v1/auth/session-check`, {
      headers: cookie ? { accept: 'application/json', cookie } : { accept: 'application/json' },
      cache: 'no-store',
      signal: AbortSignal.timeout(3000),
    });
    if (!res.ok) throw new Error(`status ${res.status}`);
    const body = (await res.json()) as { authEnabled?: boolean; authenticated?: boolean };
    if (body.authEnabled === true) sawAuthEnabled = true;
    return sawAuthEnabled ? body.authenticated === true : true;
  } catch {
    // Unknown state: only allow through if sign-in has never been seen enabled.
    return !sawAuthEnabled;
  }
}

export async function GET(request: Request) {
  const token = process.env.DUNE_ADMIN_TOKEN;

  if (!token) {
    return sseError('SSE not configured');
  }

  if (!(await isAllowed(request))) {
    return sseError('Not signed in', 401);
  }

  const upstream = `${BACKEND_URL}/api/events/stream?token=${encodeURIComponent(token)}`;

  // Abort upstream when client disconnects
  const abort = new AbortController();
  request.signal.addEventListener('abort', () => abort.abort());

  try {
    const response = await fetch(upstream, {
      headers: { Accept: 'text/event-stream' },
      signal: abort.signal,
      cache: 'no-store',
    });

    if (!response.ok || !response.body) {
      return sseError('Upstream unavailable');
    }

    return new Response(response.body, {
      status: 200,
      headers: {
        ...Object.fromEntries(sseHeaders().entries()),
        'X-Accel-Buffering': 'no',
      },
    });
  } catch {
    // Never leak internal URLs or tokens in error messages
    return sseError('Connection failed');
  }
}

function sseError(message: string, status = 200) {
  return new Response(`event: error\ndata: ${JSON.stringify({ message })}\n\n`, {
    status,
    headers: sseHeaders(),
  });
}

function sseHeaders() {
  return new Headers({
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache, no-store, must-revalidate',
    'Connection': 'keep-alive',
  });
}
