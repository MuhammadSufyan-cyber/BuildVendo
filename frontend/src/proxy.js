import { NextResponse } from "next/server";

// Host-based routing: shop.example.com (a verified custom domain) or my-store.<ROOT_DOMAIN> opens that store's storefront.
// The platform's own host (ROOT_DOMAIN, default "localhost") is never rewritten.
const ROOT = (process.env.ROOT_DOMAIN || "localhost").toLowerCase();
const BACKEND = process.env.BACKEND_URL || "http://localhost:5000";
const cache = new Map(); // host -> { slug, at }

async function resolveHost(host) {
  const hit = cache.get(host);
  if (hit && Date.now() - hit.at < 30_000) return hit.slug;
  let slug = null;
  try {
    const r = await fetch(`${BACKEND}/api/public/resolve-host?host=${encodeURIComponent(host)}`, { cache: "no-store" });
    if (r.ok) slug = (await r.json()).slug || null;
  } catch { /* backend unreachable: treat as the platform host */ }
  cache.set(host, { slug, at: Date.now() });
  return slug;
}

export async function proxy(request) {
  const host = (request.headers.get("host") || "").toLowerCase().replace(/:\d+$/, "");
  const { pathname } = request.nextUrl;
  if (!host || host === ROOT || host === `www.${ROOT}` || host === "127.0.0.1") return NextResponse.next();
  if (pathname.startsWith("/api") || pathname.startsWith("/_next") || pathname.startsWith("/uploads") || pathname.startsWith("/s/")) return NextResponse.next();
  const slug = await resolveHost(host);
  if (!slug) return NextResponse.next();
  const url = request.nextUrl.clone();
  url.pathname = `/s/${slug}${pathname === "/" ? "" : pathname}`;
  return NextResponse.rewrite(url);
}

export const config = { matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"] };
