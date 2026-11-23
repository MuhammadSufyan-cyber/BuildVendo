"use client";
import { useState } from "react";
import { useApi, Modal, Field, StatusBadge, Loading, ErrorBox, Empty, Badge, act } from "../../../components/ui";
import { api, money, fmtDate } from "../../../lib/api";
import { useDash } from "../../../components/DashCtx";

const FLOW = { pending: ["paid", "cancelled"], paid: ["fulfilled", "cancelled", "refunded"], fulfilled: ["refunded"], cancelled: [], refunded: [] };
const LABEL = { paid: "Mark as paid", fulfilled: "Mark as fulfilled", cancelled: "Cancel order", refunded: "Refund" };

export default function Orders() {
  const { can, flags } = useDash();
  const [status, setStatus] = useState(""); const [channel, setChannel] = useState("");
  const qs = new URLSearchParams({ ...(status && { status }), ...(channel && { channel }) }).toString();
  const { data, error, loading, reload } = useApi(`/admin/orders?${qs}`);
  const [open, setOpen] = useState(null);
  const manage = can("orders.refund") || can("*");
  return (
    <>
      <div className="page-head"><div><h1>Orders</h1><p className="muted">Web and point-of-sale orders.</p></div></div>
      <div className="row" style={{ marginBottom: 12 }}>
        <select style={{ maxWidth: 170 }} value={status} onChange={(e) => setStatus(e.target.value)}><option value="">All statuses</option>{Object.keys(FLOW).map((s) => <option key={s}>{s}</option>)}</select>
        <select style={{ maxWidth: 170 }} value={channel} onChange={(e) => setChannel(e.target.value)}><option value="">All channels</option><option value="web">Web</option><option value="pos">POS</option></select>
      </div>
      {loading ? <Loading /> : error ? <ErrorBox error={error} /> : !data.orders.length ? <Empty>No orders match.</Empty> : (
        <div className="tablewrap"><table>
          <thead><tr><th>Order</th><th>Date</th><th>Customer</th><th>Channel</th><th>Status</th><th>Payment</th><th className="num">Total</th></tr></thead>
          <tbody>{data.orders.map((o) => (
            <tr key={o._id} className="clickable" onClick={() => setOpen(o)}>
              <td><strong>#{o.number}</strong></td><td>{fmtDate(o.createdAt)}</td><td>{o.customer?.name || o.customer?.email || "-"}</td><td><Badge tone={o.channel === "pos" ? "blue" : "gray"}>{o.channel}</Badge></td>
              <td><StatusBadge status={o.status} /></td><td>{o.payments?.[0]?.method} · {o.payments?.[0]?.status}</td><td className="num">{money(o.total, o.currency)}</td></tr>))}</tbody>
        </table></div>
      )}
      {open && <Detail o={open} manage={manage} refundOn={flags["ORD-02"]} role={can} onClose={() => setOpen(null)} onChanged={() => { setOpen(null); reload(); }} />}
    </>
  );
}

function Detail({ o, manage, refundOn, role, onClose, onChanged }) {
  const [restock, setRestock] = useState(true); const [note, setNote] = useState("");
  const move = (to) => act(async () => { await api(`/admin/orders/${o._id}/status`, { method: "POST", body: { status: to, note: note || undefined, restock: to === "refunded" ? restock : undefined } }); onChanged(); }, `Order ${to}`);
  const allowed = FLOW[o.status].filter((s) => (s === "refunded" ? manage && refundOn : manage || s !== "cancelled" || role("orders.refund")));
  const canChange = manage || role("products.write");
  return (
    <Modal title={`Order #${o.number}`} onClose={onClose} wide>
      <div className="row between"><StatusBadge status={o.status} /><span className="muted">{fmtDate(o.createdAt)} · {o.channel}</span></div>
      <p><strong>{o.customer?.name}</strong> {o.customer?.email && `· ${o.customer.email}`}{o.shippingAddress && <><br /><span className="muted">{o.shippingAddress.line1}, {o.shippingAddress.city}, {o.shippingAddress.country}</span></>}</p>
      <div className="tablewrap"><table>
        <thead><tr><th>Item</th><th className="num">Price</th><th className="num">Qty</th><th className="num">Total</th></tr></thead>
        <tbody>{o.lines.map((l, i) => <tr key={i}><td>{l.title} <span className="muted">({l.variantTitle})</span></td><td className="num">{money(l.unitPrice, o.currency)}</td><td className="num">{l.qty}</td><td className="num">{money(l.total, o.currency)}</td></tr>)}</tbody>
      </table></div>
      <div style={{ textAlign: "right", margin: "10px 0" }}>
        <div className="muted">Subtotal {money(o.subtotal, o.currency)}{o.discount ? ` · discount −${money(o.discount, o.currency)} (${o.discountCode})` : ""} · shipping {money(o.shipping, o.currency)} · tax {money(o.tax, o.currency)}</div>
        <div style={{ fontSize: "1.2rem", fontWeight: 700 }}>Total {money(o.total, o.currency)}</div>
        <div className="muted small">{o.payments?.[0]?.method} · {o.payments?.[0]?.status}{o.payments?.[0]?.note && ` · ${o.payments[0].note}`}</div>
      </div>
      <h3>Timeline</h3>
      {o.timeline.map((t, i) => <div key={i} className="small"><StatusBadge status={t.status} /> {fmtDate(t.at)} {t.note && `· ${t.note}`} {t.by && `· ${t.by}`}</div>)}
      {canChange && allowed.length > 0 && (
        <div className="card" style={{ marginTop: 14, background: "var(--panel-2)" }}>
          <Field label="Note (optional)"><input value={note} onChange={(e) => setNote(e.target.value)} /></Field>
          {allowed.includes("refunded") && <label className="chk"><input type="checkbox" checked={restock} onChange={(e) => setRestock(e.target.checked)} /> Return items to stock when refunding</label>}
          <div className="row">{allowed.map((s) => <button key={s} className={`btn ${s === "cancelled" || s === "refunded" ? "ghost" : ""}`} onClick={() => move(s)}>{LABEL[s]}</button>)}</div>
        </div>
      )}
      {o.status === "paid" && !refundOn && manage && <p className="muted small">Refunds are not included in your package.</p>}
    </Modal>
  );
}
