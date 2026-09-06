const profile = process.env.VITE_DEPLOYMENT_ENVIRONMENT ?? "hosted-acceptance";
if (!new Set(["hosted-acceptance", "production"]).has(profile)) {
  throw new Error("Web deployment configuration is invalid.");
}

const production = profile === "production";
const apiOrigin = production ? "https://api.seen-said.cn" : "https://api.acceptance.seen-said.cn";
const supabaseOrigin = production
  ? "https://pxqqgxfumovegbcxnmzb.supabase.co"
  : "https://kpadiulxkgckskcfydry.supabase.co";
if (process.env.VITE_API_ORIGIN !== undefined && process.env.VITE_API_ORIGIN !== apiOrigin) {
  throw new Error("Web deployment configuration is invalid.");
}

export const config = {
  framework: "vite",
  buildCommand: "pnpm build:vercel",
  git: { deploymentEnabled: false },
  headers: [
    {
      source: "/(.*)",
      headers: [
        {
          key: "Content-Security-Policy",
          value: [
            "default-src 'self'",
            "base-uri 'none'",
            "object-src 'none'",
            "frame-ancestors 'none'",
            "frame-src 'none'",
            "worker-src 'none'",
            "script-src 'self'",
            "style-src 'self'",
            "font-src 'self'",
            "img-src 'self' data:",
            `connect-src 'self' ${apiOrigin}`,
            `form-action 'self' ${apiOrigin} ${supabaseOrigin}${production ? "" : " https://accounts.google.com"}`,
            "manifest-src 'self'",
            "upgrade-insecure-requests",
          ].join("; "),
        },
        { key: "Referrer-Policy", value: "no-referrer" },
        { key: "X-Content-Type-Options", value: "nosniff" },
        { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
      ],
    },
  ],
  outputDirectory: "dist",
  rewrites: [{ source: "/(.*)", destination: "/index.html" }],
};
