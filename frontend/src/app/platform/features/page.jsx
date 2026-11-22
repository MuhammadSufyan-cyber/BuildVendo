"use client";
import { useState } from "react";
import { useApi, Loading, ErrorBox, Badge, act } from "../../../components/ui";
import { api } from "../../../lib/api";

export default function Features() {
  const { data, error, loading, reload } = useApi("/platform/features");
  const [filter, setFilter] = useState(""); const [mod, setMod] = useState("");
  if (loading) return <Loading />;
  if (error) return <ErrorBox error={error} />;
  const modules = [...new Set(data.features.map((f) => f.module))];
  const rows = data.features.filter((f) => (!mod || f.module === mod) && (!filter || (f.id + f.name).toLowerCase().includes(filter.toLowerCase())));
  const toggle = (pkg, id, on) => act(async () => { await api(`/platform/packages/${pkg}/flags/${id}`, { method: "PUT", body: { enabled: on } }); reload(); });
  const kill = (id, killed) => act(async () => { await api(`/platform/features/${id}`, { method: "PATCH", body: { killed } }); reload(); }, killed ? "Kill switch ON: feature disabled for everyone" : "Kill switch off");
  return (
    <>
      <div className="page-head"><div><h1>Feature flags</h1><p className="muted">{data.features.length} features. Tick a cell to include a feature in a package. The kill switch disables a feature for every tenant at once. Changes take effect within a minute.</p></div></div>
      <div className="row" style={{ marginBottom: 10 }}>
        <input style={{ maxWidth: 260 }} placeholder="Filter by ID or name" value={filter} onChange={(e) => setFilter(e.target.value)} />
        <select style={{ maxWidth: 220 }} value={mod} onChange={(e) => setMod(e.target.value)}><option value="">All modules</option>{modules.map((m) => <option key={m}>{m}</option>)}</select>
      </div>
      <div className="tablewrap"><table className="matrix">
        <thead><tr><th>Feature</th>{data.packages.map((p) => <th key={p.key}>{p.name}</th>)}<th>Kill switch</th></tr></thead>
        <tbody>{rows.map((f) => (
          <tr key={f.id}>
            <td><code>{f.id}</code> {f.name} <small className="muted">· {f.module}</small></td>
            {data.packages.map((p) => <td key={p.key}><input type="checkbox" style={{ width: "auto" }} checked={!!p.flags?.[f.id]} onChange={(e) => toggle(p.key, f.id, e.target.checked)} aria-label={`${f.name} in ${p.name}`} /></td>)}
            <td>{f.killed ? <button className="btn danger sm" onClick={() => kill(f.id, false)}>OFF for all: restore</button> : <button className="btn ghost sm" onClick={() => kill(f.id, true)}>Kill</button>}</td>
          </tr>))}</tbody>
      </table></div>
    </>
  );
}
