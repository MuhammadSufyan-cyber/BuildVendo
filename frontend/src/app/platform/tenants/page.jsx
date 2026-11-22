"use client";
import { useState } from "react";
import { useApi, Modal, Field, StatusBadge, Loading, ErrorBox, Empty, act, notify } from "../../../components/ui";
import { api, money, fmtDate } from "../../../lib/api";
import { usePlatform } from "../../../components/PlatformCtx";

export default function Tenants() {
  const { can } = usePlatform();
  const [q, setQ] = useState(""); const [status, setStatus] = useState(""); const [pkg, setPkg] = useState("");
  const qs = new URLSearchParams({ ...(q && { q }), ...(status && { status }), ...(pkg && { package: pkg }) }).toString();
  const { data, error, loading, reload } = useApi(`/platform/tenants?${qs}`);
  const pk = useApi("/platform/packages");
  const [creating, setCreating] = useState(false);
  const [result, setResult] = useState(null);

  function exportCsv() {
    const rows = [["Tenant ID", "Name", "Status", "Package", "Orders", "GMV", "Created"], ...(data?.tenants || []).map((t) => [t.slug, t.name, t.status, t.packageId, t.orders, (t.gmv / 100).toFixed(2), t.createdAt])];
    const blob = new Blob([rows.map((r) => r.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(",")).join("\n")], { type: "text/csv" });
    const a = document.createElement("a"); a.href = URL.createObjectURL(blob); a.download = "tenants.csv"; a.click();
  }

  return (
    <>
      <div className="page-head">
        <div><h1>Tenants</h1><p className="muted">Every store on the platform.</p></div>
        <div className="row"><button className="btn ghost" onClick={exportCsv}>Export CSV</button>{can("platform.tenants.create") && <button className="btn accent" onClick={() => setCreating(true)}>+ New tenant</button>}</div>
      </div>
      <div className="row" style={{ marginBottom: 12 }}>
        <input style={{ maxWidth: 260 }} placeholder="Search name or Tenant ID" value={q} onChange={(e) => setQ(e.target.value)} />
        <select style={{ maxWidth: 160 }} value={status} onChange={(e) => setStatus(e.target.value)}><option value="">All statuses</option>{["active", "trial", "suspended", "deleted"].map((s) => <option key={s}>{s}</option>)}</select>
        <select style={{ maxWidth: 160 }} value={pkg} onChange={(e) => setPkg(e.target.value)}><option value="">All packages</option>{pk.data?.packages.map((p) => <option key={p.key} value={p.key}>{p.name}</option>)}</select>
      </div>
      {loading ? <Loading /> : error ? <ErrorBox error={error} /> : !data.tenants.length ? <Empty>No tenants match.</Empty> : (
        <div className="tablewrap"><table>
          <thead><tr><th>Store</th><th>Tenant ID</th><th>Status</th><th>Package</th><th className="num">Products</th><th className="num">Orders</th><th className="num">GMV</th><th>Last order</th></tr></thead>
          <tbody>{data.tenants.map((t) => (
            <tr key={t.slug} className="clickable" onClick={() => (window.location.href = `/platform/tenants/${t.slug}`)}>
              <td><strong>{t.name}</strong></td><td><code>{t.slug}</code></td><td><StatusBadge status={t.status} /></td><td>{t.packageId}</td>
              <td className="num">{t.products}</td><td className="num">{t.orders}</td><td className="num">{money(t.gmv)}</td><td>{fmtDate(t.lastOrderAt)}</td>
            </tr>))}</tbody>
        </table></div>
      )}
      {creating && <CreateTenant packages={pk.data?.packages || []} onClose={() => setCreating(false)} onDone={(r) => { setCreating(false); setResult(r); reload(); }} />}
      {result && (
        <Modal title="Tenant created" onClose={() => setResult(null)}>
          <p>Tenant ID: <code>{result.slug}</code></p>
          <p>Send this one-time invitation link to the store owner. It expires in {result.inviteExpiresHours} hours. The owner chooses their own password.</p>
          <input readOnly value={result.inviteUrl} onFocus={(e) => e.target.select()} />
          <p className="small muted">No email service is connected yet, so the link is shown here instead of being emailed.</p>
          <div className="row end"><button className="btn" onClick={() => { navigator.clipboard?.writeText(result.inviteUrl); notify("Link copied"); }}>Copy link</button></div>
        </Modal>
      )}
    </>
  );
}

function CreateTenant({ packages, onClose, onDone }) {
  const [f, setF] = useState({ name: "", slug: "", packageId: "basic", ownerName: "", ownerEmail: "" });
  const [busy, setBusy] = useState(false);
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });
  async function submit(e) {
    e.preventDefault(); setBusy(true);
    const r = await act(() => api("/platform/tenants", { method: "POST", body: { ...f, slug: f.slug || undefined } }));
    setBusy(false);
    if (r && r !== true) onDone(r);
  }
  return (
    <Modal title="New tenant" onClose={onClose}>
      <form onSubmit={submit}>
        <Field label="Store name"><input value={f.name} onChange={set("name")} required /></Field>
        <Field label="Tenant ID" hint="Becomes the store address. Leave empty to generate from the name."><input value={f.slug} onChange={set("slug")} pattern="[a-z0-9-]*" /></Field>
        <Field label="Package"><select value={f.packageId} onChange={set("packageId")}>{packages.filter((p) => !p.archived).map((p) => <option key={p.key} value={p.key}>{p.name}</option>)}</select></Field>
        <Field label="Owner name"><input value={f.ownerName} onChange={set("ownerName")} required /></Field>
        <Field label="Owner email (Admin ID)"><input type="email" value={f.ownerEmail} onChange={set("ownerEmail")} required /></Field>
        <div className="row end"><button type="button" className="btn ghost" onClick={onClose}>Cancel</button><button className="btn" disabled={busy}>{busy ? "Creating…" : "Create tenant"}</button></div>
      </form>
    </Modal>
  );
}
