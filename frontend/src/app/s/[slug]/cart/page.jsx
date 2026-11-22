"use client";
import { useEffect, useState } from "react";
import { api, money } from "../../../../lib/api";
import { useStore } from "../../../../components/StoreCtx";

export default function CartPage() {
  const { slug, info, cart, base } = useStore();
  const [quote, setQuote] = useState(null); const [err, setErr] = useState(""); const [code, setCode] = useState(""); const [applied, setApplied] = useState("");
  const body = (c) => ({ items: cart.items.map((i) => ({ productId: i.productId, variantId: i.variantId, qty: i.qty })), ...(c ? { code: c } : {}) });

  useEffect(() => {
    if (!cart.items.length) { setQuote(null); return; }
    api(`/store/${slug}/cart/quote`, { method: "POST", body: body(applied) }).then((q) => { setQuote(q); setErr(""); }).catch((e) => { setErr(e.message); setQuote(null); });
  }, [cart.items, applied]); // eslint-disable-line react-hooks/exhaustive-deps

  async function apply(e) {
    e.preventDefault(); setErr("");
    try { await api(`/store/${slug}/cart/quote`, { method: "POST", body: body(code) }); setApplied(code.trim()); } catch (e2) { setErr(e2.message); }
  }

  if (!cart.items.length) return <div className="s-wrap"><h1>Your cart</h1><div className="s-card" style={{ textAlign: "center" }}><p>Your cart is empty.</p><a className="s-btn" href={base}>Continue shopping</a></div></div>;
  return (
    <div className="s-wrap">
      <h1>Your cart</h1>
      {err && <p className="err">{err}</p>}
      <div className="two">
        <div className="s-card">
          {cart.items.map((i) => (
            <div key={i.variantId} className="row between" style={{ padding: "10px 0", borderBottom: "1px solid var(--s-line)" }}>
              <div style={{ display: "flex", gap: 12, alignItems: "center" }}><span style={{ fontSize: 34 }}>{i.emoji || "🛍️"}</span><div><strong>{i.title}</strong><div className="s-muted small">{i.vt !== "Default" && i.vt}</div></div></div>
              <div className="row">
                <button className="s-btn ghost" onClick={() => cart.setQty(i.variantId, i.qty - 1)} aria-label="Decrease">−</button><strong>{i.qty}</strong><button className="s-btn ghost" onClick={() => cart.setQty(i.variantId, i.qty + 1)} aria-label="Increase">+</button>
                <button className="s-btn ghost" onClick={() => cart.setQty(i.variantId, 0)} aria-label="Remove">✕</button>
              </div>
            </div>))}
        </div>
        <div className="s-card">
          <h2>Summary</h2>
          {quote && <>
            <div className="row between"><span>Subtotal</span><span>{money(quote.subtotal, quote.currency)}</span></div>
            {quote.discount > 0 && <div className="row between"><span>Discount ({quote.discountCode})</span><span>−{money(quote.discount, quote.currency)}</span></div>}
            <div className="row between"><span>Shipping</span><span>{quote.shipping ? money(quote.shipping, quote.currency) : "Free"}</span></div>
            {quote.tax > 0 && <div className="row between"><span>Tax</span><span>{money(quote.tax, quote.currency)}</span></div>}
            <div className="row between" style={{ fontSize: "1.25rem", fontWeight: 800, marginTop: 8 }}><span>Total</span><span>{money(quote.total, quote.currency)}</span></div></>}
          {info.features.discounts && <form className="row" onSubmit={apply} style={{ margin: "14px 0" }}><input placeholder="Discount code" value={code} onChange={(e) => setCode(e.target.value)} style={{ flex: 1 }} /><button className="s-btn ghost">Apply</button></form>}
          <a className="s-btn block" style={{ display: "block", textAlign: "center" }} href={`${base}/checkout${applied ? `?code=${encodeURIComponent(applied)}` : ""}`}>Checkout</a>
        </div>
      </div>
    </div>
  );
}
