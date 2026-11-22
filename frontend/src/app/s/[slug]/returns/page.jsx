"use client";
import { useState } from "react";
import { api, money, fmtDate } from "../../../../lib/api";
import { useStore } from "../../../../components/StoreCtx";

const LABEL = { requested: "Waiting for the store", approved: "Approved. Please send the items back as the store tells you.", rejected: "Not accepted", refunded: "Refunded" };

export default function Returns() {
  const { slug, info, base } = useStore();
  const [number, setNumber] = useState(""); const [email, setEmail] = useState("");
  const [data, setData] = useState(null); const [err, setErr] = useState(""); const [busy, setBusy] = useState(false);
  const [qty, setQty] = useState({}); const [reason, setReason] = useState(""); const [done, setDone] = useState(false);
  if (!info.features.returns) return <div className="s-wrap"><p>This store does not accept online return requests.</p></div>;

  async function find(e) {
    e?.preventDefault(); setErr(""); setBusy(true); setDone(false);
    try {
      const r = await api(`/store/${slug}/returns/order?number=${encodeURIComponent(number.replace("#", ""))}&email=${encodeURIComponent(email)}`);
      setData(r); setQty(Object.fromEntries(r.order.lines.map((l) => [l.variantId, l.qty])));
    } catch (e2) { setErr(e2.message); setData(null); }
    setBusy(false);
  }
  async function submit(e) {
    e.preventDefault(); setErr(""); setBusy(true);
    const items = Object.entries(qty).filter(([, q]) => q > 0).map(([variantId, q]) => ({ variantId, qty: Number(q) }));
    try { await api(`/store/${slug}/returns`, { method: "POST", body: { number: number.replace("#", ""), email, reason, items } }); setDone(true); await find(); }
    catch (e2) { setErr(e2.message); }
    setBusy(false);
  }

  return (
    <div className="s-wrap" style={{ maxWidth: 680 }}>
      <h1>Return an order</h1>
      <p className="s-muted">Enter the order number and the email you used at checkout.</p>
      <form className="s-card" onSubmit={find}>
        <div className="grid g2">
          <label className="field"><span>Order number</span><input value={number} onChange={(e) => setNumber(e.target.value)} placeholder="1001" required /></label>
          <label className="field"><span>Email</span><input type="email" value={email} onChange={(e) => setEmail(e.target.value)} required /></label>
        </div>
        <button className="s-btn" disabled={busy}>Find my order</button>
      </form>
      {err && <p className="err" style={{ marginTop: 12 }}>{err}</p>}
      {done && <p className="good" style={{ marginTop: 12 }}>Your return request was sent. The store will email you when it is reviewed.</p>}

      {data && (
        <div className="s-card" style={{ marginTop: 16 }}>
          <h2>Order #{data.order.number}</h2>
          {data.existing && <p><strong>Return status:</strong> {LABEL[data.existing.status]}{data.existing.note && <> · {data.existing.note}</>}{data.existing.refundAmount != null && <> · Refunded {money(data.existing.refundAmount, data.order.currency)}</>}<br /><span className="s-muted small">Requested {fmtDate(data.existing.createdAt)}</span></p>}
          {!data.eligible && !data.existing && <p className="err">This order cannot be returned (only paid orders, within {data.windowDays} days).</p>}
          {data.eligible && !(data.existing && ["requested", "approved"].includes(data.existing.status)) && (
            <form onSubmit={submit}>
              <p className="s-muted">Choose what you are sending back.</p>
              {data.order.lines.map((l) => (
                <div key={l.variantId} className="row between" style={{ padding: "6px 0", borderBottom: "1px solid var(--s-line)" }}>
                  <span>{l.title}{l.variantTitle !== "Default" ? ` (${l.variantTitle})` : ""} · {money(l.unitPrice, data.order.currency)}</span>
                  <select style={{ width: 80 }} value={qty[l.variantId] ?? 0} onChange={(e) => setQty({ ...qty, [l.variantId]: Number(e.target.value) })} aria-label={`Quantity of ${l.title} to return`}>{Array.from({ length: l.qty + 1 }, (_, i) => <option key={i} value={i}>{i}</option>)}</select>
                </div>))}
              <label className="field" style={{ marginTop: 12 }}><span>Why are you returning it?</span><textarea value={reason} onChange={(e) => setReason(e.target.value)} required minLength={3} maxLength={500} /></label>
              <button className="s-btn" disabled={busy || !Object.values(qty).some((q) => q > 0)}>Send return request</button>
            </form>)}
        </div>)}
      <p style={{ marginTop: 20 }}><a href={base}>← Back to shop</a></p>
    </div>
  );
}
