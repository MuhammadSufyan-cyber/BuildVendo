"use client";
import { useState } from "react";
import { useApi, Field, act, Confirm } from "./ui";
import { api, fmtDate } from "../lib/api";
import { useDash } from "./DashCtx";

// Lets a store connect its OWN Stripe account so shoppers pay the store directly.
export default function PaymentsCard() {
  const { flags, can } = useDash();
  const { data, reload } = useApi(can("settings.manage") ? "/admin/billing/payments" : null);
  const [key, setKey] = useState(""); const [busy, setBusy] = useState(false); const [off, setOff] = useState(false);
  if (!can("settings.manage")) return null;
  async function connect(e) {
    e.preventDefault(); setBusy(true);
    const ok = await act(() => api("/admin/billing/payments", { method: "PUT", body: { secretKey: key.trim() } }), "Stripe connected");
    setBusy(false); if (ok) { setKey(""); reload(); }
  }
  return (
    <div className="card" style={{ marginTop: 16 }}>
      <h2>Take card payments (Stripe)</h2>
      {!flags["PAY-04"] ? <p className="muted">🔒 Card payments are not included in your package.</p> : data?.connected ? (
        <>
          <p className="ok">Connected to Stripe in <strong>{data.mode}</strong> mode (key ending {data.last4}) since {fmtDate(data.connectedAt)}. Shoppers who choose “card” pay on Stripe and the money goes to your Stripe account.</p>
          {data.mode === "test" && <p className="muted small">Test mode: no real money moves. Switch to a live key when you are ready to sell.</p>}
          <button className="btn ghost" onClick={() => setOff(true)}>Disconnect</button>
        </>
      ) : (
        <form onSubmit={connect}>
          <p className="muted">Without Stripe, the “card” option in your store is a <strong>test payment</strong> that takes no money. To take real payments, create a free Stripe account, then copy your <strong>secret key</strong> from Stripe → Developers → API keys.</p>
          <Field label="Stripe secret key" hint="Starts with sk_test_ (practice) or sk_live_ (real money). It is stored encrypted and never shown again."><input type="password" value={key} onChange={(e) => setKey(e.target.value)} placeholder="sk_test_…" autoComplete="off" required /></Field>
          <button className="btn" disabled={busy}>{busy ? "Checking with Stripe…" : "Connect Stripe"}</button>
        </form>
      )}
      {off && <Confirm message="Disconnect Stripe? Card payments in your store go back to the test payment." onNo={() => setOff(false)} onYes={() => act(async () => { await api("/admin/billing/payments", { method: "DELETE" }); setOff(false); reload(); }, "Stripe disconnected")} />}
    </div>
  );
}
