"use client";
import { Suspense, useCallback, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { api, money, readImage } from "../../../../lib/api";
import { useStore } from "../../../../components/StoreCtx";

// Two ways to arrive here:
//  ?number&t=<token>          after checkout with a bank/wallet transfer or payment link: how to pay + send proof
//  ?number&session_id=<id>    returning from Stripe (only if the store connected its own Stripe account)
function OrderPage() {
  const { slug, info, cart, base } = useStore();
  const sp = useSearchParams();
  const number = sp.get("number") || "", token = sp.get("t"), session = sp.get("session_id");
  if (token) return <PayPage slug={slug} base={base} number={number} token={token} info={info} />;
  return <StripeConfirm slug={slug} cart={cart} base={base} number={number} session={session} />;
}

function PayPage({ slug, base, number, token, info }) {
  const [d, setD] = useState(null); const [err, setErr] = useState("");
  const [reference, setReference] = useState(""); const [methodId, setMethodId] = useState(""); const [image, setImage] = useState(null);
  const [busy, setBusy] = useState(false); const [sent, setSent] = useState(false); const [msg, setMsg] = useState("");
  const load = useCallback(() => api(`/store/${slug}/orders/pay?number=${encodeURIComponent(number)}&t=${encodeURIComponent(token)}`).then((r) => { setD(r); if (!methodId && r.instructions.methods?.[0]) setMethodId(r.instructions.methods[0].id); }).catch((e) => setErr(e.message)), [slug, number, token]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { load(); }, [load]);

  async function submit(e) {
    e.preventDefault(); setBusy(true); setMsg("");
    try {
      await api(`/store/${slug}/orders/proof`, { method: "POST", body: { number, token, reference, ...(methodId ? { methodId } : {}), ...(image ? { image } : {}) } });
      setSent(true); setReference(""); setImage(null); await load();
    } catch (e2) { setMsg(e2.message); }
    setBusy(false);
  }

  if (err) return <div className="s-wrap" style={{ maxWidth: 640 }}><p className="err">{err}</p><a className="s-btn" href={base}>Back to shop</a></div>;
  if (!d) return <div className="s-wrap"><p className="s-muted">Loading your order…</p></div>;
  const { order, payment, instructions } = d;
  const paid = order.status === "paid" || order.status === "fulfilled";

  if (paid) return (
    <div className="s-wrap" style={{ maxWidth: 640 }}>
      <div className="good"><h1 style={{ margin: 0 }}>Payment confirmed 🎉</h1><p>Order <strong>#{order.number}</strong> is paid. Total {money(order.total, order.currency)}. Thank you!</p></div>
      <p><a className="s-btn" href={base}>Continue shopping</a></p>
    </div>);
  if (order.status === "cancelled") return (
    <div className="s-wrap" style={{ maxWidth: 640 }}><div className="s-card"><h1 style={{ margin: 0 }}>Order cancelled</h1><p>Order #{order.number} was cancelled because no payment was received in time. You can place a new order.</p></div><p><a className="s-btn" href={base}>Back to shop</a></p></div>);

  return (
    <div className="s-wrap" style={{ maxWidth: 760 }}>
      <div className="good"><h1 style={{ margin: 0 }}>Order #{order.number} placed</h1><p style={{ margin: "4px 0 0" }}>Total to pay: <strong>{money(order.total, order.currency)}</strong>. Your order is reserved. Please pay within 48 hours.</p></div>

      <div className="s-card" style={{ marginTop: 16 }}>
        <h2>Step 1: pay</h2>
        {instructions.type === "manual" ? (
          <>
            {instructions.note && <p>{instructions.note}</p>}
            <div className="grid g2">{instructions.methods.map((m) => (
              <div key={m.id} className="s-card"><strong>{m.label}</strong>
                {m.accountName && <div className="small">Name: {m.accountName}</div>}
                <div style={{ fontFamily: "ui-monospace, Consolas, monospace", margin: "4px 0", wordBreak: "break-all" }}>{m.accountNumber}</div>
                {m.details && <div className="small s-muted">{m.details}</div>}
                <button type="button" className="s-btn ghost" style={{ marginTop: 6, padding: "4px 12px" }} onClick={() => navigator.clipboard?.writeText(m.accountNumber)}>Copy number</button></div>))}</div>
            <p className="small s-muted">Send exactly {money(order.total, order.currency)} and put <strong>#{order.number}</strong> in the payment note if you can.</p>
          </>
        ) : (
          <>
            {instructions.note && <p>{instructions.note}</p>}
            {instructions.payUrl ? <a className="s-btn" href={instructions.payUrl} target="_blank" rel="noreferrer noopener">{instructions.label} →</a> : <p className="err">The store has not set up the payment page.</p>}
            <p className="small s-muted">The payment page opens in a new tab. Come back here afterwards to confirm.</p>
          </>)}
      </div>

      <div className="s-card" style={{ marginTop: 16 }}>
        <h2>Step 2: confirm that you paid</h2>
        {payment.status === "submitted" && payment.proof && <p className="good">Thanks! We received your payment details{payment.proof.reference ? ` (reference ${payment.proof.reference})` : ""}. The store will confirm your payment shortly, and you will get an email.</p>}
        {payment.status === "rejected" && <p className="err">The store could not confirm your payment: <strong>{payment.rejectReason}</strong>. Please check and send the details again.</p>}
        {(payment.status !== "submitted" || sent) && (
          <form onSubmit={submit}>
            {instructions.type === "manual" && instructions.methods.length > 1 && (
              <label className="field"><span>Which account did you pay?</span><select value={methodId} onChange={(e) => setMethodId(e.target.value)}>{instructions.methods.map((m) => <option key={m.id} value={m.id}>{m.label}</option>)}</select></label>)}
            <div className="grid g2">
              <label className="field"><span>Transaction ID / reference</span><input value={reference} onChange={(e) => setReference(e.target.value)} maxLength={120} placeholder="e.g. TID 123456789" /></label>
              <label className="field"><span>Screenshot (optional)</span><input type="file" accept="image/png,image/jpeg,image/gif,image/webp" onChange={async (e) => { const f = e.target.files[0]; if (!f) return setImage(null); try { setImage(await readImage(f, 2)); } catch (er) { setMsg(er.message); e.target.value = ""; setImage(null); } }} /></label>
            </div>
            {msg && <p className="err">{msg}</p>}
            <button className="s-btn" disabled={busy || (!reference.trim() && !image)}>{busy ? "Sending…" : payment.status === "submitted" ? "Send updated details" : "I have paid"}</button>
          </form>)}
      </div>
      <p className="small s-muted" style={{ marginTop: 12 }}>Keep this page's link: it is the only way to come back to your payment details. {info.features.tracking && <>You can also <a href={`${base}/track`}>track your order</a> with your order number and email.</>}</p>
    </div>
  );
}

function StripeConfirm({ slug, cart, base, number, session }) {
  const [order, setOrder] = useState(null); const [err, setErr] = useState("");
  useEffect(() => {
    if (!session) { setErr("This order link is not complete. Please use the link shown after checkout."); return; }
    api(`/store/${slug}/orders/confirm?number=${encodeURIComponent(number)}&session_id=${encodeURIComponent(session)}`)
      .then((r) => { setOrder(r.order); if (r.order.status === "paid") cart.clear(); })
      .catch((e) => setErr(e.message));
  }, [slug]); // eslint-disable-line react-hooks/exhaustive-deps
  if (err) return <div className="s-wrap" style={{ maxWidth: 620 }}><p className="err">{err}</p><a className="s-btn" href={base}>Back to shop</a></div>;
  if (!order) return <div className="s-wrap"><p className="s-muted">Confirming your payment…</p></div>;
  return (
    <div className="s-wrap" style={{ maxWidth: 640 }}>
      {order.status === "paid"
        ? <div className="good"><h1 style={{ margin: 0 }}>Payment received 🎉</h1><p>Your order <strong>#{order.number}</strong> is confirmed. Total {money(order.total, order.currency)}.</p></div>
        : <div className="s-card"><h1 style={{ margin: 0 }}>Waiting for payment</h1><p>Order <strong>#{order.number}</strong> is not paid yet. If you completed the payment, refresh this page in a moment.</p></div>}
      <p><a className="s-btn" href={base}>Continue shopping</a></p>
    </div>
  );
}

export default function Page() { return <Suspense><OrderPage /></Suspense>; }
