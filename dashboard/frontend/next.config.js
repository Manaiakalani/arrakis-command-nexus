/** @type {import('next').NextConfig} */
const nextConfig = {
  output: 'standalone',
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

module.exports = nextConfig;
