"use client";
import { useState } from "react";
import { useParams } from "next/navigation";
import { useApi, Modal, Field, StatusBadge, Loading, ErrorBox, Confirm, Stat, act, notify, Badge } from "../../../../components/ui";
import { api, fmtDate } from "../../../../lib/api";
import { usePlatform } from "../../../../components/PlatformCtx";

export default function TenantDetail() {
  const { slug } = useParams();
  const { can } = usePlatform();
  const { data, error, loading, reload } = useApi(`/platform/tenants/${slug}`);
  const pk = useApi("/platform/packages");
  const feats = useApi(can("platform.flags.manage") ? "/platform/features" : null);
  const [tab, setTab] = useState("overview");
  const [imp, setImp] = useState(false); const [reason, setReason] = useState("");
  const [confirm, setConfirm] = useState(null);
  const [link, setLink] = useState(null);

  if (loading) return <Loading />;
  if (error) return <ErrorBox error={error} />;
  const { tenant: t, users, overrides, effective, usage } = data;
  const patch = (body, msg) => act(async () => { await api(`/platform/tenants/${slug}`, { method: "PATCH", body }); reload(); }, msg);

  async function impersonate(e) {
    e.preventDefault();
    const ok = await act(() => api(`/platform/tenants/${slug}/impersonate`, { method: "POST", body: { reason } }));
    if (ok) window.location.href = "/dashboard";
  }

  return (
    <>
      <div className="page-head">
        <div><p className="small"><a href="/platform/tenants">← All tenants</a></p><h1>{t.name} <StatusBadge status={t.status} /></h1><p className="muted">Tenant ID <code>{t.slug}</code> · created {fmtDate(t.createdAt)} · <a href={`/s/${t.slug}`} target="_blank" rel="noreferrer">open storefront ↗</a></p></div>
        <div className="row">
          {can("platform.tenants.impersonate") && t.status !== "deleted" && <button className="btn accent" onClick={() => setImp(true)}>Impersonate admin</button>}
          {can("platform.tenants.suspend") && t.status !== "deleted" && (t.status === "suspended"
            ? <button className="btn" onClick={() => patch({ status: "active" }, "Tenant restored")}>Restore</button>
            : <button className="btn ghost" onClick={() => setConfirm({ msg: "Suspend this store? Its storefront goes offline and admins become read-only.", yes: () => patch({ status: "suspended" }, "Tenant suspended") })}>Suspend</button>)}
          {can("platform.tenants.delete") && t.status !== "deleted" && <button className="btn danger" onClick={() => setConfirm({ msg: "Delete this tenant? It is hidden immediately and its data is purged after 30 days.", yes: () => act(async () => { await api(`/platform/tenants/${slug}`, { method: "DELETE" }); reload(); }, "Tenant deleted (30-day retention)") })}>Delete</button>}
        </div>
      </div>
      <div className="grid g4" style={{ marginBottom: 16 }}>
        <Stat label="Package" value={t.packageId} />
        <Stat label="Products" value={usage.products} sub={`limit ${effective.limits.products < 0 ? "unlimited" : effective.limits.products}`} />
        <Stat label="Orders this month" value={usage.orders} sub={`limit ${effective.limits.orders < 0 ? "unlimited" : effective.limits.orders}`} />
        <Stat label="Staff seats" value={usage.staff} sub={`limit ${effective.limits.staff < 0 ? "unlimited" : effective.limits.staff}`} />
      </div>
      <div className="tabs">{["overview", "admins", "features"].map((x) => <button key={x} className={tab === x ? "on" : ""} onClick={() => setTab(x)}>{x === "overview" ? "Package & status" : x === "admins" ? "Admin accounts" : "Feature overrides"}</button>)}</div>

      {tab === "overview" && (
        <div className="card">
          <h2>Package</h2>
          <div className="row"><select style={{ maxWidth: 240 }} defaultValue={t.packageId} onChange={(e) => patch({ packageId: e.target.value }, "Package changed")} disabled={!can("platform.tenants.suspend")}>
            {pk.data?.packages.map((p) => <option key={p.key} value={p.key}>{p.name}{p.archived ? " (archived)" : ""}</option>)}</select>
            <span className="muted small">Changes apply immediately. Features that are no longer included stop working but data is kept.</span></div>
          {t.trialEndsAt && <p className="muted">Trial ends {fmtDate(t.trialEndsAt)}</p>}
        </div>
      )}

      {tab === "admins" && (
        <div className="tablewrap"><table>
          <thead><tr><th>Name</th><th>Admin ID</th><th>Role</th><th>Status</th><th>Last sign-in</th><th></th></tr></thead>
          <tbody>{users.map((u) => (
            <tr key={u._id}><td>{u.name}</td><td>{u.email}</td><td>{u.role}</td><td><StatusBadge status={u.status} /></td><td>{fmtDate(u.lastLoginAt)}</td>
              <td className="row">
                {can("platform.tenants.suspend") && <button className="btn ghost sm" onClick={() => act(async () => { const r = await api(`/platform/tenants/${slug}/users/${u._id}/reset`, { method: "POST" }); setLink(r.resetUrl); })}>Reset link</button>}
                {can("platform.tenants.suspend") && u.status !== "invited" && <button className="btn ghost sm" onClick={() => act(async () => { await api(`/platform/tenants/${slug}/users/${u._id}`, { method: "PATCH", body: { status: u.status === "active" ? "suspended" : "active" } }); reload(); }, "Updated")}>{u.status === "active" ? "Suspend" : "Activate"}</button>}
              </td></tr>))}</tbody>
        </table></div>
      )}

      {tab === "features" && (can("platform.flags.manage") ? <Overrides slug={slug} feats={feats.data} overrides={overrides} effective={effective} onSaved={reload} /> : <p className="muted">You do not have permission to change feature flags.</p>)}

      {imp && (
        <Modal title="Impersonate store admin" onClose={() => setImp(false)}>
          <form onSubmit={impersonate}>
            <p>You will be signed in as the owner of <strong>{t.name}</strong> for 30 minutes. A banner is shown, every action is tagged as impersonated, and the tenant can see this in its audit log.</p>
            <Field label="Reason (required)"><input value={reason} onChange={(e) => setReason(e.target.value)} minLength={5} required placeholder="e.g. Support ticket #123: payment setup" /></Field>
            <div className="row end"><button type="button" className="btn ghost" onClick={() => setImp(false)}>Cancel</button><button className="btn accent">Start session</button></div>
          </form>
        </Modal>
      )}
      {confirm && <Confirm message={confirm.msg} onNo={() => setConfirm(null)} onYes={() => { const y = confirm.yes; setConfirm(null); y(); }} />}
      {link && <Modal title="Password reset link" onClose={() => setLink(null)}><p>Send this single-use link (valid 24 hours). You never see or set the password.</p><input readOnly value={link} onFocus={(e) => e.target.select()} /><div className="row end"><button className="btn" onClick={() => { navigator.clipboard?.writeText(link); notify("Link copied"); }}>Copy</button></div></Modal>}
    </>
  );
}

function Overrides({ slug, feats, overrides, effective, onSaved }) {
  const [flags, setFlags] = useState(overrides?.flags || {});
  const [limits, setLimits] = useState(overrides?.limits || {});
  const [expires, setExpires] = useState(overrides?.expiresAt ? overrides.expiresAt.slice(0, 10) : "");
  const [reason, setReason] = useState(overrides?.reason || "");
  const [filter, setFilter] = useState("");
  if (!feats) return <Loading />;
  const rows = feats.features.filter((f) => !filter || (f.id + f.name + f.module).toLowerCase().includes(filter.toLowerCase()));
  const state = (id) => (id in flags ? (flags[id] ? "on" : "off") : "inherit");
  function cycle(id) {
    const s = state(id); const n = { ...flags };
    if (s === "inherit") n[id] = true; else if (s === "on") n[id] = false; else delete n[id];
    setFlags(n);
  }
  const save = () => act(async () => {
    await api(`/platform/tenants/${slug}/overrides`, { method: "PUT", body: { flags, limits, reason: reason || undefined, expiresAt: expires ? new Date(expires + "T23:59:59Z").toISOString() : null } }); onSaved();
  }, "Overrides saved");
  return (
    <div className="card">
      <div className="row between"><h2>Overrides for this tenant</h2><button className="btn" onClick={save}>Save overrides</button></div>
      <p className="muted small">Click a feature to cycle: inherit from package, force on, force off. Overrides can expire.</p>
      <div className="grid g3" style={{ marginBottom: 12 }}>
        {["products", "staff", "orders", "aiCredits", "domains"].map((k) => (
          <Field key={k} label={`${k} limit`} hint={`package: ${effective.limits[k]} (-1 = unlimited)`}>
            <input type="number" value={limits[k] ?? ""} placeholder="inherit" onChange={(e) => { const n = { ...limits }; if (e.target.value === "") delete n[k]; else n[k] = Number(e.target.value); setLimits(n); }} /></Field>))}
        <Field label="Expires on"><input type="date" value={expires} onChange={(e) => setExpires(e.target.value)} /></Field>
        <Field label="Reason"><input value={reason} onChange={(e) => setReason(e.target.value)} maxLength={300} /></Field>
      </div>
      <input placeholder="Filter features…" value={filter} onChange={(e) => setFilter(e.target.value)} style={{ maxWidth: 280, marginBottom: 10 }} />
      <div className="tablewrap" style={{ maxHeight: 420, overflowY: "auto" }}><table>
        <thead><tr><th>ID</th><th>Feature</th><th>Effective now</th><th>Override</th></tr></thead>
        <tbody>{rows.map((f) => (
          <tr key={f.id}><td><code>{f.id}</code></td><td>{f.name}<small className="muted"> · {f.module}</small></td>
            <td>{effective.flags[f.id] ? <Badge tone="green">on</Badge> : <Badge>off</Badge>}</td>
            <td><button className="btn ghost sm" onClick={() => cycle(f.id)}>{state(f.id)}</button></td></tr>))}</tbody>
      </table></div>
    </div>
  );
}
