/** @type {import('next').NextConfig} */
const nextConfig = {
  cacheComponents: true,
  partialPrefetching: true,
  // A stray package-lock.json in the home folder makes Next guess the wrong root.
  turbopack: { root: import.meta.dirname },
};

export default nextConfig;
