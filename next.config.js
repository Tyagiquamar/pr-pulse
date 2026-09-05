// Prevent accidental static export on non-GitHub Actions CI (e.g., Vercel).
// During GitHub Actions runs the GH_PAGES env may be intentionally set to 'true'.
if (!process.env.GITHUB_ACTIONS) {
  process.env.GH_PAGES = 'false'
}

module.exports = {
  // Keep this config Vercel-friendly: do not force static export here.
  typescript: {
    // Keep parity with next.config.mjs
    ignoreBuildErrors: true,
  },
  images: {
    // You can enable Next.js image optimization on Vercel by setting this to false,
    // but leaving unoptimized:true is safe if you prefer not to use Next's image optimizer.
    unoptimized: true,
  },
}
