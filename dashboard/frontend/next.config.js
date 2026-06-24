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
  async rewrites() {
    return [
      {
        source: '/api/:path*',
        destination: 'http://dashboard-api:8080/api/:path*',
      },
      {
        source: '/ready',
        destination: 'http://dashboard-api:8080/ready',
      },
      {
        source: '/status',
        destination: 'http://dashboard-api:8080/status',
      },
    ];
  },
};

module.exports = withBundleAnalyzer(nextConfig);
