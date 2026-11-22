"use client";
import { useEffect, useState } from "react";
import { useApi, Field, Badge, act, notify, Loading, Modal } from "./ui";
import { api, fmtDate, readImage } from "../lib/api";
import { useDash } from "./DashCtx";

const Locked = ({ title, id }) => <div className="card" style={{ marginTop: 16 }}><h2>{title}</h2><p className="muted">🔒 Not included in your package (<code>{id}</code>).</p></div>;

// ---------- Loyalty points (MKT-06) ----------
export function LoyaltyCard() {
  const { flags, can } = useDash();
  const { data, reload } = useApi(can("settings.manage") && flags["MKT-06"] ? "/admin/settings" : null);
  const [f, setF] = useState(null);
  useEffect(() => { if (data) { const l = data.settings.loyalty || {}; setF({ enabled: !!l.enabled, earnRate: l.earnRate ?? 1, value: ((l.pointValueCents ?? 1) / 100).toFixed(2), minRedeem: l.minRedeem ?? 100 }); } }, [data]);
  if (!can("settings.manage")) return null;
  if (!flags["MKT-06"]) return <Locked title="Loyalty points" id="MKT-06" />;
  if (!f) return <Loading />;
  const save = (e) => { e.preventDefault(); act(async () => { await api("/admin/settings", { method: "PATCH", body: { loyalty: { enabled: f.enabled, earnRate: Number(f.earnRate), pointValueCents: Math.max(1, Math.round(Number(f.value) * 100)), minRedeem: Number(f.minRedeem) } } }); reload(); }, "Loyalty settings saved"); };
  return (
    <form className="card" style={{ marginTop: 16 }} onSubmit={save}>
      <div className="row between"><h2 style={{ margin: 0 }}>Loyalty points</h2><label className="chk"><input type="checkbox" checked={f.enabled} onChange={(e) => setF({ ...f, enabled: e.target.checked })} /> Turn on</label></div>
      <p className="muted">Shoppers with an account earn points on every paid order and spend them as money off at checkout.</p>
      <div className="grid g3">
        <Field label="Points earned per 1.00 spent"><input type="number" step="0.1" min="0" max="100" value={f.earnRate} onChange={(e) => setF({ ...f, earnRate: e.target.value })} /></Field>
        <Field label="Value of one point" hint="In your store currency, for example 0.01"><input type="number" step="0.01" min="0.01" value={f.value} onChange={(e) => setF({ ...f, value: e.target.value })} /></Field>
        <Field label="Smallest amount to spend (points)"><input type="number" min="1" value={f.minRedeem} onChange={(e) => setF({ ...f, minRedeem: e.target.value })} /></Field>
      </div>
      <button className="btn">Save</button>
    </form>
  );
}

// ---------- Shipping zones: different delivery prices per country (ORD-06) ----------
export function ShippingCard() {
  const { can } = useDash();
  const { data, reload } = useApi(can("settings.manage") ? "/admin/settings" : null);
  const [zones, setZones] = useState(null);
  useEffect(() => { if (data) setZones((data.settings.shippingZones || []).map((z) => ({ name: z.name, countries: z.countries.join(", "), rate: (z.rate / 100).toFixed(2), freeOver: z.freeOver ? (z.freeOver / 100).toFixed(2) : "" }))); }, [data]);
  if (!can("settings.manage")) return null;
  if (!zones) return <Loading />;
  const set = (i, k, v) => setZones(zones.map((z, j) => (j === i ? { ...z, [k]: v } : z)));
  const save = () => act(async () => {
    const body = zones.map((z) => ({ name: z.name.trim(), countries: z.countries.split(/[,;\n]+/).map((c) => c.trim()).filter(Boolean), rate: Math.round(Number(z.rate || 0) * 100), freeOver: Math.round(Number(z.freeOver || 0) * 100) }));
    await api("/admin/settings", { method: "PATCH", body: { shippingZones: body } }); reload();
  }, "Shipping zones saved");
  return (
    <div className="card" style={{ marginTop: 16 }}>
      <h2>Shipping by country</h2>
      <p className="muted">Charge different delivery prices per country. A shopper&apos;s country is matched against the lists below. Anyone else pays your default shipping fee above.</p>
      {zones.map((z, i) => (
        <div key={i} className="card" style={{ background: "#fafbfb", marginBottom: 10, padding: 14 }}>
          <div className="grid g2">
            <Field label="Zone name"><input value={z.name} onChange={(e) => set(i, "name", e.target.value)} placeholder="e.g. Pakistan" required maxLength={60} /></Field>
            <Field label="Countries" hint="Separate with commas, spelled as shoppers type them."><input value={z.countries} onChange={(e) => set(i, "countries", e.target.value)} placeholder="Pakistan, PK" required /></Field>
            <Field label="Shipping fee"><input type="number" step="0.01" min="0" value={z.rate} onChange={(e) => set(i, "rate", e.target.value)} required /></Field>
            <Field label="Free shipping over (optional)"><input type="number" step="0.01" min="0" value={z.freeOver} onChange={(e) => set(i, "freeOver", e.target.value)} /></Field>
          </div>
          <button type="button" className="btn ghost sm" onClick={() => setZones(zones.filter((_, j) => j !== i))}>Remove zone</button>
        </div>))}
      <div className="row"><button type="button" className="btn ghost" onClick={() => setZones([...zones, { name: "", countries: "", rate: "5.00", freeOver: "" }])}>+ Add a zone</button><button type="button" className="btn" onClick={save}>Save shipping zones</button></div>
    </div>
  );
}

// ---------- Branding pictures: logo, home banner, category images ----------
function PicturePicker({ label, hint, value, onChange, wide }) {
  const [busy, setBusy] = useState(false);
  async function pick(e) {
    const f = e.target.files[0]; e.target.value = "";
    if (!f) return;
    setBusy(true);
    try {
      const data = await readImage(f, 2.5);
      const r = await api("/admin/uploads", { method: "POST", body: { data } });
      onChange(r.url);
    } catch (er) { notify(er.message, "err"); }
    setBusy(false);
  }
  return (
    <div className="field">
      <span>{label}</span>
      <div className="row">
        {value ? <img src={value} alt="" style={{ width: wide ? 160 : 64, height: 64, objectFit: wide ? "cover" : "contain", borderRadius: 8, border: "1px solid var(--line)", background: "#fafafa" }} /> : <div style={{ width: wide ? 160 : 64, height: 64, borderRadius: 8, border: "1px dashed var(--line-strong)", display: "flex", alignItems: "center", justifyContent: "center", color: "var(--muted)", fontSize: ".78rem" }}>none</div>}
        <label className="btn ghost sm" style={{ cursor: "pointer" }}>{busy ? "Uploading…" : value ? "Change" : "Upload"}<input type="file" accept="image/png,image/jpeg,image/gif,image/webp" hidden onChange={pick} /></label>
        {value && <button type="button" className="btn ghost sm" onClick={() => onChange("")}>Remove</button>}
      </div>
      {hint && <small>{hint}</small>}
    </div>
  );
}

export function BrandingCard() {
  const { can } = useDash();
  const settings = useApi(can("settings.manage") ? "/admin/settings" : null);
  const products = useApi(can("settings.manage") ? "/admin/products" : null);
  const [s, setS] = useState(null);
  useEffect(() => { if (settings.data) setS({ logoUrl: settings.data.settings.logoUrl || "", bannerUrl: settings.data.settings.bannerUrl || "", categoryImages: settings.data.settings.categoryImages || {} }); }, [settings.data]);
  if (!can("settings.manage")) return null;
  if (!s || !products.data) return <Loading />;
  const cats = [...new Set(products.data.products.map((p) => p.category).filter(Boolean))].sort();
  const save = () => act(() => api("/admin/settings", { method: "PATCH", body: { logoUrl: s.logoUrl, bannerUrl: s.bannerUrl, categoryImages: Object.fromEntries(Object.entries(s.categoryImages).filter(([k, v]) => v && cats.includes(k))) } }), "Pictures saved");
  return (
    <div className="card" style={{ marginTop: 16 }}>
      <h2>Store pictures</h2>
      <p className="muted">Make your store look like yours. Images are PNG, JPG, GIF or WEBP up to 2.5 MB.</p>
      <div className="grid g2">
        <PicturePicker label="Logo" hint="Shown in the top bar. A wide logo on a transparent background works best." value={s.logoUrl} onChange={(v) => setS({ ...s, logoUrl: v })} />
        <PicturePicker label="Home page banner" hint="A wide photo behind your welcome text, about 1600 × 600." value={s.bannerUrl} wide onChange={(v) => setS({ ...s, bannerUrl: v })} />
      </div>
      {cats.length > 0 && <><h3 style={{ margin: "8px 0" }}>Category pictures</h3>
        <div className="grid g2">{cats.map((c) => <PicturePicker key={c} label={c} value={s.categoryImages[c] || ""} onChange={(v) => setS({ ...s, categoryImages: { ...s.categoryImages, [c]: v } })} />)}</div></>}
      <button className="btn" onClick={save}>Save pictures</button>
    </div>
  );
}

// ---------- Custom CSS for the storefront (STO-08) ----------
export function CssCard() {
  const { flags, can } = useDash();
  const { data } = useApi(can("settings.manage") && flags["STO-08"] ? "/admin/settings" : null);
  const [css, setCss] = useState("");
  useEffect(() => { if (data) setCss(data.settings.customCss || ""); }, [data]);
  if (!can("settings.manage")) return null;
  if (!flags["STO-08"]) return <Locked title="Custom CSS" id="STO-08" />;
  return (
    <div className="card" style={{ marginTop: 16 }}>
      <h2>Custom CSS</h2>
      <p className="muted">Fine-tune how your storefront looks. Scripts, imports and external addresses are removed for safety.</p>
      <textarea value={css} onChange={(e) => setCss(e.target.value)} style={{ fontFamily: "ui-monospace, Consolas, monospace", minHeight: 130 }} placeholder={".s-hero h1 { letter-spacing: -0.03em; }"} maxLength={10000} />
      <button className="btn" style={{ marginTop: 8 }} onClick={() => act(() => api("/admin/settings", { method: "PATCH", body: { customCss: css } }), "Custom CSS saved")}>Save CSS</button>
    </div>
  );
}

// ---------- Sign-in IP allow-list (SEC-04) ----------
export function IpCard() {
  const { flags, can } = useDash();
  const { data, reload } = useApi(can("settings.manage") && flags["SEC-04"] ? "/admin/security/ip-allowlist" : null);
  const [text, setText] = useState("");
  useEffect(() => { if (data) setText(data.ips.join("\n")); }, [data]);
  if (!can("settings.manage")) return null;
  if (!flags["SEC-04"]) return <Locked title="Sign-in IP allow-list" id="SEC-04" />;
  if (!data) return <Loading />;
  const save = () => act(async () => { await api("/admin/security/ip-allowlist", { method: "PUT", body: { ips: text.split(/[\s,;]+/).filter(Boolean) } }); reload(); }, "Allow-list saved");
  return (
    <div className="card" style={{ marginTop: 16 }}>
      <h2>Sign-in IP allow-list</h2>
      <p className="muted">Only these network addresses can use your dashboard. Leave it empty to allow everyone. Your current address is <code>{data.yourIp}</code>, and it must stay in the list.</p>
      <textarea value={text} onChange={(e) => setText(e.target.value)} placeholder={"203.0.113.9\n198.51.100.20"} style={{ minHeight: 90, fontFamily: "ui-monospace, Consolas, monospace" }} />
      <div className="row" style={{ marginTop: 8 }}><button className="btn" onClick={save}>Save list</button><button className="btn ghost" onClick={() => setText((t) => (t.includes(data.yourIp) ? t : (t ? t + "\n" : "") + data.yourIp))}>Add my address</button></div>
    </div>
  );
}

// ---------- Webhooks (PLT-05) ----------
export function WebhooksCard() {
  const { flags, can } = useDash();
  const { data, reload } = useApi(can("settings.manage") && flags["PLT-05"] ? "/admin/webhooks" : null);
  const [url, setUrl] = useState(""); const [events, setEvents] = useState(["order.created"]); const [secret, setSecret] = useState(null);
  if (!can("settings.manage")) return null;
  if (!flags["PLT-05"]) return <Locked title="Webhooks" id="PLT-05" />;
  if (!data) return <Loading />;
  async function add(e) {
    e.preventDefault();
    const r = await act(() => api("/admin/webhooks", { method: "POST", body: { url, events } }));
    if (r && r !== true) { setSecret(r.secret); setUrl(""); reload(); }
  }
  const test = (id) => act(async () => { const r = await api(`/admin/webhooks/${id}/test`, { method: "POST" }); if (!r.ok) throw new Error(`Delivery failed: ${r.error || r.status}`); reload(); }, "Test event delivered");
  return (
    <div className="card" style={{ marginTop: 16 }}>
      <h2>Webhooks</h2>
      <p className="muted">Get a signed message at your own address whenever something happens in your store, for example to update your accounting system. Each message carries an <code>X-Webhook-Signature</code> header (HMAC-SHA256 of the body with your secret).</p>
      {data.webhooks.map((h) => (
        <div key={h._id} style={{ padding: "8px 0", borderTop: "1px solid var(--line)" }}>
          <div className="row between"><span><code>{h.url}</code> {h.lastDelivery && (h.lastDelivery.ok ? <Badge tone="green">last delivery ok</Badge> : <Badge tone="red">last delivery failed</Badge>)}</span>
            <span className="row"><button className="btn ghost sm" onClick={() => test(h._id)}>Send test</button>
              <button className="btn ghost sm" onClick={() => act(async () => { await api(`/admin/webhooks/${h._id}`, { method: "DELETE" }); reload(); }, "Webhook deleted")}>Delete</button></span></div>
          <div className="muted small">{h.events.join(", ")}{h.lastDelivery && ` · ${fmtDate(h.lastDelivery.at)}`}</div>
        </div>))}
      <form onSubmit={add} style={{ marginTop: 12 }}>
        <Field label="Your endpoint address" hint="Must start with https:// and be reachable from the internet."><input value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://example.com/webhooks/shop" required /></Field>
        <div className="row" style={{ marginBottom: 10 }}>{data.events.map((ev) => <label key={ev} className="chk"><input type="checkbox" checked={events.includes(ev)} onChange={(e) => setEvents(e.target.checked ? [...events, ev] : events.filter((x) => x !== ev))} />{ev}</label>)}</div>
        <button className="btn" disabled={!events.length}>Add webhook</button>
      </form>
      {secret && (
        <Modal title="Save your signing secret" onClose={() => setSecret(null)}>
          <p>This secret is shown only once. Use it to check that messages really come from your store.</p>
          <input readOnly value={secret} onFocus={(e) => e.target.select()} />
          <div className="row end" style={{ marginTop: 10 }}><button className="btn" onClick={() => { navigator.clipboard?.writeText(secret); notify("Secret copied"); }}>Copy</button></div>
        </Modal>)}
    </div>
  );
}
