"use client";
import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { api } from "../../../lib/api";
import { StoreContext, useCart } from "../../../components/StoreCtx";

const FONTS = { sans: "system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif", serif: "Georgia, 'Times New Roman', serif", mono: "ui-monospace, Consolas, monospace" };
const RADIUS = { modern: "10px", classic: "4px", bold: "0px", minimal: "2px" };

export default function StoreLayout({ children }) {
  const { slug } = useParams();
  const [info, setInfo] = useState(null);
  const [err, setErr] = useState(null);
  const [customer, setCustomer] = useState(null);
  const cart = useCart(slug);
  const [onStoreHost, setOnStoreHost] = useState(false);
  useEffect(() => { setOnStoreHost(!window.location.pathname.startsWith("/s/")); }, [slug]);

  useEffect(() => {
    api(`/store/${slug}/info`).then(setInfo).catch((e) => setErr(e));
    api(`/store/${slug}/auth/me`).then((r) => setCustomer(r.customer)).catch(() => {});
  }, [slug]);

  if (err) return <div className="public"><div className="authcard" style={{ textAlign: "center" }}><h1>{err.status === 503 ? "Temporarily unavailable" : "Store not found"}</h1><p className="muted">{err.message}</p><a className="btn" href="/">Home</a></div></div>;
  if (!info) return <div className="public"><p className="muted">Loading store…</p></div>;

  const t = info.theme || {}, dark = t.mode === "dark";
  const style = {
    "--primary": t.primary || "#6b3410", "--accent": t.accent || "#f08c00", "--s-font": FONTS[t.font] || FONTS.sans, "--s-radius": RADIUS[t.style] || "10px",
    // warm cream page background (light) or warm espresso (dark)
    "--s-bg": dark ? "#1f140d" : "#fff8f1", "--s-fg": dark ? "#fbeee0" : "#2b1a10", "--s-card": dark ? "#2b1d13" : "#ffffff", "--s-line": dark ? "#43301f" : "#efdcc8",
  };
  // On a store's own address (subdomain or custom domain) links are relative to the root; on the platform host they start with /s/<id>.
  const base = onStoreHost ? "" : `/s/${slug}`;
  return (
    <StoreContext.Provider value={{ slug, info, cart, customer, setCustomer, base }}>
      <div className="store" style={style}>
        <header className="s-head"><div className="s-bar">
          <a className="s-logo" href={base}>{info.logoUrl ? <img src={info.logoUrl} alt={info.name} style={{ height: 38, maxWidth: 200, objectFit: "contain", display: "block" }} /> : info.name}</a>
          <nav className="s-nav">
            <a href={base}>Shop</a>
            {info.categories.slice(0, 4).map((c) => <a key={c.name} href={`${base}?category=${encodeURIComponent(c.name)}`}>{c.name}</a>)}
            {info.features.blog && <a href={`${base}/blog`}>Blog</a>}
            {info.features.tracking && <a href={`${base}/track`}>Track order</a>}
            {info.features.returns && <a href={`${base}/returns`}>Returns</a>}
          </nav>
          <a href={`${base}/account`}>{customer ? `Hi, ${customer.name.split(" ")[0]}` : "Sign in"}</a>
          <a href={`${base}/cart`} aria-label="Cart">🛒 Cart<span className="badge-cart">{cart.count}</span></a>
        </div></header>
        {info.customCss && <style dangerouslySetInnerHTML={{ __html: info.customCss }} />}
        {children}
        <footer className="s-foot">© {new Date().getFullYear()} {info.name}{!info.features.whiteLabel && <> · Powered by BuildVendo</>}</footer>
      </div>
    </StoreContext.Provider>
  );
}
