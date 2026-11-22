"use client";
import { useState } from "react";
import { useApi, Modal, Field, Badge, Loading, ErrorBox, Empty, act } from "../../../components/ui";
import { api, money, toCents } from "../../../lib/api";
import { useDash, Locked } from "../../../components/DashCtx";

export default function Discounts() {
  const { flags } = useDash();
  const { data, error, loading, reload } = useApi(flags["MKT-02"] ? "/admin/discounts" : null);
  const [add, setAdd] = useState(false);
  if (!flags["MKT-02"]) return <Locked feature="MKT-02" name="Discount codes" />;
  return (
    <>
      <div className="page-head"><div><h1>Discounts</h1><p className="muted">Codes shoppers enter at checkout. Applied and verified on the server.</p></div><button className="btn accent" onClick={() => setAdd(true)}>+ New code</button></div>
      {loading ? <Loading /> : error ? <ErrorBox error={error} /> : !data.discounts.length ? <Empty>No discount codes yet.</Empty> : (
        <div className="tablewrap"><table>
          <thead><tr><th>Code</th><th>Value</th><th>Minimum</th><th className="num">Used</th><th>Status</th><th></th></tr></thead>
          <tbody>{data.discounts.map((d) => (
            <tr key={d._id}><td><code>{d.code}</code>{d.auto && <> <Badge tone="blue">automatic</Badge></>}</td><td>{d.type === "percent" ? `${d.value}% off` : `${money(d.value)} off`}</td><td>{d.minSubtotal ? money(d.minSubtotal) : "-"}</td><td className="num">{d.used}{d.maxUses ? ` / ${d.maxUses}` : ""}</td>
              <td><Badge tone={d.active ? "green" : "gray"}>{d.active ? "active" : "paused"}</Badge></td>
              <td className="row"><button className="btn ghost sm" onClick={() => act(async () => { await api(`/admin/discounts/${d._id}`, { method: "PATCH", body: { active: !d.active } }); reload(); })}>{d.active ? "Pause" : "Activate"}</button>
                <button className="btn ghost sm" onClick={() => act(async () => { await api(`/admin/discounts/${d._id}`, { method: "DELETE" }); reload(); }, "Deleted")}>Delete</button></td></tr>))}</tbody>
        </table></div>
      )}
      {add && <NewCode onClose={() => setAdd(false)} onSaved={() => { setAdd(false); reload(); }} />}
    </>
  );
}

function NewCode({ onClose, onSaved }) {
  const { flags } = useDash();
  const [f, setF] = useState({ code: "", type: "percent", value: "10", minSubtotal: "0", maxUses: "", auto: false });
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });
  async function save(e) {
    e.preventDefault();
    const value = f.type === "percent" ? Number(f.value) : toCents(f.value);
    const ok = await act(() => api("/admin/discounts", { method: "POST", body: { code: f.code, type: f.type, value, minSubtotal: toCents(f.minSubtotal || 0), auto: f.auto, ...(f.maxUses ? { maxUses: Number(f.maxUses) } : {}) } }), "Code created");
    if (ok) onSaved();
  }
  return (
    <Modal title="New discount code" onClose={onClose}>
      <form onSubmit={save}>
        <Field label="Code"><input value={f.code} onChange={set("code")} required minLength={3} placeholder="SUMMER20" /></Field>
        <div className="grid g2">
          <Field label="Type"><select value={f.type} onChange={set("type")}><option value="percent">Percent off</option><option value="fixed">Fixed amount off</option></select></Field>
          <Field label={f.type === "percent" ? "Percent" : "Amount"}><input type="number" step={f.type === "percent" ? "1" : "0.01"} min="1" value={f.value} onChange={set("value")} required /></Field>
          <Field label="Minimum order"><input type="number" step="0.01" min="0" value={f.minSubtotal} onChange={set("minSubtotal")} /></Field>
          <Field label="Max uses" hint="Empty = unlimited"><input type="number" min="1" value={f.maxUses} onChange={set("maxUses")} /></Field>
        </div>
        {flags["MKT-03"] ? <label className="chk"><input type="checkbox" checked={f.auto} onChange={(e) => setF({ ...f, auto: e.target.checked })} /> Apply automatically at checkout (no code needed; the best matching one wins)</label> : <p className="muted small">🔒 Automatic discounts are available on higher packages.</p>}
        <div className="row end"><button type="button" className="btn ghost" onClick={onClose}>Cancel</button><button className="btn">Create</button></div>
      </form>
    </Modal>
  );
}
