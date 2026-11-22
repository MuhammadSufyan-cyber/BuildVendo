"use client";
import { useState } from "react";
import { useApi, Modal, Field, StatusBadge, Loading, ErrorBox, Empty, act, notify, Badge } from "../../../components/ui";
import { api, fmtDate } from "../../../lib/api";
import { useDash } from "../../../components/DashCtx";

export default function Staff() {
  const { flags, can } = useDash();
  const [tab, setTab] = useState("staff");
  return (
    <>
      <div className="page-head"><div><h1>Staff & roles</h1><p className="muted">Who can sign in to your dashboard, and what they can do.</p></div></div>
      <div className="tabs"><button className={tab === "staff" ? "on" : ""} onClick={() => setTab("staff")}>Staff</button><button className={tab === "roles" ? "on" : ""} onClick={() => setTab("roles")}>Roles & permissions {!flags["SEC-03"] && "🔒"}</button></div>
      {tab === "staff" ? <StaffList /> : <Roles enabled={!!flags["SEC-03"]} canEdit={can("roles.manage")} />}
    </>
  );
}

function StaffList() {
  const { data, error, loading, reload } = useApi("/admin/staff");
  const roles = useApi("/admin/roles");
  const { limits, usage } = useDash();
  const [add, setAdd] = useState(false); const [link, setLink] = useState(null);
  if (loading) return <Loading />;
  if (error) return <ErrorBox error={error} />;
  const roleNames = roles.data ? [...roles.data.builtIn.map((r) => r.name).filter((n) => n !== "owner"), ...roles.data.custom.map((r) => r.name)] : [];
  const seats = limits.staff < 0 ? "unlimited" : limits.staff;
  const upd = (id, body) => act(async () => { await api(`/admin/staff/${id}`, { method: "PATCH", body }); reload(); }, "Updated");
  return (
    <>
      <div className="row between" style={{ marginBottom: 10 }}><span className="muted">{usage.staff} of {seats} seats used</span><button className="btn accent" onClick={() => setAdd(true)}>+ Invite staff</button></div>
      {!data.staff.length ? <Empty>No staff.</Empty> : <div className="tablewrap"><table>
        <thead><tr><th>Name</th><th>Admin ID</th><th>Role</th><th>Status</th><th>Last sign-in</th><th></th></tr></thead>
        <tbody>{data.staff.map((u) => (
          <tr key={u._id}><td>{u.name}</td><td>{u.email}</td>
            <td>{u.role === "owner" ? <Badge tone="blue">owner</Badge> : <select value={u.role} onChange={(e) => upd(u._id, { role: e.target.value })} style={{ maxWidth: 150, padding: "4px 8px" }}>{roleNames.map((r) => <option key={r}>{r}</option>)}</select>}</td>
            <td><StatusBadge status={u.status} /></td><td>{fmtDate(u.lastLoginAt)}</td>
            <td className="row">{u.role !== "owner" && <>
              {u.status !== "invited" && <button className="btn ghost sm" onClick={() => upd(u._id, { status: u.status === "active" ? "suspended" : "active" })}>{u.status === "active" ? "Suspend" : "Activate"}</button>}
              <button className="btn ghost sm" onClick={() => upd(u._id, { status: "deleted" })}>Remove</button></>}</td></tr>))}</tbody>
      </table></div>}
      {add && <Invite roles={roleNames} onClose={() => setAdd(false)} onDone={(r) => { setAdd(false); setLink(r.inviteUrl); reload(); }} />}
      {link && <Modal title="Invitation link" onClose={() => setLink(null)}><p>Send this link to the new staff member. It works once and expires in 72 hours. They choose their own password.</p><input readOnly value={link} onFocus={(e) => e.target.select()} /><div className="row end" style={{ marginTop: 10 }}><button className="btn" onClick={() => { navigator.clipboard?.writeText(link); notify("Link copied"); }}>Copy link</button></div></Modal>}
    </>
  );
}

function Invite({ roles, onClose, onDone }) {
  const [f, setF] = useState({ name: "", email: "", role: "cashier" });
  async function save(e) { e.preventDefault(); const r = await act(() => api("/admin/staff", { method: "POST", body: f })); if (r && r !== true) onDone(r); }
  return (
    <Modal title="Invite staff member" onClose={onClose}>
      <form onSubmit={save}>
        <Field label="Name"><input value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} required /></Field>
        <Field label="Email (their Admin ID)"><input type="email" value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} required /></Field>
        <Field label="Role"><select value={f.role} onChange={(e) => setF({ ...f, role: e.target.value })}>{roles.map((r) => <option key={r}>{r}</option>)}</select></Field>
        <div className="row end"><button type="button" className="btn ghost" onClick={onClose}>Cancel</button><button className="btn">Send invitation</button></div>
      </form>
    </Modal>
  );
}

function Roles({ enabled, canEdit }) {
  const { data, loading, error, reload } = useApi("/admin/roles");
  const [name, setName] = useState(""); const [perms, setPerms] = useState([]);
  if (loading) return <Loading />;
  if (error) return <ErrorBox error={error} />;
  const all = data.allPermissions;
  const roles = [...data.builtIn, ...data.custom.map((c) => ({ ...c, custom: true }))];
  return (
    <>
      <div className="tablewrap" style={{ overflowX: "auto" }}><table className="matrix">
        <thead><tr><th>Permission</th>{roles.map((r) => <th key={r.name}>{r.name}</th>)}</tr></thead>
        <tbody>{all.map((p) => <tr key={p}><td><code>{p}</code></td>{roles.map((r) => <td key={r.name}>{r.permissions.includes("*") || r.permissions.includes(p) ? <span className="pill-on">✓</span> : <span className="pill-off">–</span>}</td>)}</tr>)}</tbody>
      </table></div>
      {enabled && canEdit ? (
        <form className="card" style={{ marginTop: 16 }} onSubmit={async (e) => { e.preventDefault(); const ok = await act(() => api("/admin/roles", { method: "POST", body: { name, permissions: perms } }), "Role created"); if (ok) { setName(""); setPerms([]); reload(); } }}>
          <h2>Create a custom role</h2>
          <Field label="Role name" hint="Lowercase letters, numbers, dashes"><input value={name} onChange={(e) => setName(e.target.value)} pattern="[a-z0-9_-]+" required style={{ maxWidth: 260 }} /></Field>
          <div className="grid g3">{all.map((p) => <label key={p} className="chk"><input type="checkbox" checked={perms.includes(p)} onChange={(e) => setPerms(e.target.checked ? [...perms, p] : perms.filter((x) => x !== p))} /><code>{p}</code></label>)}</div>
          <button className="btn" disabled={!perms.length} style={{ marginTop: 10 }}>Create role</button>
        </form>
      ) : <p className="muted" style={{ marginTop: 12 }}>{enabled ? "Only the owner can create roles." : "🔒 Custom roles are available on higher packages (SEC-03)."}</p>}
    </>
  );
}
