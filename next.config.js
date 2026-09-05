module.exports = {
  // If hosting at https://<user>.github.io/pr-pulse set basePath and assetPrefix
  // Adjust or remove these if you use a custom domain or user/organization site.
  basePath: '/pr-pulse',
  assetPrefix: '/pr-pulse/',
  trailingSlash: true,
  // Prevent Next.js image optimization from requiring a server at runtime
  images: {
    unoptimized: true,
  },
  // Ensure static export output when possible
  output: 'export'
};
