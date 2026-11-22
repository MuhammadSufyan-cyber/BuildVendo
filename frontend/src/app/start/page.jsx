"use client";
import { useEffect, useState } from "react";
import { api, money, PLATFORM_CURRENCY } from "../../lib/api";
import { Field } from "../../components/ui";

const STEPS = ["Describe your store", "Create your account", "Confirm email"];

export default function Start() {
  const [step, setStep] = useState(0);
  const [text, setText] = useState("");
  const [f, setF] = useState({ storeName: "", ownerName: "", email: "", password: "" });
  const [err, setErr] = useState(""); const [busy, setBusy] = useState(false); const [done, setDone] = useState(null); const [sent, setSent] = useState(false);

  // package picked on the pricing cards (/start?plan=pro): explained on the sign-up step
  const [plan, setPlan] = useState(null);
  useEffect(() => {
    const key = new URLSearchParams(window.location.search).get("plan");
    if (!key) return;
    api("/public/packages").then((r) => setPlan(r.packages.find((p) => p.key === key) || null)).catch(() => {});
  }, []);
  const [loaded, setLoaded] = useState(false);
  useEffect(() => { try { setText(localStorage.getItem("start:text") || ""); } catch { /* ignore */ } setLoaded(true); }, []);
  // only save after the first load, otherwise the empty initial value would overwrite what was typed on the home page
  useEffect(() => { if (loaded) { try { localStorage.setItem("start:text", text); } catch { /* ignore */ } } }, [text, loaded]);
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });

  // guess a store name from the description ("called Green Leaf")
  useEffect(() => {
    if (f.storeName) return;
    const m = text.match(/(?:called|named|name is)\s+["“']?([A-Z][\w&' -]{1,30}?)["”']?(?:[.,\n]|\s+(?:and|which|that|with|selling|for|sells)\b|$)/);
    if (m) setF((x) => ({ ...x, storeName: m[1].trim() }));
  }, [text]); // eslint-disable-line react-hooks/exhaustive-deps

  async function signup(e) {
    e.preventDefault(); setErr(""); setBusy(true);
    try {
      const r = await api("/public/signup", { method: "POST", body: { ...f, requirements: text.length >= 20 ? text : undefined } });
      setDone(r); setStep(2);
    } catch (e2) { setErr(e2.message); }
    setBusy(false);
  }
  async function resend() { try { const r = await api("/public/resend-verification", { method: "POST", body: { slug: done.slug, email: f.email } }); setSent(true); if (r.devVerifyUrl) setDone({ ...done, devVerifyUrl: r.devVerifyUrl }); } catch (e2) { setErr(e2.message); } }

  return (
    <div style={{ background: "linear-gradient(180deg, #f6fbf9, #f1f2f4)", minHeight: "100vh" }}>
      <header className="topnav"><div className="inner"><a className="brand" href="/" style={{ color: "inherit", textDecoration: "none" }}>BuildVendo</a><div style={{ flex: 1 }} /><a href="/login?scope=tenant">Already have a store? Sign in</a></div></header>
      <div className="wiz">
        <div className="wiz-steps">{STEPS.map((s, i) => <span key={s} className={i === step ? "on" : i < step ? "done" : ""}>{i < step ? "✓ " : `${i + 1}. `}{s}</span>)}</div>

        {step === 0 && (
          <div className="card" style={{ maxWidth: 760, margin: "0 auto" }}>
            <h1>What do you want to build?</h1>
            <p className="muted">Describe your store in your own words. The more you say, the better the first draft: business name, what you sell, country and currency, colours, and features like discounts, reviews or a blog.</p>
            <textarea value={text} onChange={(e) => setText(e.target.value)} style={{ minHeight: 190, fontSize: "1.02rem" }} placeholder="Example: I want an online shop called Green Leaf that sells organic soaps in Lahore. Prices in PKR, green colours, discounts and reviews." aria-label="Describe your store" />
            <div className="row between" style={{ marginTop: 12 }}>
              <span className="muted small">{text.length < 20 ? "Write at least a sentence, or skip and build later." : "Looks good."}</span>
              <div className="row"><button className="btn ghost" onClick={() => { setText(""); setStep(1); }}>Skip, I will do it later</button><button className="btn" disabled={text.trim().length < 20} onClick={() => setStep(1)}>Continue →</button></div>
            </div>
          </div>
        )}

        {step === 1 && (
          <form className="card" style={{ maxWidth: 560, margin: "0 auto" }} onSubmit={signup}>
            <h1>Create your account</h1>
            <p className="muted">14 days of every feature, free. No card needed.</p>
            {plan && (
              <p className="banner" style={{ display: "block" }}>
                You picked <strong>{plan.name}</strong>{plan.priceMonthly ? <> ({money(plan.priceMonthly * 100, PLATFORM_CURRENCY)} per month)</> : <> (free forever)</>}.
                {plan.priceMonthly ? <> You try everything free for 14 days first. To keep {plan.name} afterwards, send your payment from Plan &amp; usage; otherwise your store moves to the Free package.</> : <> After the 14-day trial your store stays on Free with its limits.</>}
              </p>)}
            <Field label="Store name"><input value={f.storeName} onChange={set("storeName")} required minLength={2} maxLength={60} autoComplete="organization" /></Field>
            <Field label="Your name"><input value={f.ownerName} onChange={set("ownerName")} required minLength={2} autoComplete="name" /></Field>
            <Field label="Email"><input type="email" value={f.email} onChange={set("email")} required autoComplete="email" /></Field>
            <Field label="Password" hint="At least 12 characters. Nobody, including us, can see it."><input type="password" value={f.password} onChange={set("password")} required minLength={12} autoComplete="new-password" /></Field>
            {err && <p className="error">{err}</p>}
            <div className="row between"><button type="button" className="btn ghost" onClick={() => setStep(0)}>← Back</button><button className="btn" disabled={busy}>{busy ? "Creating…" : "Create my store"}</button></div>
          </form>
        )}

        {step === 2 && done && (
          <div className="card" style={{ maxWidth: 600, margin: "0 auto", textAlign: "center" }}>
            <div style={{ fontSize: 46 }}>📬</div>
            <h1>Confirm your email</h1>
            <p>We sent a confirmation link to <strong>{f.email}</strong>. Click it to open your store{text ? " and we will start building it right away" : ""}.</p>
            {done.devVerifyUrl && (
              <div className="banner" style={{ textAlign: "left", flexDirection: "column", alignItems: "stretch" }}>
                <span><strong>Development mode:</strong> no email service is connected yet, so no email was really sent. Use this button instead.</span>
                <a className="btn" href={done.devVerifyUrl}>Confirm email and continue</a>
              </div>)}
            {err && <p className="error">{err}</p>}
            <p className="small muted">Did not get it? <a href="#" onClick={(e) => { e.preventDefault(); resend(); }}>Send it again</a>{sent && " ✓ sent"}</p>
          </div>
        )}
      </div>
    </div>
  );
}
