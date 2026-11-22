"use client";
import { useEffect, useState } from "react";
import { useApi, Modal, Field, Badge, Loading, ErrorBox, Empty, act } from "../../../components/ui";
import { api, money, fmtDate } from "../../../lib/api";
import { usePlatform } from "../../../components/PlatformCtx";
import AccountsEditor from "../../../components/AccountsEditor";

export default function Payments() {
  const { can } = usePlatform();
  const [tab, setTab] = useState("requests");
  return (
    <>
      <div className="page-head"><div><h1>Payments</h1><p className="muted">Stores pay you by bank or wallet transfer and send proof. Check your account, then approve to activate their package.</p></div></div>
      <div className="tabs">
        <button className={tab === "requests" ? "on" : ""} onClick={() => setTab("requests")}>Payment requests</button>
        <button className={tab === "accounts" ? "on" : ""} onClick={() => setTab("accounts")}>My payment accounts</button>
      </div>
      {tab === "requests" ? <Requests canManage={can("platform.billing.manage")} /> : <Accounts canManage={can("platform.billing.manage")} />}
    </>
  );
}

const TONE = { pending: "amber", approved: "green", rejected: "red", cancelled: "gray" };

function Requests({ canManage }) {
  const [status, setStatus] = useState("pending");
  const { data, error, loading, reload } = useApi(`/platform/billing-requests?status=${status}`);
  const [open, setOpen] = useState(null); const [reason, setReason] = useState("");
  if (error) return <ErrorBox error={error} />;
  const decide = (kind) => act(async () => {
    const r = await api(`/platform/billing-requests/${open._id}/${kind}`, { method: "POST", body: kind === "reject" ? { reason } : {} });
    setOpen(null); setReason(""); reload();
    return r;
  }, kind === "approve" ? "Approved. The package is active." : "Rejected. The store was told why.");
  return (
    <>
      <div className="row" style={{ marginBottom: 12 }}>
        {[["pending", "Waiting for you"], ["approved", "Approved"], ["rejected", "Rejected"], ["", "All"]].map(([k, l]) => (
          <button key={k || "all"} className={`btn ${status === k ? "" : "ghost"} sm`} onClick={() => setStatus(k)}>{l}{k === "pending" && data ? ` (${data.pendingCount})` : ""}</button>))}
      </div>
      {loading ? <Loading /> : !data.requests.length ? <Empty>{status === "pending" ? "No payments are waiting. 🎉" : "Nothing here."}</Empty> : (
        <div className="tablewrap"><table>
          <thead><tr><th>Store</th><th>Package</th><th className="num">Amount</th><th>Reference</th><th>Sent</th><th>Status</th><th></th></tr></thead>
          <tbody>{data.requests.map((r) => (
            <tr key={r._id}><td><strong>{r.tenantName}</strong><div className="muted small"><code>{r.tenantId}</code></div></td><td>{r.packageName} · {r.interval === "year" ? "1 year" : "1 month"}</td>
              <td className="num">{money(r.amount * 100, r.currency)}</td><td>{r.proof.reference || <span className="muted">screenshot only</span>}</td><td>{fmtDate(r.createdAt)}</td>
              <td><Badge tone={TONE[r.status]}>{r.status}</Badge>{r.paidUntil && <div className="muted small">until {new Date(r.paidUntil).toLocaleDateString()}</div>}</td>
              <td><button className="btn sm" onClick={() => setOpen(r)}>{r.status === "pending" ? "Review" : "View"}</button></td></tr>))}</tbody>
        </table></div>)}
      {open && (
        <Modal title={`${open.tenantName}: ${open.packageName} (${money(open.amount * 100, open.currency)})`} onClose={() => setOpen(null)} wide>
          <div className="grid g2">
            <div>
              <p><strong>Reference:</strong> {open.proof.reference || <span className="muted">none</span>}</p>
              <p><strong>Period:</strong> {open.interval === "year" ? "1 year" : "1 month"} · sent by {open.requestedBy} on {fmtDate(open.createdAt)}</p>
              {open.rejectReason && <p className="error">Rejected: {open.rejectReason}</p>}
              <p className="muted small">Match the amount and reference against your bank or wallet before approving.</p>
            </div>
            <div>{open.proof.imageUrl ? <a href={open.proof.imageUrl} target="_blank" rel="noreferrer"><img src={open.proof.imageUrl} alt="Payment screenshot" style={{ maxWidth: "100%", maxHeight: 320, borderRadius: 8, border: "1px solid var(--line)" }} /></a> : <p className="muted">No screenshot attached.</p>}</div>
          </div>
          {open.status === "pending" && canManage && (
            <>
              <hr />
              <div className="grid g2">
                <div><p className="muted small">Activates {open.packageName} for {open.interval === "year" ? "365" : "30"} days (extends the current period if they are renewing).</p><button className="btn" onClick={() => decide("approve")}>Approve: money received</button></div>
                <div><Field label="Reason (the store will be emailed)"><input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="e.g. amount is too low" /></Field><button className="btn danger" disabled={reason.trim().length < 3} onClick={() => decide("reject")}>Reject</button></div>
              </div>
            </>)}
        </Modal>)}
    </>
  );
}

function Accounts({ canManage }) {
  const { data, loading, error, reload } = useApi("/platform/payment-settings");
  const [methods, setMethods] = useState(null); const [instructions, setInstructions] = useState("");
  useEffect(() => { if (data) { setMethods(data.methods || []); setInstructions(data.instructions || ""); } }, [data]);
  if (loading || !methods) return <Loading />;
  if (error) return <ErrorBox error={error} />;
  const save = (e) => { e.preventDefault(); act(async () => { await api("/platform/payment-settings", { method: "PUT", body: { methods, instructions } }); reload(); }, "Payment accounts saved"); };
  return (
    <form className="card" onSubmit={save}>
      <h2>Where stores send their package payments</h2>
      <p className="muted">These details are shown to store owners on their Plan &amp; usage page when they upgrade or renew. Package prices are in Pakistani rupees (PKR).</p>
      {!methods.length && <p className="error">No account added yet. Stores cannot pay until you add at least one.</p>}
      <AccountsEditor methods={methods} onChange={setMethods} />
      <Field label="Message to stores (optional)"><textarea style={{ minHeight: 80 }} value={instructions} onChange={(e) => setInstructions(e.target.value)} maxLength={800} /></Field>
      {canManage ? <button className="btn">Save</button> : <p className="muted">Only billing managers can change this.</p>}
    </form>
  );
}
