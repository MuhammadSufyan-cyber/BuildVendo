"use client";
import { useEffect, useState } from "react";
import { Confirm, Modal, Field, act, Badge, notify, useApi, Loading } from "../../../components/ui";
import { api, money, fmtDate, readImage, PLATFORM_CURRENCY } from "../../../lib/api";
import { useDash } from "../../../components/DashCtx";

const ROWS = [["products", "Products"], ["staff", "Staff seats"], ["orders", "Orders / month"], ["aiCredits", "AI credits / month"], ["domains", "Custom domains"], ["apiCalls", "API calls / day"]];
const show = (v) => (v === undefined ? 0 : v < 0 ? "Unlimited" : v.toLocaleString());
const TONE = { pending: "amber", approved: "green", rejected: "red", cancelled: "gray" };

export default function Plan() {
  const { packages, packageKey, billing, can, refresh } = useDash();
  const [target, setTarget] = useState(null); const [interval, setIntervalV] = useState("month");
  const stripe = billing?.stripe; // Stripe is optional and switched off unless the platform adds keys
  const order = packages.map((p) => p.key);
  const info = useApi(!stripe && can("plan.billing.manage") ? "/admin/billing/platform-info" : null);

  useEffect(() => {
    const q = new URLSearchParams(window.location.search);
    if (q.get("paid")) { notify("Thank you! Your package will update in a moment."); setTimeout(refresh, 2500); window.history.replaceState(null, "", "/dashboard/plan"); }
    if (q.get("cancelled")) { notify("Checkout cancelled. Nothing was charged."); window.history.replaceState(null, "", "/dashboard/plan"); }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  async function stripeMove(p) {
    setTarget(null);
    const r = await act(() => api("/admin/billing/checkout", { method: "POST", body: { packageId: p.key, interval } }));
    if (r && r !== true) { if (r.url) window.location.href = r.url; else { notify("Package changed."); refresh(); } }
  }
  const portal = async () => { const r = await act(() => api("/admin/billing/portal", { method: "POST" })); if (r && r !== true) window.location.href = r.url; };
  const paidUntil = billing?.paidUntil ? new Date(billing.paidUntil) : null;
  const daysLeft = paidUntil ? Math.ceil((paidUntil - Date.now()) / 864e5) : null;
  const pending = info.data?.pending;

  return (
    <>
      <div className="page-head"><div><h1>Plan & usage</h1>
        <p className="muted">Your current package is <strong>{packageKey}</strong>.{paidUntil && (daysLeft >= 0 ? <> Active until <strong>{paidUntil.toLocaleDateString()}</strong> ({daysLeft} days left).</> : <> It ended on {paidUntil.toLocaleDateString()}. Pay again to keep your features.</>)}{!paidUntil && billing?.trialEndsAt && <> Your free trial ends on <strong>{new Date(billing.trialEndsAt).toLocaleDateString()}</strong>.</>}</p></div>
        <div className="row">
          {(stripe || true) && <div className="tabs" style={{ margin: 0, border: 0 }}><button className={interval === "month" ? "on" : ""} onClick={() => setIntervalV("month")}>Monthly</button><button className={interval === "year" ? "on" : ""} onClick={() => setIntervalV("year")}>Yearly (save ~17%)</button></div>}
          {stripe && billing.hasSubscription && <button className="btn ghost" onClick={portal}>Manage billing & invoices</button>}
        </div></div>

      {!stripe && pending && (
        <div className="banner"><span><strong>Payment sent, waiting for approval.</strong> You sent proof for the {pending.packageName} package on {fmtDate(pending.createdAt)}. The platform team checks it and activates your package.</span>
          <button className="btn ghost sm" onClick={() => act(async () => { await api(`/admin/billing/request/${pending._id}`, { method: "DELETE" }); info.reload(); }, "Request cancelled")}>Cancel request</button></div>)}

      <div className="grid g4">
        {packages.map((p) => {
          const current = p.key === packageKey; const up = order.indexOf(p.key) > order.indexOf(packageKey);
          const price = interval === "year" ? p.priceYearly : p.priceMonthly;
          const free = price === 0;
          return (
            <div key={p.key} className="card" style={{ outline: current ? "2px solid var(--primary)" : undefined }}>
              <div className="row between"><h2 style={{ margin: 0 }}>{p.name}</h2>{current && <Badge tone="green">current</Badge>}</div>
              <div style={{ fontSize: "1.7rem", fontWeight: 800, margin: "6px 0" }}>{price == null ? "Custom" : free ? "Free" : money(price * 100, PLATFORM_CURRENCY)}{price > 0 && <small className="muted" style={{ fontSize: ".9rem", fontWeight: 400 }}> / {interval === "year" ? "year" : "month"}</small>}</div>
              {ROWS.map(([k, l]) => <div key={k} className="row between small" style={{ padding: "2px 0" }}><span className="muted">{l}</span><strong>{show(p.limits[k])}</strong></div>)}
              <button className={`btn block ${up || (current && !free) ? "" : "ghost"}`} style={{ marginTop: 12 }} disabled={(current && free) || price == null || free || !can("plan.billing.manage") || (!stripe && !!pending)} onClick={() => setTarget(p)}>
                {current ? (free ? "Your package" : "Renew") : price == null ? "Contact sales" : free ? "After your paid period" : up ? "Upgrade" : "Switch to this"}</button>
            </div>);
        })}
      </div>
      {!stripe && <p className="muted small" style={{ marginTop: 12 }}>You pay the platform by bank or wallet transfer, then send the reference or a screenshot. After approval your package is active for the period you paid. Moving to Free happens by itself when a paid period ends (after 3 days of grace); nothing is deleted.</p>}

      {!stripe && info.data?.history?.length > 0 && (
        <div className="card" style={{ marginTop: 16 }}><h2>Payment history</h2>
          <table><thead><tr><th>Sent</th><th>Package</th><th className="num">Amount</th><th>Reference</th><th>Status</th></tr></thead>
            <tbody>{info.data.history.map((h) => <tr key={h._id}><td>{fmtDate(h.createdAt)}</td><td>{h.packageName} · {h.interval === "year" ? "1 year" : "1 month"}</td><td className="num">{money(h.amount * 100, h.currency)}</td><td>{h.proof?.reference || "screenshot"}</td>
              <td><Badge tone={TONE[h.status]}>{h.status}</Badge>{h.rejectReason && <div className="muted small">{h.rejectReason}</div>}</td></tr>)}</tbody></table></div>)}

      {target && stripe && <Confirm message={`Change your package to ${target.name}?`} onNo={() => setTarget(null)} onYes={() => stripeMove(target)} />}
      {target && !stripe && <PayModal pkg={target} interval={interval} info={info} onClose={() => setTarget(null)} onSent={() => { setTarget(null); info.reload(); }} />}
    </>
  );
}

function PayModal({ pkg, interval, info, onClose, onSent }) {
  const [reference, setReference] = useState(""); const [image, setImage] = useState(null); const [busy, setBusy] = useState(false);
  const price = interval === "year" ? pkg.priceYearly : pkg.priceMonthly;
  if (info.loading || !info.data) return <Modal title="Pay for your package" onClose={onClose}><Loading /></Modal>;
  const { methods, instructions } = info.data;
  async function submit(e) {
    e.preventDefault(); setBusy(true);
    const ok = await act(() => api("/admin/billing/request", { method: "POST", body: { packageId: pkg.key, interval, reference, ...(image ? { image } : {}) } }), "Payment proof sent. We will approve it soon.");
    setBusy(false); if (ok) onSent();
  }
  return (
    <Modal title={`${pkg.name} package: ${money(price * 100, PLATFORM_CURRENCY)} for ${interval === "year" ? "1 year" : "1 month"}`} onClose={onClose} wide>
      <h3>Step 1: send the money</h3>
      {!methods.length ? <p className="error">The platform has not added a payment account yet. Please contact the platform team.</p> : (
        <div className="grid g2" style={{ margin: "8px 0 12px" }}>{methods.map((m) => (
          <div key={m.id} className="card" style={{ background: "var(--panel-2)", padding: 14 }}><strong>{m.label}</strong>
            {m.accountName && <div className="small">Name: {m.accountName}</div>}
            <div style={{ fontFamily: "ui-monospace, Consolas, monospace", margin: "4px 0" }}>{m.accountNumber}</div>
            {m.details && <div className="muted small">{m.details}</div>}
            <button type="button" className="btn ghost sm" style={{ marginTop: 6 }} onClick={() => { navigator.clipboard?.writeText(m.accountNumber); notify("Number copied"); }}>Copy number</button></div>))}</div>)}
      {instructions && <p className="banner" style={{ marginBottom: 12 }}>{instructions}</p>}
      <form onSubmit={submit}>
        <h3>Step 2: tell us you paid</h3>
        <div className="grid g2">
          <Field label="Transaction reference or ID"><input value={reference} onChange={(e) => setReference(e.target.value)} maxLength={120} placeholder="e.g. TID 123456789" /></Field>
          <Field label="Screenshot of the payment (optional if you gave a reference)"><input type="file" accept="image/png,image/jpeg,image/gif,image/webp" onChange={async (e) => { const f = e.target.files[0]; if (!f) return setImage(null); try { setImage(await readImage(f, 2)); } catch (er) { notify(er.message, "err"); e.target.value = ""; setImage(null); } }} /></Field>
        </div>
        <div className="row end"><button type="button" className="btn ghost" onClick={onClose}>Cancel</button><button className="btn" disabled={busy || !methods.length || (!reference.trim() && !image)}>{busy ? "Sending…" : "I have paid, send proof"}</button></div>
      </form>
    </Modal>
  );
}
