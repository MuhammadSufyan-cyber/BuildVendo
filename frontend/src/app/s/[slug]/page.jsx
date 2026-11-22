"use client";
import { Suspense, useState } from "react";
import { useSearchParams } from "next/navigation";
import { useApi } from "../../../components/ui";
import { useStore } from "../../../components/StoreCtx";
import ProductCard from "../../../components/ProductCard";

function Home() {
  const { slug, info, base } = useStore();
  const sp = useSearchParams();
  const category = sp.get("category") || "";
  const [q, setQ] = useState(sp.get("q") || ""); const [sort, setSort] = useState("newest");
  const qs = new URLSearchParams({ ...(category && { category }), ...(q && { q }), sort }).toString();
  const { data, loading } = useApi(`/store/${slug}/products?${qs}`);
  const home = info.pages?.home;
  const about = home?.sections?.find((s) => s.type === "about");
  return (
    <>
      {!category && !q && (
        <section className="s-hero" style={info.bannerUrl ? { backgroundImage: `linear-gradient(rgba(0,0,0,.45), rgba(0,0,0,.45)), url(${info.bannerUrl})`, backgroundSize: "cover", backgroundPosition: "center" } : undefined}>
          <h1>{home?.hero?.headline || `Welcome to ${info.name}`}</h1>
          <p>{home?.hero?.subhead || info.tagline}</p>
          <a className="s-btn" href="#products" style={{ boxShadow: "0 4px 14px rgba(0,0,0,.25)" }}>{home?.hero?.cta || "Shop now"}</a>
        </section>
      )}
      {!category && !q && info.categories.some((c) => c.image) && (
        <div className="s-wrap" style={{ paddingBottom: 0 }}>
          <h2>Shop by category</h2>
          <div className="pgrid" style={{ gridTemplateColumns: "repeat(auto-fill, minmax(170px, 1fr))" }}>
            {info.categories.filter((c) => c.image).map((c) => (
              <a key={c.name} className="pcard" href={`${base}?category=${encodeURIComponent(c.name)}#products`}>
                <div className="pimg" style={{ aspectRatio: "4 / 3" }}><img src={c.image} alt="" /></div>
                <div className="pbody" style={{ textAlign: "center", fontWeight: 700 }}>{c.name}</div>
              </a>))}
          </div>
        </div>)}
      <div className="s-wrap" id="products">
        <div style={{ marginBottom: 14 }}>
          <a className={`chip ${!category ? "on" : ""}`} href={base}>All</a>
          {info.categories.map((c) => <a key={c.name} className={`chip ${category === c.name ? "on" : ""}`} href={`${base}?category=${encodeURIComponent(c.name)}`}>{c.name} ({c.count})</a>)}
        </div>
        <div className="row" style={{ marginBottom: 18 }}>
          <input style={{ maxWidth: 280 }} placeholder="Search products…" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search products" />
          <select style={{ maxWidth: 190 }} value={sort} onChange={(e) => setSort(e.target.value)} aria-label="Sort"><option value="newest">Newest</option><option value="price_asc">Price: low to high</option><option value="price_desc">Price: high to low</option></select>
        </div>
        {loading ? <p className="s-muted">Loading…</p> : !data?.products.length ? <div className="s-card" style={{ textAlign: "center" }}>No products found.</div> : (
          <div className="pgrid">{data.products.map((p) => <ProductCard key={p.id} p={p} base={base} currency={info.currency} />)}</div>
        )}
        {!category && !q && about?.body && <section className="s-card" style={{ marginTop: 40 }}><h2>{about.title || "About us"}</h2><p>{about.body}</p></section>}
      </div>
    </>
  );
}

export default function Page() {
  return <Suspense><Home /></Suspense>;
}
