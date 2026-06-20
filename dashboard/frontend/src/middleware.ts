import { NextRequest, NextResponse } from 'next/server';

/**
 * Injects the admin token into proxied API requests server-side.
 * This keeps the token out of the browser bundle entirely.
 */
export function middleware(request: NextRequest) {
  const token = process.env.DUNE_ADMIN_TOKEN;
  if (!token) {
    return NextResponse.next();
  }

  const requestHeaders = new Headers(request.headers);
  if (!requestHeaders.has('X-Admin-Token')) {
    requestHeaders.set('X-Admin-Token', token);
  }

  return NextResponse.next({
    request: { headers: requestHeaders },
  });
}

export const config = {
  matcher: ['/api/:path*'],
};
