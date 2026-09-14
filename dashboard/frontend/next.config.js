const withBundleAnalyzer = require('@next/bundle-analyzer')({
  enabled: process.env.ANALYZE === 'true',
});

/** @type {import('next').NextConfig} */
const nextConfig = {
  output: 'standalone',
  // Pin the file-tracing root to this app so the standalone build is
  // deterministic and Next does not guess (and warn) when an unrelated
  // lockfile exists in a parent directory.
  outputFileTracingRoot: __dirname,
  poweredByHeader: false,
  compress: true,
  async headers() {
    // next.config headers() is static: it cannot see http vs https. HSTS is
    // applied per-request in src/proxy.ts when the request is actually TLS.
    const scriptSrc =
      process.env.NODE_ENV === 'development'
        ? "script-src 'self' 'unsafe-inline' 'unsafe-eval'"
        : "script-src 'self' 'unsafe-inline'";
    return [
      {
        source: '/(.*)',
        headers: [
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'X-Frame-Options', value: 'DENY' },
          { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
          { key: 'Cross-Origin-Opener-Policy', value: 'same-origin' },
          { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=()' },
          {
            key: 'Content-Security-Policy',
            value: [
              "default-src 'self'",
              scriptSrc,
              "style-src 'self' 'unsafe-inline'",
              "img-src 'self' data: blob:",
              "font-src 'self'",
              "connect-src 'self' https://*.tile.openstreetmap.org",
              "object-src 'none'",
              "base-uri 'self'",
              "frame-ancestors 'none'",
            ].join('; '),
          },
        ],
      },
    ];
  },
  async rewrites() {
    // Server-side only, so requests still pass through src/proxy.ts and get
    // the admin token injected. Do not expose this as NEXT_PUBLIC_*: an absolute
    // base URL used by the browser bypasses that proxy entirely.
    const apiUrl = (process.env.DUNE_DASHBOARD_API_URL || 'http://dashboard-api:8080').replace(/\/$/, '');
    return [
      {
        source: '/api/:path*',
        destination: `${apiUrl}/api/:path*`,
      },
      {
        source: '/ready',
        destination: `${apiUrl}/ready`,
      },
      {
        source: '/status',
        destination: `${apiUrl}/status`,
      },
    ];
  },
};

module.exports = withBundleAnalyzer(nextConfig);
