"use client";
import { useState } from "react";
import { useApi, Modal, Field, Badge, Loading, ErrorBox, Empty, act } from "../../../components/ui";
import { api, money, fmtDate } from "../../../lib/api";
import { useDash, Locked } from "../../../components/DashCtx";

const TONE = { requested: "amber", approved: "blue", rejected: "red", refunded: "green" };

export default function Returns() {
  const { flags } = useDash();
  const on = !!flags["ORD-03"];
  const [status, setStatus] = useState("requested");
  const { data, error, loading, reload } = useApi(on ? `/admin/returns?status=${status}` : null);
  const [open, setOpen] = useState(null); const [reason, setReason] = useState(""); const [amount, setAmount] = useState(""); const [restock, setRestock] = useState(true);
  if (!on) return <Locked feature="ORD-03" name="Returns portal" />;
  const run = (kind, body) => act(async () => { const r = await api(`/admin/returns/${open._id}/${kind}`, { method: "POST", body }); setOpen(null); setReason(""); setAmount(""); reload(); return r; },
    { approve: "Return approved. The customer was told.", reject: "Return rejected.", refund: "Refund recorded." }[kind]);
  const total = open ? open.items.reduce((s, i) => s + i.unitPrice * i.qty, 0) : 0;
  return (
    <>
      <div className="page-head"><div><h1>Returns</h1><p className="muted">Customers ask to send items back here. You approve, then refund. Orders can be returned within 30 days.</p></div></div>
      <div className="row" style={{ marginBottom: 12 }}>
        {["requested", "approved", "refunded", "rejected"].map((s) => <button key={s} className={`btn ${status === s ? "" : "ghost"} sm`} onClick={() => setStatus(s)}>{s}{data ? ` (${data.counts[s]})` : ""}</button>)}
      </div>
      {loading ? <Loading /> : error ? <ErrorBox error={error} /> : !data.returns.length ? <Empty>No {status} returns.</Empty> : (
        <div className="tablewrap"><table>
          <thead><tr><th>Order</th><th>Customer</th><th>Items</th><th>Reason</th><th>Requested</th><th>Status</th><th></th></tr></thead>
          <tbody>{data.returns.map((r) => (
            <tr key={r._id}><td><strong>#{r.orderNumber}</strong></td><td>{r.customerName}<div className="muted small">{r.customerEmail}</div></td><td>{r.items.map((i) => `${i.qty}× ${i.title}`).join(", ")}</td><td>{r.reason}</td><td>{fmtDate(r.createdAt)}</td>
              <td><Badge tone={TONE[r.status]}>{r.status}</Badge>{r.refundAmount != null && <div className="small muted">{money(r.refundAmount, r.currency)}</div>}</td>
              <td>{["requested", "approved"].includes(r.status) && <button className="btn sm" onClick={() => setOpen(r)}>Review</button>}</td></tr>))}</tbody>
        </table></div>)}
      {open && (
        <Modal title={`Return for order #${open.orderNumber}`} onClose={() => setOpen(null)} wide>
          <p><strong>{open.customerName}</strong> · {open.customerEmail}</p>
          <p><strong>Reason:</strong> {open.reason}</p>
          <table><thead><tr><th>Item</th><th className="num">Qty</th><th className="num">Value</th></tr></thead><tbody>{open.items.map((i, k) => <tr key={k}><td>{i.title} {i.variantTitle !== "Default" && <span className="muted">({i.variantTitle})</span>}</td><td className="num">{i.qty}</td><td className="num">{money(i.unitPrice * i.qty, open.currency)}</td></tr>)}</tbody></table>
          <hr />
          <div className="grid g2">
            <div>
              {open.status === "requested" && <><p className="muted small">Approve to tell the customer to send the items back. Refund after they arrive.</p><button className="btn" onClick={() => run("approve", {})}>Approve return</button><hr /></>}
              <Field label={`Refund amount (up to ${money(total, open.currency)})`} hint="Leave empty to refund the full value of the items."><input type="number" step="0.01" min="0" value={amount} onChange={(e) => setAmount(e.target.value)} /></Field>
              <label className="chk"><input type="checkbox" checked={restock} onChange={(e) => setRestock(e.target.checked)} /> Put the items back in stock</label>
              <button className="btn" style={{ marginTop: 8 }} onClick={() => run("refund", { restock, ...(amount ? { amountCents: Math.round(Number(amount) * 100) } : {}) })}>Refund</button>
            </div>
            <div><Field label="Reject with a reason (the customer is emailed)"><input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="e.g. item used or damaged" /></Field><button className="btn danger" disabled={reason.trim().length < 3} onClick={() => run("reject", { reason })}>Reject</button></div>
          </div>
        </Modal>)}
    </>
  );
}
