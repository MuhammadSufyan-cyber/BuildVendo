"use client";
import { useState } from "react";
import { useApi, Modal, Field, Badge, Loading, ErrorBox, Empty, Confirm, act, notify } from "../../../components/ui";
import { api, fmtDate, readImage } from "../../../lib/api";
import { useDash, Locked } from "../../../components/DashCtx";

export default function Blog() {
  const { flags, user } = useDash();
  const on = !!flags["STO-04"];
  const { data, error, loading, reload } = useApi(on ? "/admin/blog" : null);
  const [edit, setEdit] = useState(null); const [del, setDel] = useState(null);
  if (!on) return <Locked feature="STO-04" name="Blog" />;
  async function open(p) {
    if (!p) return setEdit({ title: "", excerpt: "", body: "", image: "", status: "draft" });
    const r = await act(() => api(`/admin/blog/${p._id}`));
    if (r && r !== true) setEdit(r.post);
  }
  return (
    <>
      <div className="page-head"><div><h1>Blog</h1><p className="muted">Share news, guides and stories. Published posts appear at <code>/s/{user.tenantId}/blog</code>.</p></div><button className="btn" onClick={() => open(null)}>+ New post</button></div>
      {loading ? <Loading /> : error ? <ErrorBox error={error} /> : !data.posts.length ? <Empty>No posts yet. Write your first one.</Empty> : (
        <div className="tablewrap"><table>
          <thead><tr><th>Title</th><th>Status</th><th>Created</th><th></th></tr></thead>
          <tbody>{data.posts.map((p) => (
            <tr key={p._id}><td><strong>{p.title}</strong><div className="muted small">{p.excerpt}</div></td><td><Badge tone={p.status === "published" ? "green" : "amber"}>{p.status}</Badge></td><td>{fmtDate(p.createdAt)}</td>
              <td className="row"><button className="btn ghost sm" onClick={() => open(p)}>Edit</button><button className="btn ghost sm" onClick={() => setDel(p)}>Delete</button></td></tr>))}</tbody>
        </table></div>)}
      {edit && <Editor post={edit} onClose={() => setEdit(null)} onSaved={() => { setEdit(null); reload(); }} />}
      {del && <Confirm message={`Delete "${del.title}"? This cannot be undone.`} onNo={() => setDel(null)} onYes={() => act(async () => { await api(`/admin/blog/${del._id}`, { method: "DELETE" }); setDel(null); reload(); }, "Post deleted")} />}
    </>
  );
}

function Editor({ post, onClose, onSaved }) {
  const [f, setF] = useState({ title: post.title, excerpt: post.excerpt || "", body: post.body, image: post.image || "", status: post.status });
  const [busy, setBusy] = useState(false);
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });
  async function pick(e) {
    const file = e.target.files[0]; e.target.value = "";
    if (!file) return;
    try { const data = await readImage(file, 2.5); const r = await api("/admin/uploads", { method: "POST", body: { data } }); setF((x) => ({ ...x, image: r.url })); } catch (er) { notify(er.message, "err"); }
  }
  async function save(e) {
    e.preventDefault(); setBusy(true);
    const ok = await act(() => api(post._id ? `/admin/blog/${post._id}` : "/admin/blog", { method: post._id ? "PUT" : "POST", body: f }), "Post saved");
    setBusy(false); if (ok) onSaved();
  }
  return (
    <Modal title={post._id ? "Edit post" : "New post"} onClose={onClose} wide>
      <form onSubmit={save}>
        <Field label="Title"><input value={f.title} onChange={set("title")} required minLength={2} maxLength={140} /></Field>
        <Field label="Short summary" hint="Shown in the list of posts."><input value={f.excerpt} onChange={set("excerpt")} maxLength={300} /></Field>
        <Field label="Text" hint="Plain text. Leave an empty line between paragraphs."><textarea value={f.body} onChange={set("body")} required style={{ minHeight: 240 }} maxLength={20000} /></Field>
        <div className="row" style={{ marginBottom: 12 }}>
          {f.image && <img src={f.image} alt="" style={{ width: 96, height: 64, objectFit: "cover", borderRadius: 8, border: "1px solid var(--line)" }} />}
          <label className="btn ghost sm" style={{ cursor: "pointer" }}>{f.image ? "Change picture" : "Add a picture"}<input type="file" accept="image/png,image/jpeg,image/gif,image/webp" hidden onChange={pick} /></label>
          {f.image && <button type="button" className="btn ghost sm" onClick={() => setF({ ...f, image: "" })}>Remove</button>}
        </div>
        <Field label="Status"><select value={f.status} onChange={set("status")} style={{ maxWidth: 220 }}><option value="draft">Draft (hidden)</option><option value="published">Published (visible)</option></select></Field>
        <div className="row end"><button type="button" className="btn ghost" onClick={onClose}>Cancel</button><button className="btn" disabled={busy}>{busy ? "Saving…" : "Save post"}</button></div>
      </form>
    </Modal>
  );
}
