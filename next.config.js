/** @type {import('next').NextConfig} */
module.exports = {
  reactStrictMode: true,
  poweredByHeader: false,
  // firebase-admin uses Node APIs; keep it out of the bundle.
  experimental: { serverComponentsExternalPackages: ['firebase-admin'] },
};
