"use client";
import { useState } from "react";
import { useApi, Loading, ErrorBox, Modal, act } from "../../../components/ui";
import { api, money } from "../../../lib/api";
import { useDash, Locked } from "../../../components/DashCtx";

export default function POS() {
  const { flags } = useDash();
  const { data, error, loading, reload } = useApi(flags["POS-01"] ? "/admin/products?status=active" : null);
  const [q, setQ] = useState(""); const [cart, setCart] = useState([]); const [code, setCode] = useState(""); const [receipt, setReceipt] = useState(null); const [pick, setPick] = useState(null);
  if (!flags["POS-01"]) return <Locked feature="POS-01" name="Point of sale" />;
  if (loading) return <Loading />;
  if (error) return <ErrorBox error={error} />;

  const list = data.products.filter((p) => !q || p.title.toLowerCase().includes(q.toLowerCase()));
  const add = (p, v) => { if (v.stock < 1) return; setCart((c) => { const i = c.findIndex((x) => x.variantId === v.id); if (i >= 0) { if (c[i].qty >= v.stock) return c; return c.map((x, j) => (j === i ? { ...x, qty: x.qty + 1 } : x)); } return [...c, { productId: p._id, variantId: v.id, title: p.title, vt: v.title, price: v.price, qty: 1, max: v.stock }]; }); setPick(null); };
  const total = cart.reduce((s, l) => s + l.price * l.qty, 0);

  async function pay(method) {
    const r = await act(() => api("/admin/pos/orders", { method: "POST", body: { items: cart.map((l) => ({ productId: l.productId, variantId: l.variantId, qty: l.qty })), paymentMethod: method, discountCode: code || undefined } }));
    if (r && r !== true) { setReceipt(r.order); setCart([]); setCode(""); reload(); }
  }

  return (
    <>
      <div className="page-head"><div><h1>Point of sale</h1><p className="muted">Ring up in-store sales. Stock is shared with your online store.</p></div></div>
      <div className="grid" style={{ gridTemplateColumns: "minmax(0,1.6fr) minmax(280px,1fr)" }}>
        <div>
          <input placeholder="Search products…" value={q} onChange={(e) => setQ(e.target.value)} style={{ marginBottom: 10 }} autoFocus />
          <div className="grid g3">{list.map((p) => {
            const stock = p.variants.reduce((s, v) => s + v.stock, 0);
            return <button key={p._id} className="card" style={{ textAlign: "left", cursor: stock ? "pointer" : "not-allowed", opacity: stock ? 1 : 0.5 }} disabled={!stock} onClick={() => (p.variants.length === 1 ? add(p, p.variants[0]) : setPick(p))}>
              <div style={{ fontSize: 28 }}>{p.emoji || "🛍️"}</div><strong>{p.title}</strong><div className="muted small">{money(p.price)} · {stock} in stock</div></button>;
          })}</div>
        </div>
        <div className="card" style={{ alignSelf: "start", position: "sticky", top: 16 }}>
          <h2>Current sale</h2>
          {!cart.length ? <p className="muted">Tap a product to add it.</p> : cart.map((l) => (
            <div key={l.variantId} className="row between" style={{ padding: "6px 0", borderBottom: "1px solid var(--line)" }}>
              <div>{l.title}<div className="muted small">{l.vt} · {money(l.price)}</div></div>
              <div className="row"><button className="btn ghost sm" onClick={() => setCart((c) => c.flatMap((x) => (x.variantId === l.variantId ? (x.qty > 1 ? [{ ...x, qty: x.qty - 1 }] : []) : [x])))}>−</button><strong>{l.qty}</strong>
                <button className="btn ghost sm" disabled={l.qty >= l.max} onClick={() => setCart((c) => c.map((x) => (x.variantId === l.variantId ? { ...x, qty: x.qty + 1 } : x)))}>+</button></div>
            </div>))}
          {cart.length > 0 && <>
            <input placeholder="Discount code (optional)" value={code} onChange={(e) => setCode(e.target.value)} style={{ marginTop: 10 }} />
            <div className="row between" style={{ margin: "12px 0", fontSize: "1.3rem", fontWeight: 700 }}><span>Total</span><span>{money(total)}</span></div>
            <div className="row"><button className="btn accent" style={{ flex: 1 }} onClick={() => pay("cash")}>Cash</button><button className="btn" style={{ flex: 1 }} onClick={() => pay("card")}>Card</button></div>
            <button className="btn ghost block" style={{ marginTop: 8 }} onClick={() => setCart([])}>Clear</button>
            <p className="muted small">Card is a test payment: no real charge. Connect a payment gateway to take real cards.</p></>}
        </div>
      </div>
      {pick && <Modal title={`Choose option: ${pick.title}`} onClose={() => setPick(null)}>{pick.variants.map((v) => <button key={v.id} className="btn ghost block" style={{ marginBottom: 6 }} disabled={v.stock < 1} onClick={() => add(pick, v)}>{v.title} · {money(v.price)} · {v.stock} left</button>)}</Modal>}
      {receipt && (
        <Modal title="Sale complete" onClose={() => setReceipt(null)}>
          <div style={{ fontFamily: "ui-monospace, Consolas, monospace" }} id="receipt">
            <div>Receipt #{receipt.number}</div><div className="muted">{new Date(receipt.createdAt).toLocaleString()} · cashier {receipt.cashier}</div><hr />
            {receipt.lines.map((l, i) => <div key={i} className="row between"><span>{l.qty} × {l.title} ({l.variantTitle})</span><span>{money(l.total)}</span></div>)}<hr />
            {receipt.discount > 0 && <div className="row between"><span>Discount {receipt.discountCode}</span><span>−{money(receipt.discount)}</span></div>}
            <div className="row between"><strong>Total</strong><strong>{money(receipt.total)}</strong></div><div>Paid by {receipt.payments[0].method}</div>
          </div>
          <div className="row end" style={{ marginTop: 12 }}><button className="btn ghost" onClick={() => window.print()}>Print</button><button className="btn" onClick={() => setReceipt(null)}>New sale</button></div>
        </Modal>)}
    </>
  );
}
