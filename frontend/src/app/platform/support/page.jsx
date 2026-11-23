"use client";
import { useState } from "react";
import { useApi, Modal, Field, StatusBadge, Loading, ErrorBox, Empty, act } from "../../../components/ui";
import { api, fmtDate } from "../../../lib/api";
import { usePlatform } from "../../../components/PlatformCtx";

export default function Support() {
  const { can } = usePlatform();
  const [tab, setTab] = useState("tickets");
  return (
    <>
      <div className="page-head"><div><h1>Support & broadcasts</h1><p className="muted">Talk to every store admin from one place.</p></div></div>
      <div className="tabs">{[["tickets", "Support inbox"], ["broadcasts", "Broadcast messages"]].map(([k, l]) => <button key={k} className={tab === k ? "on" : ""} onClick={() => setTab(k)}>{l}</button>)}</div>
      {tab === "tickets" ? <Tickets /> : can("platform.broadcast.send") ? <Broadcasts /> : <p className="muted">No permission.</p>}
    </>
  );
}

function Tickets() {
  const { data, error, loading, reload } = useApi("/platform/tickets");
  const [open, setOpen] = useState(null); const [reply, setReply] = useState("");
  if (loading) return <Loading />;
  if (error) return <ErrorBox error={error} />;
  const send = (body) => act(async () => { await api(`/platform/tickets/${open._id}`, { method: "PATCH", body }); setReply(""); setOpen(null); reload(); }, "Updated");
  return (
    <>
      {!data.tickets.length ? <Empty>No tickets yet. Store owners can open them from their dashboard.</Empty> : (
        <div className="tablewrap"><table><thead><tr><th>Subject</th><th>Store</th><th>From</th><th>Status</th><th>Opened</th></tr></thead>
          <tbody>{data.tickets.map((t) => <tr key={t._id} className="clickable" onClick={() => setOpen(t)}><td>{t.subject}</td><td>{t.tenantName}</td><td>{t.from}</td><td><StatusBadge status={t.status} /></td><td>{fmtDate(t.createdAt)}</td></tr>)}</tbody></table></div>
      )}
      {open && (
        <Modal title={open.subject} onClose={() => setOpen(null)} wide>
          {open.messages.map((m, i) => <div key={i} className="card" style={{ marginBottom: 8, background: m.from === "platform" ? "var(--primary-soft)" : "var(--panel-2)" }}><small className="muted">{m.by} · {fmtDate(m.at)}</small><p style={{ margin: "4px 0 0", whiteSpace: "pre-wrap" }}>{m.body}</p></div>)}
          <Field label="Reply"><textarea value={reply} onChange={(e) => setReply(e.target.value)} /></Field>
          <div className="row end">
            <button className="btn ghost" onClick={() => send({ status: open.status === "closed" ? "open" : "closed" })}>{open.status === "closed" ? "Reopen" : "Close ticket"}</button>
            <button className="btn" disabled={!reply.trim()} onClick={() => send({ reply, status: "pending" })}>Send reply</button>
          </div>
        </Modal>
      )}
    </>
  );
}

function Broadcasts() {
  const { data, loading, reload } = useApi("/platform/broadcasts");
  const pk = useApi("/platform/packages");
  const [f, setF] = useState({ title: "", body: "", packages: [] });
  async function send(e) {
    e.preventDefault();
    const r = await act(() => api("/platform/broadcasts", { method: "POST", body: { ...f, packages: f.packages.length ? f.packages : undefined } }));
    if (r && r !== true) { setF({ title: "", body: "", packages: [] }); reload(); }
    if (r && r !== true) window.dispatchEvent(new CustomEvent("toast", { detail: { message: `Sent to ${r.recipients} stores`, type: "ok", id: Math.random() } }));
  }
  return (
    <div className="grid g2">
      <form className="card" onSubmit={send}>
        <h2>New broadcast</h2>
        <Field label="Title"><input value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })} required maxLength={120} /></Field>
        <Field label="Message"><textarea value={f.body} onChange={(e) => setF({ ...f, body: e.target.value })} required /></Field>
        <Field label="Send to" hint="Leave all unticked to send to every active store.">
          {pk.data?.packages.map((p) => <label key={p.key} className="chk"><input type="checkbox" checked={f.packages.includes(p.key)} onChange={(e) => setF({ ...f, packages: e.target.checked ? [...f.packages, p.key] : f.packages.filter((x) => x !== p.key) })} />{p.name} package</label>)}
        </Field>
        <button className="btn">Send broadcast</button>
      </form>
      <div className="card"><h2>History</h2>
        {loading ? <Loading /> : !data.broadcasts.length ? <p className="muted">Nothing sent yet.</p> : data.broadcasts.map((b) => <div key={b._id} style={{ borderBottom: "1px solid var(--line)", padding: "8px 0" }}><strong>{b.title}</strong><div className="muted small">{fmtDate(b.createdAt)} · {b.recipients} stores</div></div>)}
      </div>
    </div>
  );
}
