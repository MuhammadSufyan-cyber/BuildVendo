"use client";
import { useState } from "react";
import { useApi, Modal, Field, Badge, Loading, ErrorBox, act } from "../../../components/ui";
import { api, money, PLATFORM_CURRENCY } from "../../../lib/api";

const LIMITS = [["products", "Products"], ["staff", "Staff seats"], ["orders", "Orders / month"], ["storageMB", "Storage (MB)"], ["aiCredits", "AI credits / month"], ["domains", "Custom domains"], ["apiCalls", "API calls / day"], ["transactionFeePct", "Transaction fee %"]];

export default function Packages() {
  const { data, error, loading, reload } = useApi("/platform/packages");
  const [edit, setEdit] = useState(null);
  if (loading) return <Loading />;
  if (error) return <ErrorBox error={error} />;
  const show = (v) => (v < 0 ? "Unlimited" : v);
  return (
    <>
      <div className="page-head"><div><h1>Packages</h1><p className="muted">What you sell. Prices and limits here are proposals from the SRS; adjust freely. -1 means unlimited.</p></div>
        <button className="btn accent" onClick={() => setEdit({ isNew: true, key: "", name: "", priceMonthly: 0, priceYearly: 0, trialDays: 0, limits: {}, cloneFrom: "pro" })}>+ New package</button></div>
      <div className="tablewrap"><table>
        <thead><tr><th>Package</th><th className="num">Monthly</th><th className="num">Yearly</th><th>Trial</th>{LIMITS.slice(0, 5).map(([k, l]) => <th key={k} className="num">{l}</th>)}<th>Features</th><th></th></tr></thead>
        <tbody>{data.packages.map((p) => (
          <tr key={p.key}><td><strong>{p.name}</strong> <code>{p.key}</code> {p.archived && <Badge>archived</Badge>}</td>
            <td className="num">{p.priceMonthly == null ? "Custom" : money(p.priceMonthly * 100, PLATFORM_CURRENCY)}</td><td className="num">{p.priceYearly == null ? "Custom" : money(p.priceYearly * 100, PLATFORM_CURRENCY)}</td>
            <td>{p.trialDays ? `${p.trialDays} days` : "-"}</td>
            {LIMITS.slice(0, 5).map(([k]) => <td key={k} className="num">{show(p.limits[k] ?? 0)}</td>)}
            <td>{Object.values(p.flags || {}).filter(Boolean).length} on</td>
            <td><button className="btn ghost sm" onClick={() => setEdit(p)}>Edit</button></td></tr>))}</tbody>
      </table></div>
      <p className="muted small" style={{ marginTop: 10 }}>Turn individual features on or off for a package in <a href="/platform/features">Feature flags</a>.</p>
      {edit && <Editor pkg={edit} packages={data.packages} onClose={() => setEdit(null)} onSaved={() => { setEdit(null); reload(); }} />}
    </>
  );
}

function Editor({ pkg, packages, onClose, onSaved }) {
  const [f, setF] = useState({ ...pkg, limits: { ...pkg.limits } });
  const num = (v) => (v === "" || v === null ? null : Number(v));
  async function save(e) {
    e.preventDefault();
    const body = { name: f.name, priceMonthly: num(f.priceMonthly), priceYearly: num(f.priceYearly), trialDays: Number(f.trialDays) || 0, limits: Object.fromEntries(Object.entries(f.limits).map(([k, v]) => [k, Number(v) || 0])) };
    const ok = await act(() => f.isNew ? api("/platform/packages", { method: "POST", body: { ...body, key: f.key, cloneFrom: f.cloneFrom || undefined } }) : api(`/platform/packages/${f.key}`, { method: "PATCH", body: { ...body, archived: !!f.archived } }), "Package saved");
    if (ok) onSaved();
  }
  return (
    <Modal title={f.isNew ? "New package" : `Edit ${pkg.name}`} onClose={onClose} wide>
      <form onSubmit={save}>
        <div className="grid g3">
          <Field label="Name"><input value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} required /></Field>
          {f.isNew && <Field label="Key" hint="Lowercase letters, numbers, dashes"><input value={f.key} onChange={(e) => setF({ ...f, key: e.target.value })} pattern="[a-z0-9_-]{2,30}" required /></Field>}
          {f.isNew && <Field label="Copy features and limits from"><select value={f.cloneFrom} onChange={(e) => setF({ ...f, cloneFrom: e.target.value })}><option value="">Nothing</option>{packages.map((p) => <option key={p.key} value={p.key}>{p.name}</option>)}</select></Field>}
          <Field label={`Monthly price (${PLATFORM_CURRENCY})`} hint="Empty = custom pricing"><input type="number" step="0.01" value={f.priceMonthly ?? ""} onChange={(e) => setF({ ...f, priceMonthly: e.target.value })} /></Field>
          <Field label={`Yearly price (${PLATFORM_CURRENCY})`}><input type="number" step="0.01" value={f.priceYearly ?? ""} onChange={(e) => setF({ ...f, priceYearly: e.target.value })} /></Field>
          <Field label="Trial days"><input type="number" min="0" max="90" value={f.trialDays} onChange={(e) => setF({ ...f, trialDays: e.target.value })} /></Field>
        </div>
        <h3 style={{ margin: "8px 0" }}>Limits</h3>
        <div className="grid g4">{LIMITS.map(([k, l]) => <Field key={k} label={l}><input type="number" step="any" value={f.limits[k] ?? 0} onChange={(e) => setF({ ...f, limits: { ...f.limits, [k]: e.target.value } })} /></Field>)}</div>
        {!f.isNew && <label className="chk"><input type="checkbox" checked={!!f.archived} onChange={(e) => setF({ ...f, archived: e.target.checked })} /> Archived (cannot be sold; existing subscribers keep it)</label>}
        <div className="row end"><button type="button" className="btn ghost" onClick={onClose}>Cancel</button><button className="btn">Save</button></div>
      </form>
    </Modal>
  );
}
