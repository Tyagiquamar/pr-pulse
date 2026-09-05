module.exports = {
  // Keep image optimization unrequirement so the project can run without a Next server when needed
  images: {
    unoptimized: true,
  },

  // Enable static export only when GH_PAGES env var is set to 'true' (used by GitHub Pages workflow)
  // This avoids forcing an export during regular deploys (e.g., Vercel) where API routes are required.
  ...(process.env.GH_PAGES === 'true'
    ? {
        basePath: '/pr-pulse',
        assetPrefix: '/pr-pulse/',
        trailingSlash: true,
        output: 'export',
      }
    : {}),
}
