"use client";
import { useEffect, useState } from "react";
import { useApi, Modal, Field, Badge, Loading, ErrorBox, Empty, act } from "../../../components/ui";
import { api, money, fmtDate } from "../../../lib/api";
import { useDash } from "../../../components/DashCtx";
import AccountsEditor from "../../../components/AccountsEditor";

export default function Payments() {
  const { can } = useDash();
  const [tab, setTab] = useState("verify");
  const canVerify = can("orders.refund"), canConfig = can("settings.manage");
  useEffect(() => { if (!canVerify && canConfig) setTab("methods"); }, [canVerify, canConfig]);
  return (
    <>
      <div className="page-head"><div><h1>Payments</h1><p className="muted">Take online payments by bank or wallet transfer and payment links. You confirm each payment here.</p></div></div>
      <div className="tabs">
        {canVerify && <button className={tab === "verify" ? "on" : ""} onClick={() => setTab("verify")}>Verify payments</button>}
        {canConfig && <button className={tab === "methods" ? "on" : ""} onClick={() => setTab("methods")}>Payment methods</button>}
      </div>
      {tab === "verify" && canVerify ? <Queue /> : canConfig ? <Methods /> : <p className="muted">You do not have access to payments.</p>}
    </>
  );
}

function Queue() {
  const [filter, setFilter] = useState("submitted");
  const { data, error, loading, reload } = useApi(`/admin/payments/queue?filter=${filter}`);
  const [open, setOpen] = useState(null); const [reason, setReason] = useState(""); const [note, setNote] = useState("");
  if (error) return <ErrorBox error={error} />;
  const decide = (kind) => act(async () => {
    await api(`/admin/payments/${open._id}/${kind}`, { method: "POST", body: kind === "approve" ? { note: note || undefined } : { reason } });
    setOpen(null); setReason(""); setNote(""); reload();
  }, kind === "approve" ? "Payment approved. The order is now paid." : "Payment rejected. The customer was told why.");
  return (
    <>
      <div className="row" style={{ marginBottom: 12 }}>
        {[["submitted", "Proof received"], ["awaiting", "Waiting for the customer"], ["all", "All"]].map(([k, l]) => (
          <button key={k} className={`btn ${filter === k ? "" : "ghost"} sm`} onClick={() => setFilter(k)}>{l}{data && k !== "all" ? ` (${data.counts[k]})` : ""}</button>))}
      </div>
      {loading ? <Loading /> : !data.orders.length ? <Empty>{filter === "submitted" ? "No payments are waiting for you. 🎉" : "Nothing here."}</Empty> : (
        <div className="tablewrap"><table>
          <thead><tr><th>Order</th><th>Placed</th><th>Customer</th><th>Via</th><th className="num">Amount</th><th>Status</th><th></th></tr></thead>
          <tbody>{data.orders.map((o) => (
            <tr key={o._id}><td><strong>#{o.number}</strong></td><td>{fmtDate(o.createdAt)}</td><td>{o.customer?.name}<div className="muted small">{o.customer?.email}</div></td>
              <td>{o.method === "manual" ? "Transfer" : "Payment link"}</td><td className="num">{money(o.total, o.currency)}</td>
              <td>{o.payment.status === "submitted" ? <Badge tone="amber">proof received</Badge> : o.payment.status === "rejected" ? <Badge tone="red">rejected</Badge> : <Badge>waiting</Badge>}</td>
              <td><button className="btn sm" onClick={() => setOpen(o)}>{o.payment.proof ? "Review" : "Open"}</button></td></tr>))}</tbody>
        </table></div>)}
      {open && (
        <Modal title={`Order #${open.number}: ${money(open.total, open.currency)}`} onClose={() => setOpen(null)} wide>
          <p>{open.customer?.name} · {open.customer?.email}</p>
          {open.payment.proof ? (
            <div className="grid g2">
              <div>
                <p><strong>Transaction reference:</strong> {open.payment.proof.reference || <span className="muted">none given</span>}</p>
                {open.payment.proof.methodLabel && <p><strong>Paid via:</strong> {open.payment.proof.methodLabel}</p>}
                <p className="muted small">Sent {fmtDate(open.payment.proof.submittedAt)}. Check it against your bank or wallet before approving.</p>
                {open.payment.rejectReason && <p className="error">Previously rejected: {open.payment.rejectReason}</p>}
              </div>
              <div>{open.payment.proof.imageUrl ? <a href={open.payment.proof.imageUrl} target="_blank" rel="noreferrer"><img src={open.payment.proof.imageUrl} alt="Payment screenshot" style={{ maxWidth: "100%", maxHeight: 340, borderRadius: 8, border: "1px solid var(--line)" }} /></a> : <p className="muted">No screenshot attached.</p>}</div>
            </div>
          ) : <p className="muted">The customer has not sent any proof yet. If you already received the money, you can approve anyway.</p>}
          <hr />
          <div className="grid g2">
            <div><Field label="Note for your records (optional)"><input value={note} onChange={(e) => setNote(e.target.value)} placeholder="e.g. seen in my JazzCash" /></Field><button className="btn" onClick={() => decide("approve")}>Approve: money received</button></div>
            <div><Field label="Reason (the customer will be emailed)"><input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="e.g. amount does not match" /></Field><button className="btn danger" disabled={reason.trim().length < 3} onClick={() => decide("reject")}>Reject</button></div>
          </div>
        </Modal>)}
    </>
  );
}

function Methods() {
  const { data, error, loading, reload } = useApi("/admin/payments/config");
  const [cfg, setCfg] = useState(null);
  useEffect(() => { if (data) setCfg(data.config); }, [data]);
  if (loading || !cfg) return <Loading />;
  if (error) return <ErrorBox error={error} />;
  const set = (path, v) => setCfg((c) => ({ ...c, [path[0]]: { ...c[path[0]], [path[1]]: v } }));
  const save = (e) => { e.preventDefault(); act(async () => { await api("/admin/payments/config", { method: "PUT", body: cfg }); reload(); }, "Payment methods saved"); };
  const { available } = data;
  return (
    <form onSubmit={save}>
      <div className="card">
        <div className="row between"><h2 style={{ margin: 0 }}>Bank or wallet transfer</h2><label className="chk"><input type="checkbox" checked={cfg.manual.enabled} disabled={!available.manual} onChange={(e) => set(["manual", "enabled"], e.target.checked)} /> Offer at checkout</label></div>
        <p className="muted">Shoppers see these accounts after placing an order, send the money, then upload a reference or screenshot. You approve it in <em>Verify payments</em>.</p>
        {!available.manual && <p className="muted">🔒 Not included in your package.</p>}
        <AccountsEditor methods={cfg.manual.methods} onChange={(m) => set(["manual", "methods"], m)} />
        <Field label="Message to payers (optional)"><textarea style={{ minHeight: 70 }} value={cfg.manual.instructions} onChange={(e) => set(["manual", "instructions"], e.target.value)} placeholder="e.g. Please send the exact amount and keep the receipt." maxLength={600} /></Field>
      </div>
      <div className="card">
        <div className="row between"><h2 style={{ margin: 0 }}>Online payment link (gateway)</h2><label className="chk"><input type="checkbox" checked={cfg.gateway.enabled} disabled={!available.gateway} onChange={(e) => set(["gateway", "enabled"], e.target.checked)} /> Offer at checkout</label></div>
        <p className="muted">Use a payment page from your own gateway or wallet provider. The shopper is sent there to pay, then you confirm it here after checking your gateway dashboard.</p>
        {!available.gateway && <p className="muted">🔒 Payment links are available on higher packages.</p>}
        <div className="grid g2">
          <Field label="Button text"><input value={cfg.gateway.label} onChange={(e) => set(["gateway", "label"], e.target.value)} maxLength={60} /></Field>
          <Field label="Payment page link" hint="https:// only. You can use {order}, {amount} and {currency} in the link."><input value={cfg.gateway.url} onChange={(e) => set(["gateway", "url"], e.target.value)} placeholder="https://pay.yourgateway.com/checkout?ref={order}&amount={amount}" maxLength={500} /></Field>
        </div>
        <Field label="Message to payers (optional)"><textarea style={{ minHeight: 70 }} value={cfg.gateway.instructions} onChange={(e) => set(["gateway", "instructions"], e.target.value)} maxLength={600} /></Field>
      </div>
      <p className="muted small">If you turn on neither, shoppers can only choose cash on delivery (when your package includes it). Orders that are not paid within 48 hours are cancelled automatically and the stock is released.</p>
      <button className="btn">Save payment methods</button>
    </form>
  );
}
