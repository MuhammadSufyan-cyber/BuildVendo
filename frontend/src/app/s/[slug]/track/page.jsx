"use client";
import { useState } from "react";
import { api, money, fmtDate } from "../../../../lib/api";
import { useStore } from "../../../../components/StoreCtx";

export default function Track() {
  const { slug, info } = useStore();
  const [number, setNumber] = useState(""); const [email, setEmail] = useState(""); const [order, setOrder] = useState(null); const [err, setErr] = useState("");
  async function find(e) {
    e.preventDefault(); setErr(""); setOrder(null);
    try { setOrder((await api(`/store/${slug}/orders/track?number=${encodeURIComponent(number.replace("#", ""))}&email=${encodeURIComponent(email)}`)).order); } catch (e2) { setErr(e2.message); }
  }
  if (!info.features.tracking) return <div className="s-wrap"><p>Order tracking is not enabled for this store.</p></div>;
  return (
    <div className="s-wrap" style={{ maxWidth: 560 }}>
      <h1>Track your order</h1>
      <form className="s-card" onSubmit={find}>
        <label className="field"><span>Order number</span><input value={number} onChange={(e) => setNumber(e.target.value)} placeholder="1001" required /></label>
        <label className="field"><span>Email used at checkout</span><input type="email" value={email} onChange={(e) => setEmail(e.target.value)} required /></label>
        {err && <p className="err">{err}</p>}
        <button className="s-btn">Track</button>
      </form>
      {order && <div className="s-card" style={{ marginTop: 16 }}>
        <h2>Order #{order.number}: {order.status}</h2>
        {order.timeline.map((t, i) => <div key={i}>● <strong>{t.status}</strong> <span className="s-muted">{fmtDate(t.at)}</span></div>)}
        <p className="s-muted">{order.lines.map((l) => `${l.qty}× ${l.title}`).join(", ")} · {money(order.total, order.currency)}</p></div>}
    </div>
  );
}
