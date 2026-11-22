"use client";
import { useEffect, useState } from "react";
import { useApi, Field, Loading, ErrorBox, act } from "../../../components/ui";
import { api, toCents } from "../../../lib/api";
import { useDash } from "../../../components/DashCtx";
import PaymentsCard from "../../../components/PaymentsCard";
import DomainsCard from "../../../components/DomainsCard";
import { BrandingCard, LoyaltyCard, ShippingCard, CssCard, IpCard, WebhooksCard } from "../../../components/SettingsExtras";

export default function Settings() {
  const { can, user, refresh } = useDash();
  const { data, error, loading, reload } = useApi("/admin/settings");
  const [f, setF] = useState(null);
  useEffect(() => {
    if (!data) return;
    const s = data.settings, t = s.theme || {};
    setF({ name: data.name, tagline: s.tagline || "", currency: s.currency || "USD", taxRatePct: s.taxRatePct ?? 0, shippingFlat: ((s.shippingFlat || 0) / 100).toFixed(2), freeShippingOver: ((s.freeShippingOver || 0) / 100).toFixed(2),
      primary: t.primary || "#6b3410", accent: t.accent || "#f08c00", font: t.font || "sans", style: t.style || "modern", mode: t.mode || "light" });
  }, [data]);
  if (loading || !f) return <Loading />;
  if (error) return <ErrorBox error={error} />;
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });
  const full = can("settings.manage");

  async function save(e) {
    e.preventDefault();
    const theme = { primary: f.primary, accent: f.accent, font: f.font, style: f.style, mode: f.mode };
    const body = full ? { name: f.name, tagline: f.tagline, currency: f.currency.toUpperCase(), taxRatePct: Number(f.taxRatePct), shippingFlat: toCents(f.shippingFlat), freeShippingOver: toCents(f.freeShippingOver), theme } : { theme };
    const ok = await act(() => api("/admin/settings", { method: "PATCH", body }), "Settings saved");
    if (ok) { reload(); refresh(); }
  }
  async function exportAll() {
    const res = await api("/admin/data-export", { raw: true });
    if (!res.ok) return act(async () => { throw new Error((await res.json()).error); });
    const blob = await res.blob(); const a = document.createElement("a"); a.href = URL.createObjectURL(blob); a.download = `${data.slug}-export.json`; a.click();
  }

  return (
    <>
      <div className="page-head"><div><h1>Settings</h1><p className="muted">Store details, shipping, tax and look. Store ID: <code>{data.slug}</code></p></div><a className="btn ghost" href={`/s/${data.slug}`} target="_blank" rel="noreferrer">View storefront ↗</a></div>
      <form onSubmit={save}>
        {full && <div className="card"><h2>Store</h2><div className="grid g2">
          <Field label="Store name"><input value={f.name} onChange={set("name")} required minLength={2} /></Field>
          <Field label="Tagline"><input value={f.tagline} onChange={set("tagline")} maxLength={160} /></Field>
          <Field label="Currency (ISO code)" hint="For example USD, PKR, EUR"><input value={f.currency} onChange={set("currency")} maxLength={3} minLength={3} required /></Field>
          <Field label="Tax rate %"><input type="number" step="0.01" min="0" max="50" value={f.taxRatePct} onChange={set("taxRatePct")} /></Field>
          <Field label="Flat shipping fee"><input type="number" step="0.01" min="0" value={f.shippingFlat} onChange={set("shippingFlat")} /></Field>
          <Field label="Free shipping over" hint="0 = never free"><input type="number" step="0.01" min="0" value={f.freeShippingOver} onChange={set("freeShippingOver")} /></Field>
        </div></div>}
        <div className="card"><h2>Look and feel</h2><div className="grid g3">
          <Field label="Main colour"><input type="color" value={f.primary} onChange={set("primary")} style={{ height: 42, padding: 3 }} /></Field>
          <Field label="Accent colour"><input type="color" value={f.accent} onChange={set("accent")} style={{ height: 42, padding: 3 }} /></Field>
          <Field label="Font"><select value={f.font} onChange={set("font")}><option value="sans">Clean sans-serif</option><option value="serif">Elegant serif</option><option value="mono">Technical mono</option></select></Field>
          <Field label="Style"><select value={f.style} onChange={set("style")}>{["modern", "classic", "bold", "minimal"].map((x) => <option key={x}>{x}</option>)}</select></Field>
          <Field label="Mode"><select value={f.mode} onChange={set("mode")}><option value="light">Light</option><option value="dark">Dark</option></select></Field>
        </div></div>
        <button className="btn">Save settings</button>
      </form>
      <ShippingCard />
      <LoyaltyCard />
      <BrandingCard />
      <DomainsCard />
      <CssCard />
      <IpCard />
      <WebhooksCard />
      <PaymentsCard />
      {user.role === "owner" && <div className="card" style={{ marginTop: 16 }}><h2>Your data</h2><p className="muted">Download all your products, orders and customers (passwords are never included). You can do this at any time, including after cancelling.</p><button className="btn ghost" onClick={exportAll}>Download full export (JSON)</button></div>}
    </>
  );
}
