"use client";
import { useState } from "react";
import { useApi, Modal, Field, Badge, Loading, ErrorBox, Empty, Confirm, act, notify } from "../../../components/ui";
import { api, money, toCents } from "../../../lib/api";
import { useDash, Locked } from "../../../components/DashCtx";

export default function Products() {
  const { can, flags } = useDash();
  const [q, setQ] = useState("");
  const { data, error, loading, reload } = useApi(`/admin/products?q=${encodeURIComponent(q)}`);
  const [edit, setEdit] = useState(null); const [del, setDel] = useState(null); const [stock, setStock] = useState(null);
  const write = can("products.write");
  const cur = "USD";

  async function importCsv(file) {
    const text = await file.text();
    const lines = text.split(/\r?\n/).filter(Boolean);
    const head = lines.shift().split(",").map((h) => h.trim().replace(/^"|"$/g, "").toLowerCase());
    const rows = lines.map((l) => { const c = l.match(/("([^"]|"")*"|[^,]*)(,|$)/g).map((x) => x.replace(/,$/, "").replace(/^"|"$/g, "").replace(/""/g, '"')); return Object.fromEntries(head.map((h, i) => [h, c[i]])); }).filter((r) => r.title);
    const r = await act(() => api("/admin/products/import", { method: "POST", body: { rows } }));
    if (r && r !== true) { notify(`${r.created} products imported`); reload(); }
  }

  return (
    <>
      <div className="page-head"><div><h1>Products</h1><p className="muted">Your catalog and stock.</p></div>
        <div className="row">
          {flags["CAT-04"] && <><a className="btn ghost" href="/api/admin/products/export" download="products.csv">Export CSV</a>
            {write && <label className="btn ghost" style={{ cursor: "pointer" }}>Import CSV<input type="file" accept=".csv" hidden onChange={(e) => e.target.files[0] && importCsv(e.target.files[0])} /></label>}</>}
          {write && <button className="btn accent" onClick={() => setEdit({})}>+ Add product</button>}
        </div></div>
      <input style={{ maxWidth: 280, marginBottom: 12 }} placeholder="Search products…" value={q} onChange={(e) => setQ(e.target.value)} />
      {loading ? <Loading /> : error ? <ErrorBox error={error} /> : !data.products.length ? <Empty>No products yet. Add one, or generate a store with the AI Store Builder.</Empty> : (
        <div className="tablewrap"><table>
          <thead><tr><th></th><th>Product</th><th>Category</th><th className="num">Price</th><th className="num">Stock</th><th>Status</th><th></th></tr></thead>
          <tbody>{data.products.map((p) => {
            const total = p.variants.reduce((s, v) => s + v.stock, 0);
            return (
              <tr key={p._id}><td style={{ fontSize: 22 }}>{p.images?.[0] ? <img src={p.images[0]} alt="" style={{ width: 38, height: 38, objectFit: "cover", borderRadius: 6 }} /> : p.emoji || "🛍️"}</td><td><strong>{p.title}</strong>{p.variants.length > 1 && <small className="muted"> · {p.variants.length} variants</small>}</td><td>{p.category}</td>
                <td className="num">{money(p.price, cur)}</td><td className="num"><span style={{ color: total === 0 ? "var(--red)" : total <= 5 ? "var(--amber)" : undefined, fontWeight: 600 }}>{total}</span></td>
                <td><Badge tone={p.status === "active" ? "green" : "gray"}>{p.status}</Badge></td>
                <td className="row">{can("inventory.adjust") && <button className="btn ghost sm" onClick={() => setStock(p)}>Stock</button>}{write && <><button className="btn ghost sm" onClick={() => setEdit(p)}>Edit</button><button className="btn ghost sm" onClick={() => setDel(p)}>Delete</button></>}</td></tr>);
          })}</tbody>
        </table></div>
      )}
      {edit && <ProductForm p={edit} flags={flags} onClose={() => setEdit(null)} onSaved={() => { setEdit(null); reload(); }} />}
      {stock && <StockForm p={stock} onClose={() => setStock(null)} onSaved={() => { setStock(null); reload(); }} />}
      {del && <Confirm message={`Delete "${del.title}"? This cannot be undone.`} onNo={() => setDel(null)} onYes={() => act(async () => { await api(`/admin/products/${del._id}`, { method: "DELETE" }); setDel(null); reload(); }, "Product deleted")} />}
    </>
  );
}

function ProductForm({ p, flags, onClose, onSaved }) {
  const isNew = !p._id;
  const [f, setF] = useState({ title: p.title || "", description: p.description || "", category: p.category || "General", emoji: p.emoji || "", status: p.status || "active", images: p.images || [], price: p.price != null ? (p.price / 100).toFixed(2) : "", stock: "0",
    variants: p.variants?.length > 1 || (p.variants?.length === 1 && p.variants[0].title !== "Default") ? p.variants.map((v) => ({ ...v, price: (v.price / 100).toFixed(2) })) : null });
  const [busy, setBusy] = useState(false);
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });
  const setV = (i, k, v) => setF({ ...f, variants: f.variants.map((x, j) => (j === i ? { ...x, [k]: v } : x)) });

  async function upload(file) {
    if (!file) return;
    if (file.size > 3 * 1024 * 1024) return notify("That image is larger than 3 MB.", "err");
    const data = await new Promise((resolve) => { const fr = new FileReader(); fr.onload = () => resolve(fr.result); fr.readAsDataURL(file); });
    const r = await act(() => api("/admin/uploads", { method: "POST", body: { data } }));
    if (r && r !== true) setF((x) => ({ ...x, images: [...x.images, r.url] }));
  }
  async function save(e) {
    e.preventDefault(); setBusy(true);
    const body = { title: f.title, description: f.description, category: f.category, status: f.status, emoji: f.emoji || undefined, images: f.images, price: toCents(f.price || 0) };
    if (f.variants) { body.variants = f.variants.map((v) => ({ id: v.id, sku: v.sku, title: v.title, price: toCents(v.price), stock: Number(v.stock) || 0 })); body.price = body.variants[0].price; }
    else if (isNew) body.stock = Number(f.stock) || 0;
    const ok = await act(() => api(isNew ? "/admin/products" : `/admin/products/${p._id}`, { method: isNew ? "POST" : "PUT", body }), "Product saved");
    setBusy(false); if (ok) onSaved();
  }
  return (
    <Modal title={isNew ? "Add product" : "Edit product"} onClose={onClose} wide>
      <form onSubmit={save}>
        <div className="grid g2">
          <Field label="Title"><input value={f.title} onChange={set("title")} required minLength={2} /></Field>
          <Field label="Category"><input value={f.category} onChange={set("category")} /></Field>
          <Field label="Base price"><input type="number" step="0.01" min="0" value={f.price} onChange={set("price")} required /></Field>
          <Field label="Emoji icon" hint="Shown when there is no image"><input value={f.emoji} onChange={set("emoji")} maxLength={4} /></Field>
        </div>
        <Field label="Description"><textarea value={f.description} onChange={set("description")} /></Field>
        <div className="field"><span>Photos</span>
          <div className="row">{f.images.map((u, i) => (
            <div key={u} style={{ position: "relative" }}><img src={u} alt="" style={{ width: 72, height: 72, objectFit: "cover", borderRadius: 8, border: "1px solid var(--line)" }} />
              <button type="button" className="btn ghost sm" style={{ position: "absolute", top: -8, right: -8, padding: "0 6px" }} aria-label="Remove photo" onClick={() => setF({ ...f, images: f.images.filter((_, j) => j !== i) })}>✕</button></div>))}
            {f.images.length < 10 && <label className="btn ghost" style={{ cursor: "pointer" }}>+ Add photo<input type="file" accept="image/png,image/jpeg,image/gif,image/webp" hidden onChange={(e) => { upload(e.target.files[0]); e.target.value = ""; }} /></label>}
          </div><small className="muted">PNG, JPG, GIF or WEBP, up to 3 MB each. The first photo is the main one.</small></div>
        <div className="grid g2">
          <Field label="Status"><select value={f.status} onChange={set("status")}><option value="active">Active (visible)</option><option value="draft">Draft (hidden)</option></select></Field>
          {!f.variants && isNew && <Field label="Stock"><input type="number" min="0" value={f.stock} onChange={set("stock")} /></Field>}
        </div>
        {flags["CAT-02"] ? (
          <div className="card" style={{ background: "#fafbfe" }}>
            <div className="row between"><h3>Variants</h3>{!f.variants ? <button type="button" className="btn ghost sm" onClick={() => setF({ ...f, variants: [{ title: "Small", price: f.price || "0", stock: 0 }, { title: "Large", price: f.price || "0", stock: 0 }] })}>Use variants</button> : <button type="button" className="btn ghost sm" onClick={() => setF({ ...f, variants: [...f.variants, { title: "", price: f.price || "0", stock: 0 }] })}>+ Add</button>}</div>
            {f.variants && f.variants.map((v, i) => (
              <div className="row" key={i} style={{ marginTop: 8 }}>
                <input placeholder="Option (e.g. Large)" value={v.title} onChange={(e) => setV(i, "title", e.target.value)} required style={{ flex: 2 }} />
                <input type="number" step="0.01" placeholder="Price" value={v.price} onChange={(e) => setV(i, "price", e.target.value)} style={{ flex: 1 }} />
                <input type="number" placeholder="Stock" value={v.stock} onChange={(e) => setV(i, "stock", e.target.value)} style={{ flex: 1 }} />
                {f.variants.length > 1 && <button type="button" className="btn ghost sm" onClick={() => setF({ ...f, variants: f.variants.filter((_, j) => j !== i) })}>✕</button>}
              </div>))}
          </div>
        ) : <p className="muted small">Product variants (size, colour) are available on higher packages.</p>}
        <div className="row end" style={{ marginTop: 12 }}><button type="button" className="btn ghost" onClick={onClose}>Cancel</button><button className="btn" disabled={busy}>{busy ? "Saving…" : "Save product"}</button></div>
      </form>
    </Modal>
  );
}

function StockForm({ p, onClose, onSaved }) {
  const [variantId, setVariantId] = useState(p.variants[0].id); const [delta, setDelta] = useState("0"); const [reason, setReason] = useState("");
  async function save(e) {
    e.preventDefault();
    const ok = await act(() => api("/admin/inventory/adjust", { method: "POST", body: { productId: p._id, variantId, delta: Number(delta), reason: reason || undefined } }), "Stock updated");
    if (ok) onSaved();
  }
  const cur = p.variants.find((v) => v.id === variantId);
  return (
    <Modal title={`Adjust stock: ${p.title}`} onClose={onClose}>
      <form onSubmit={save}>
        <Field label="Option"><select value={variantId} onChange={(e) => setVariantId(e.target.value)}>{p.variants.map((v) => <option key={v.id} value={v.id}>{v.title} (now {v.stock})</option>)}</select></Field>
        <Field label="Change by" hint={`Use a negative number to remove stock. New total: ${cur.stock + (Number(delta) || 0)}`}><input type="number" value={delta} onChange={(e) => setDelta(e.target.value)} required /></Field>
        <Field label="Reason (optional)"><input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="e.g. delivery received" /></Field>
        <div className="row end"><button type="button" className="btn ghost" onClick={onClose}>Cancel</button><button className="btn">Update stock</button></div>
      </form>
    </Modal>
  );
}
