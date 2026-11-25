import { describe, it, expect } from "vitest";
import {
  buildContentSecurityPolicy,
  buildSecurityHeaders,
} from "@/lib/security-headers";
import nextConfig from "../../../next.config";

describe("HTTP security headers (#15)", () => {
  it("sets required hardening headers for production", () => {
    const headers = buildSecurityHeaders({ isDev: false });
    const map = new Map(headers.map((h) => [h.key, h.value]));

    expect(map.get("X-Content-Type-Options")).toBe("nosniff");
    expect(map.get("X-Frame-Options")).toBe("DENY");
    expect(map.get("Referrer-Policy")).toBe("no-referrer");
    expect(map.get("Permissions-Policy")).toContain("camera=()");

    const csp = map.get("Content-Security-Policy") ?? "";
    expect(csp).toContain("default-src 'self'");
    expect(csp).toContain("style-src 'self' 'unsafe-inline'");
    expect(csp).toContain("img-src 'self' data: blob: https:");
    expect(csp).toContain("font-src 'self' data:");
    expect(csp).toContain("object-src 'none'");
    expect(csp).toContain("frame-src 'none'");
    expect(csp).toContain("frame-ancestors 'none'");
    expect(csp).not.toContain("'unsafe-eval'");
    expect(csp).not.toContain("ws:");
  });

  it("allows dev-only directives only when isDev is true", () => {
    const devCsp = buildContentSecurityPolicy({ isDev: true });
    expect(devCsp).toContain("'unsafe-eval'");
    expect(devCsp).toContain("ws: wss:");
  });

  it("wires security headers into next.config.ts for all routes", async () => {
    expect(typeof nextConfig.headers).toBe("function");
    const entries = await nextConfig.headers!();
    expect(entries).toHaveLength(1);
    expect(entries[0].source).toBe("/(.*)");

    const headerMap = new Map(entries[0].headers.map((h) => [h.key, h.value]));
    expect(headerMap.get("X-Content-Type-Options")).toBe("nosniff");
    expect(headerMap.get("X-Frame-Options")).toBe("DENY");
    expect(headerMap.get("Referrer-Policy")).toBe("no-referrer");
    expect(headerMap.get("Content-Security-Policy")).toContain(
      "frame-ancestors 'none'"
    );
  });
});
