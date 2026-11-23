"use client";
import { useEffect, useRef, useState } from "react";
import { useApi, Loading, Badge, StatusBadge, Modal, act } from "../../../components/ui";
import { api, money, fmtDate } from "../../../lib/api";
import { useDash, Locked } from "../../../components/DashCtx";

const EXAMPLE = "I want an online shop called Green Leaf that sells organic skincare and soaps in Lahore. Prices in PKR. I want discounts, product reviews and a simple blog. Colours should be green and calm.";

export default function Builder() {
  const { flags, limits, usage, refresh, user } = useDash();
  const specs = useApi(flags["AI-01"] ? "/admin/builder/specs" : null);
  const [text, setText] = useState("");
  const [job, setJob] = useState(null);
  const [view, setView] = useState(null);
  const [msg, setMsg] = useState("");
  const [published, setPublished] = useState(null);
  const poll = useRef(null);

  useEffect(() => () => clearInterval(poll.current), []);
  // arriving from sign-up with the requirements typed on the home page: start building straight away
  useEffect(() => {
    if (!flags["AI-01"] || !new URLSearchParams(window.location.search).get("auto")) return;
    window.history.replaceState(null, "", "/dashboard/builder");
    api("/admin/builder/auto-start", { method: "POST" }).then((r) => { if (r.jobId) { setJob({ state: "queued", progress: 0, step: "Queued" }); watch(r.jobId); } }).catch(() => {});
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  if (!flags["AI-01"]) return <Locked feature="AI-01" name="AI Store Builder" />;

  function watch(jobId) {
    clearInterval(poll.current);
    const tick = async () => {
      try {
        const { job: j } = await api(`/admin/builder/jobs/${jobId}`);
        setJob(j);
        if (j.state === "done" || j.state === "failed") { clearInterval(poll.current); await specs.reload(); refresh(); if (j.state === "done") open(j.version); }
      } catch { clearInterval(poll.current); }
    };
    tick(); poll.current = setInterval(tick, 900);
  }
  async function open(version) { const r = await api(`/admin/builder/specs/${version}`); setView(r.spec); }
  async function start(e) {
    e.preventDefault();
    const r = await act(() => api("/admin/builder/jobs", { method: "POST", body: { requirements: text } }));
    if (r && r !== true) { setView(null); setJob({ state: "queued", progress: 0, step: "Queued" }); watch(r.jobId); }
  }
  async function revise(e) {
    e.preventDefault();
    const r = await act(() => api("/admin/builder/revise", { method: "POST", body: { message: msg } }));
    if (r && r !== true) { setMsg(""); setJob({ state: "queued", progress: 0, step: "Queued" }); watch(r.jobId); }
  }
  async function publish(version) {
    const r = await act(() => api(`/admin/builder/specs/${version}/publish`, { method: "POST" }), `Version ${version} is now live`);
    if (r && r !== true) { setPublished(r); specs.reload(); }
  }

  const spec = view?.spec;
  const creditsLeft = limits.aiCredits < 0 ? "unlimited" : Math.max(0, limits.aiCredits - usage.aiCredits);
  const running = job && (job.state === "queued" || job.state === "running");
  const hasDraft = (specs.data?.specs?.length || 0) > 0;

  return (
    <>
      <div className="page-head"><div><h1>AI Store Builder</h1><p className="muted">Describe your business. Get a store draft you can preview, change by chat, publish, and roll back. AI credits left this month: <strong>{creditsLeft}</strong></p></div></div>

      <div className="grid" style={{ gridTemplateColumns: "minmax(0,1fr) minmax(0,1.4fr)" }}>
        <div>
          <form className="card" onSubmit={start}>
            <h2>{hasDraft ? "Start over with new requirements" : "1. Describe your store"}</h2>
            <textarea value={text} onChange={(e) => setText(e.target.value)} placeholder={EXAMPLE} style={{ minHeight: 150 }} maxLength={10000} required minLength={20} />
            <div className="row between"><button type="button" className="btn ghost sm" onClick={() => setText(EXAMPLE)}>Use example</button><button className="btn accent" disabled={running}>{running ? "Working…" : "Generate store"}</button></div>
            <p className="muted small">Include the business name, what you sell, country and currency, the look you want, and features such as discounts or a blog. Your text is treated only as data about your business.</p>
          </form>
          {hasDraft && (
            <form className="card" onSubmit={revise}>
              <h2>2. Ask for changes</h2>
              <input value={msg} onChange={(e) => setMsg(e.target.value)} placeholder="e.g. make it dark and use a purple colour" minLength={3} required />
              <button className="btn" style={{ marginTop: 8 }} disabled={running}>Apply change</button>
            </form>
          )}
          <div className="card"><h2>Versions</h2>
            {specs.loading ? <Loading /> : !specs.data?.specs.length ? <p className="muted">No drafts yet.</p> : specs.data.specs.map((s) => (
              <div key={s._id} className="row between" style={{ padding: "6px 0", borderBottom: "1px solid var(--line)" }}>
                <div>v{s.version} <StatusBadge status={s.status} /><div className="muted small">{s.spec.storeName} · {fmtDate(s.createdAt)}</div></div>
                <div className="row"><button className="btn ghost sm" onClick={() => open(s.version)}>Preview</button>{s.status !== "published" && <button className="btn sm" onClick={() => publish(s.version)}>{s.status === "superseded" ? "Roll back" : "Publish"}</button>}</div>
              </div>))}
            <p className="muted small" style={{ marginBottom: 0 }}>The last 20 versions are kept.</p>
          </div>
        </div>

        <div>
          {job && (
            <div className="card">
              <div className="row between"><strong>{job.state === "failed" ? "Generation failed" : job.step || "Working"}</strong><StatusBadge status={job.state} /></div>
              <div className="progress" style={{ margin: "10px 0" }}><div style={{ width: `${job.progress || 0}%` }} /></div>
              {job.error && <p className="error">{job.error}</p>}
              {job.note && <p className="muted small">{job.note}</p>}
              {job.state === "done" && <p className="muted small">Generated by <strong>{job.source}</strong> in {(job.durationMs / 1000).toFixed(1)}s · 1 AI credit used</p>}
            </div>
          )}
          {spec ? <Preview v={view} publish={publish} /> : !job && <div className="empty">Your draft preview appears here. Nothing goes live until you press Publish.</div>}
        </div>
      </div>

      {published && (
        <Modal title="Published" onClose={() => setPublished(null)}>
          <p className="ok">Version {published.version} is now live on your storefront.{published.productsAdded > 0 && ` ${published.productsAdded} sample products were added (you can edit or delete them).`}</p>
          {published.featuresNeedingUpgrade?.length > 0 && <p>These suggested features need a higher package: {published.featuresNeedingUpgrade.map((f) => <code key={f} style={{ marginRight: 4 }}>{f}</code>)}</p>}
          <div className="row end"><a className="btn ghost" href="/dashboard/plan">See packages</a><button className="btn" onClick={() => window.open(`/s/${user.tenantId}`, "_blank")}>View storefront</button></div>
        </Modal>
      )}
    </>
  );
}

function Preview({ v, publish }) {
  const s = v.spec, t = s.theme, dark = t.mode === "dark";
  const bg = dark ? "#1f140d" : "#fff8f1", fg = dark ? "#fbeee0" : "#2b1a10";
  return (
    <div className="card" style={{ padding: 0, overflow: "hidden" }}>
      <div className="row between" style={{ padding: "10px 16px", background: "var(--panel-2)" }}><strong>Draft preview · v{v.version}</strong><div className="row"><StatusBadge status={v.status} />{v.status !== "published" && <button className="btn sm" onClick={() => publish(v.version)}>{v.status === "superseded" ? "Roll back to this" : "Publish this version"}</button>}</div></div>
      <div style={{ background: bg, color: fg, fontFamily: t.font === "serif" ? "Georgia, serif" : t.font === "mono" ? "ui-monospace, Consolas, monospace" : "system-ui, sans-serif" }}>
        <div className="row between" style={{ padding: "12px 20px", background: t.primary, color: "#fff" }}><strong style={{ fontSize: "1.15rem" }}>{s.storeName}</strong><span className="small">{s.categories.slice(0, 4).join(" · ")}</span></div>
        <div style={{ padding: "36px 20px", textAlign: "center", background: `linear-gradient(135deg, ${t.primary}22, ${t.accent}33)` }}>
          <h2 style={{ fontSize: "1.7rem", margin: 0 }}>{s.pages.home.hero.headline}</h2><p style={{ opacity: 0.8 }}>{s.pages.home.hero.subhead}</p>
          <span style={{ display: "inline-block", background: t.accent, color: "#fff", padding: "9px 20px", borderRadius: t.style === "bold" ? 0 : 8, fontWeight: 700 }}>{s.pages.home.hero.cta}</span>
        </div>
        <div style={{ padding: 20 }}>
          <h3>Featured products</h3>
          <div className="grid g4">{s.sampleProducts.slice(0, 8).map((p, i) => (
            <div key={i} style={{ border: `1px solid ${dark ? "#2a3445" : "#e3e8f0"}`, borderRadius: 8, padding: 12 }}><div style={{ fontSize: 30 }}>{p.emoji || "🛍️"}</div><div style={{ fontWeight: 600 }}>{p.title}</div><div style={{ opacity: 0.7 }}>{money(p.price, s.currency)}</div></div>))}</div>
          <h3 style={{ marginTop: 18 }}>{s.pages.home.sections.find((x) => x.type === "about")?.title || "About"}</h3><p style={{ opacity: 0.85 }}>{s.pages.about.body}</p>
        </div>
      </div>
      <div style={{ padding: 14 }} className="small muted">
        <div>Currency <strong>{s.currency}</strong> · font {t.font} · style {t.style} · {t.mode} mode · colours <span style={{ background: t.primary, color: "#fff", padding: "0 6px", borderRadius: 4 }}>{t.primary}</span> <span style={{ background: t.accent, color: "#fff", padding: "0 6px", borderRadius: 4 }}>{t.accent}</span></div>
        <div style={{ marginTop: 6 }}>Categories: {s.categories.join(", ")}</div>
        <div style={{ marginTop: 6 }}>Suggested features: {s.flags.map((f) => <code key={f} style={{ marginRight: 4 }}>{f}</code>)}</div>
      </div>
    </div>
  );
}
