"use client";
import { useEffect, useState } from "react";
import { api, money, fmtDate } from "../../../../lib/api";
import { useStore } from "../../../../components/StoreCtx";

export default function Account() {
  const { slug, info, customer, setCustomer, base } = useStore();
  const [mode, setMode] = useState("login"); const [f, setF] = useState({ name: "", email: "", password: "" }); const [err, setErr] = useState(""); const [orders, setOrders] = useState(null);
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });

  useEffect(() => { if (customer) api(`/store/${slug}/account/orders`).then((r) => setOrders(r.orders)).catch(() => setOrders([])); }, [customer, slug]);

  async function submit(e) {
    e.preventDefault(); setErr("");
    try {
      await api(`/store/${slug}/auth/${mode === "login" ? "login" : "register"}`, { method: "POST", body: mode === "login" ? { email: f.email, password: f.password } : f });
      const me = await api(`/store/${slug}/auth/me`); setCustomer(me.customer);
    } catch (e2) { setErr(e2.message); }
  }
  async function logout() { await api(`/store/${slug}/auth/logout`, { method: "POST" }); setCustomer(null); setOrders(null); }

  if (customer) return (
    <div className="s-wrap">
      <div className="row between"><h1>My account</h1><button className="s-btn ghost" onClick={logout}>Sign out</button></div>
      <p>{customer.name} · {customer.email}</p>
      {info.features.loyalty && <p className="good" style={{ display: "inline-block" }}>⭐ You have <strong>{customer.points || 0}</strong> loyalty points. You earn {info.features.loyalty.earnRate} per {money(100, info.currency)} spent on paid orders.</p>}
      {info.features.gdpr && (
        <div className="row" style={{ margin: "8px 0 16px" }}>
          <a className="s-btn ghost" href={`/api/store/${slug}/account/export`} download="my-data.json">Download my data</a>
          <button className="s-btn ghost" onClick={async () => { if (!confirm("Delete your account and personal data? This cannot be undone.")) return; await api(`/store/${slug}/account`, { method: "DELETE" }); setCustomer(null); setOrders(null); }}>Delete my account</button>
        </div>)}
      <h2>My orders</h2>
      {!orders ? <p className="s-muted">Loading…</p> : !orders.length ? <div className="s-card">No orders yet. <a href={base}>Start shopping</a></div> : (
        <div className="s-card"><table><thead><tr><th>Order</th><th>Date</th><th>Status</th><th>Items</th><th style={{ textAlign: "right" }}>Total</th></tr></thead>
          <tbody>{orders.map((o) => <tr key={o.number}><td>#{o.number}</td><td>{fmtDate(o.createdAt)}</td><td>{o.status}</td><td>{o.lines.map((l) => `${l.qty}× ${l.title}`).join(", ")}</td><td style={{ textAlign: "right" }}>{money(o.total, o.currency)}</td></tr>)}</tbody></table></div>)}
    </div>);

  return (
    <div className="s-wrap" style={{ maxWidth: 440 }}>
      <form className="s-card" onSubmit={submit}>
        <h1>{mode === "login" ? "Sign in" : "Create account"}</h1>
        {mode === "register" && <label className="field"><span>Name</span><input value={f.name} onChange={set("name")} required minLength={2} autoComplete="name" /></label>}
        <label className="field"><span>Email</span><input type="email" value={f.email} onChange={set("email")} required autoComplete="email" /></label>
        <label className="field"><span>Password</span><input type="password" value={f.password} onChange={set("password")} required minLength={mode === "register" ? 12 : 1} autoComplete={mode === "login" ? "current-password" : "new-password"} />{mode === "register" && <small className="s-muted">At least 12 characters.</small>}</label>
        {err && <p className="err">{err}</p>}
        <button className="s-btn" style={{ width: "100%" }}>{mode === "login" ? "Sign in" : "Create account"}</button>
        <p className="small" style={{ textAlign: "center" }}><a href="#" onClick={(e) => { e.preventDefault(); setMode(mode === "login" ? "register" : "login"); setErr(""); }}>{mode === "login" ? "New here? Create an account" : "Have an account? Sign in"}</a></p>
      </form>
    </div>
  );
}
