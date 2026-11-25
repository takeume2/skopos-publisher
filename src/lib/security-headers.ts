export interface SecurityHeaderEntry {
  key: string;
  value: string;
}

export interface BuildSecurityHeadersOptions {
  isDev?: boolean;
}

/**
 * Builds Content-Security-Policy compatible with Next.js App Router, Paged.js
 * (dynamic <style> injection, data:/blob: assets), and KaTeX (bundled fonts & inline styles).
 */
export function buildContentSecurityPolicy(
  options: BuildSecurityHeadersOptions = {}
): string {
  const isDev = Boolean(options.isDev);
  return [
    "default-src 'self'",
    `script-src 'self' 'unsafe-inline'${isDev ? " 'unsafe-eval'" : ""}`,
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob: https:",
    "font-src 'self' data:",
    `connect-src 'self'${isDev ? " ws: wss:" : ""}`,
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-src 'none'",
    "frame-ancestors 'none'",
  ].join("; ");
}

export function buildSecurityHeaders(
  options: BuildSecurityHeadersOptions = {}
): SecurityHeaderEntry[] {
  return [
    {
      key: "Content-Security-Policy",
      value: buildContentSecurityPolicy(options),
    },
    {
      key: "X-Content-Type-Options",
      value: "nosniff",
    },
    {
      key: "X-Frame-Options",
      value: "DENY",
    },
    {
      key: "Referrer-Policy",
      value: "no-referrer",
    },
    {
      key: "Permissions-Policy",
      value: "camera=(), microphone=(), geolocation=()",
    },
  ];
}
