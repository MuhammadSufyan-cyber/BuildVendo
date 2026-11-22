"use client";
import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { api, money, fmtDate } from "../../../../../lib/api";
import { useApi, notify, act } from "../../../../../components/ui";
import { useStore } from "../../../../../components/StoreCtx";

export default function ProductPage() {
  const { ps } = useParams();
  const { slug, info, cart, customer, base } = useStore();
  const { data, error, loading, reload } = useApi(`/store/${slug}/products/${ps}`);
  const [vid, setVid] = useState(null); const [qty, setQty] = useState(1); const [shot, setShot] = useState(0);
  const [wished, setWished] = useState(false); const [rate, setRate] = useState(5); const [text, setText] = useState("");

  useEffect(() => { if (data && !vid) setVid((data.product.variants.find((v) => v.inStock) || data.product.variants[0]).id); }, [data, vid]);
  useEffect(() => { if (info.features.wishlist && customer && data) api(`/store/${slug}/wishlist`).then((r) => setWished(r.ids.includes(data.product.id))).catch(() => {}); }, [customer, data, info, slug]);

  if (loading) return <div className="s-wrap">Loading…</div>;
  if (error) return <div className="s-wrap"><p className="err">{error.message}</p><a href={base}>Back to shop</a></div>;
  const p = data.product, v = p.variants.find((x) => x.id === vid) || p.variants[0];
  const avg = data.reviews.length ? (data.reviews.reduce((s, r) => s + r.rating, 0) / data.reviews.length).toFixed(1) : null;

  function addToCart() {
    cart.add({ productId: p.id, variantId: v.id, qty, title: p.title, vt: v.title, emoji: p.emoji });
    notify(`${p.title} added to your cart`);
  }
  const toggleWish = () => act(async () => { const r = await api(`/store/${slug}/wishlist`, { method: "POST", body: { productId: p.id } }); setWished(r.wished); });
  const review = async (e) => { e.preventDefault(); if (await act(() => api(`/store/${slug}/products/${ps}/reviews`, { method: "POST", body: { rating: rate, text } }), "Thanks for your review!")) { setText(""); reload(); } };

  return (
    <div className="s-wrap">
      <p className="small"><a href={base}>← Back to shop</a></p>
      <div className="two">
        <div>
          <div className="pimg s-card" style={{ aspectRatio: "1/1", fontSize: 140, padding: 0, overflow: "hidden" }}>{p.images?.[shot] ? <img src={p.images[shot]} alt={p.title} style={{ width: "100%", height: "100%", objectFit: "cover" }} /> : p.emoji || "🛍️"}</div>
          {p.images?.length > 1 && (
            <div className="row" style={{ marginTop: 10 }}>{p.images.map((u, i) => (
              <button key={u} type="button" aria-label={`Photo ${i + 1}`} onClick={() => setShot(i)} style={{ padding: 0, border: i === shot ? "2px solid var(--accent)" : "1px solid var(--s-line)", borderRadius: 8, overflow: "hidden", width: 64, height: 64, cursor: "pointer", background: "none" }}><img src={u} alt="" style={{ width: "100%", height: "100%", objectFit: "cover" }} /></button>))}</div>)}
        </div>
        <div>
          <div className="s-muted">{p.category}</div>
          <h1 style={{ margin: "2px 0 6px" }}>{p.title}</h1>
          {avg && <div>⭐ {avg} <span className="s-muted">({data.reviews.length} reviews)</span></div>}
          <div style={{ fontSize: "1.7rem", fontWeight: 800, margin: "8px 0" }}>{money(v.price, info.currency)}</div>
          <p>{p.description}</p>
          {p.variants.length > 1 && <div style={{ margin: "10px 0" }}><div className="small s-muted" style={{ marginBottom: 4 }}>Option</div>{p.variants.map((x) => <button key={x.id} className={`opt ${x.id === vid ? "on" : ""}`} disabled={!x.inStock} onClick={() => setVid(x.id)}>{x.title}</button>)}</div>}
          <div className="row" style={{ margin: "14px 0" }}>
            <input type="number" min="1" max={Math.max(1, v.stock)} value={qty} onChange={(e) => setQty(Math.max(1, Math.min(v.stock || 1, Number(e.target.value) || 1)))} style={{ width: 80 }} aria-label="Quantity" />
            <button className="s-btn" disabled={!v.inStock} onClick={addToCart}>{v.inStock ? "Add to cart" : "Sold out"}</button>
            {info.features.wishlist && <button className="s-btn ghost" onClick={() => (customer ? toggleWish() : (window.location.href = `${base}/account`))}>{wished ? "♥ Saved" : "♡ Wishlist"}</button>}
          </div>
          {v.inStock && v.stock <= 5 && <p style={{ color: "var(--accent)", fontWeight: 600 }}>Only {v.stock} left</p>}
        </div>
      </div>
      {info.features.reviews && (
        <section style={{ marginTop: 36 }}><h2>Reviews</h2>
          {!data.reviews.length ? <p className="s-muted">No reviews yet.</p> : data.reviews.map((r, i) => <div key={i} className="s-card" style={{ marginBottom: 10 }}><strong>{r.name}</strong> {"⭐".repeat(r.rating)}<div>{r.text}</div><small className="s-muted">{fmtDate(r.at)}</small></div>)}
          {customer ? (
            <form className="s-card" onSubmit={review} style={{ marginTop: 12 }}><h3>Write a review</h3>
              <select value={rate} onChange={(e) => setRate(Number(e.target.value))} style={{ maxWidth: 140, marginBottom: 8 }}>{[5, 4, 3, 2, 1].map((n) => <option key={n} value={n}>{n} stars</option>)}</select>
              <textarea value={text} onChange={(e) => setText(e.target.value)} maxLength={1000} placeholder="What did you think?" /><button className="s-btn" style={{ marginTop: 8 }}>Submit review</button></form>
          ) : <p className="s-muted"><a href={`${base}/account`}>Sign in</a> to write a review.</p>}
        </section>)}
    </div>
  );
}
