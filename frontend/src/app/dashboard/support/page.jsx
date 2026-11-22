"use client";
import { useEffect, useState } from "react";
import { useApi, Loading, Field, Empty, StatusBadge, Modal, act } from "../../../components/ui";
import { api, fmtDate } from "../../../lib/api";
import { useDash } from "../../../components/DashCtx";

export default function Support() {
  const { flags } = useDash();
  const news = useApi("/admin/notifications");
  const tickets = useApi(flags["OPS-03"] ? "/admin/tickets" : null);
  const [f, setF] = useState({ subject: "", body: "" }); const [open, setOpen] = useState(null);
  useEffect(() => { if (news.data?.notifications.some((n) => !n.read)) api("/admin/notifications/read", { method: "POST" }).catch(() => {}); }, [news.data]);
  async function send(e) { e.preventDefault(); const ok = await act(() => api("/admin/tickets", { method: "POST", body: f }), "Ticket sent"); if (ok) { setF({ subject: "", body: "" }); tickets.reload(); } }
  return (
    <>
      <div className="page-head"><div><h1>Support & news</h1><p className="muted">Messages from the platform team, and your support requests.</p></div></div>
      <div className="grid g2">
        <div className="card"><h2>Notices from the platform</h2>
          {news.loading ? <Loading /> : !news.data.notifications.length ? <Empty>Nothing yet.</Empty> : news.data.notifications.map((n) => <div key={n._id} style={{ borderBottom: "1px solid var(--line)", padding: "8px 0" }}><strong>{n.title}</strong><div>{n.body}</div><small className="muted">{fmtDate(n.createdAt)}</small></div>)}
        </div>
        <div>
          {flags["OPS-03"] ? (
            <>
              <form className="card" onSubmit={send}><h2>Contact support</h2>
                <Field label="Subject"><input value={f.subject} onChange={(e) => setF({ ...f, subject: e.target.value })} required minLength={3} /></Field>
                <Field label="How can we help?"><textarea value={f.body} onChange={(e) => setF({ ...f, body: e.target.value })} required minLength={3} /></Field>
                <button className="btn">Send</button></form>
              <div className="card"><h2>Your tickets</h2>{tickets.loading ? <Loading /> : !tickets.data.tickets.length ? <p className="muted">No tickets.</p> : tickets.data.tickets.map((t) => <div key={t._id} className="row between" style={{ padding: "6px 0", cursor: "pointer" }} onClick={() => setOpen(t)}><span>{t.subject}</span><StatusBadge status={t.status} /></div>)}</div>
            </>
          ) : <div className="card"><h2>Contact support</h2><p className="muted">🔒 Support tickets are available on higher packages. You can still email the platform team directly.</p></div>}
        </div>
      </div>
      {open && <Modal title={open.subject} onClose={() => setOpen(null)} wide>{open.messages.map((m, i) => <div key={i} className="card" style={{ marginBottom: 8, background: m.from === "platform" ? "#eef4ff" : "#fff" }}><small className="muted">{m.from === "platform" ? "Platform team" : "You"} · {fmtDate(m.at)}</small><p style={{ margin: "4px 0 0", whiteSpace: "pre-wrap" }}>{m.body}</p></div>)}</Modal>}
    </>
  );
}
