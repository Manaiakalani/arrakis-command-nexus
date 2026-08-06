/**
 * SSE proxy route — injects the admin token server-side so the browser
 * never needs to know it. The frontend connects to /api/events/stream
 * with no auth; this route proxies to the backend SSE endpoint with the
 * token injected from the server environment.
 *
 * Security note: this endpoint relies on the same trust boundary as all
 * other /api/* routes — the dashboard is deployed on a private LAN.
 * If the dashboard is ever exposed publicly, add session auth here.
 */
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  const token = process.env.DUNE_ADMIN_TOKEN;
  // Match the rewrite destination in next.config.js
  const backendUrl = process.env.BACKEND_URL ?? 'http://dashboard-api:8080';

  if (!token) {
    return new Response(
      'event: error\ndata: {"message":"SSE not configured"}\n\n',
      {
        status: 200,
        headers: sseHeaders(),
      },
    );
  }

  const upstream = `${backendUrl}/api/events/stream?token=${encodeURIComponent(token)}`;

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
      return new Response(
        `event: error\ndata: {"message":"Upstream unavailable"}\n\n`,
        { status: 200, headers: sseHeaders() },
      );
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
    return new Response(
      'event: error\ndata: {"message":"Connection failed"}\n\n',
      { status: 200, headers: sseHeaders() },
    );
  }
}

function sseHeaders() {
  return new Headers({
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache, no-store, must-revalidate',
    'Connection': 'keep-alive',
  });
}
