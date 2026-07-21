import { NextRequest, NextResponse } from 'next/server';

/**
 * Injects the admin token into proxied API requests server-side.
 * This keeps the token out of the browser bundle entirely.
 */
export function middleware(request: NextRequest) {
  const token = process.env.DUNE_ADMIN_TOKEN;

  const requestHeaders = new Headers(request.headers);
  // Always strip client-supplied privileged headers to prevent escalation
  requestHeaders.delete('X-Admin-Role');
  requestHeaders.delete('X-Admin-Token');

  if (!token) {
    return NextResponse.next({ request: { headers: requestHeaders } });
  }

  requestHeaders.set('X-Admin-Token', token);

  return NextResponse.next({
    request: { headers: requestHeaders },
  });
}

export const config = {
  matcher: ['/api/:path*'],
};
