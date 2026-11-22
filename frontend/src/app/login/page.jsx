"use client";
import { Suspense, useState } from "react";
import { useSearchParams } from "next/navigation";
import { api } from "../../lib/api";
import { Field } from "../../components/ui";

function LoginForm() {
  const sp = useSearchParams();
  const [scope, setScope] = useState(sp.get("scope") === "platform" ? "platform" : "tenant");
  const [tenant, setTenant] = useState(sp.get("tenant") || "");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);
  const [forgot, setForgot] = useState(false);
  const [sent, setSent] = useState(false);
  const [challenge, setChallenge] = useState(null); const [code, setCode] = useState("");

  async function submit(e) {
    e.preventDefault();
    setErr(""); setBusy(true);
    try {
      if (forgot) {
        await api("/auth/password/forgot", { method: "POST", body: { scope, tenantSlug: tenant, email } });
        setSent(true);
      } else if (challenge) {
        await api("/auth/login/2fa", { method: "POST", body: { challenge, code } });
        window.location.href = scope === "platform" ? "/platform" : "/dashboard";
      } else {
        const r = await api("/auth/login", { method: "POST", body: { scope, tenantSlug: tenant, email, password } });
        if (r.twoFactorRequired) { setChallenge(r.challenge); setCode(""); }
        else window.location.href = scope === "platform" ? "/platform" : "/dashboard";
      }
    } catch (e2) { setErr(e2.message); }
    setBusy(false);
  }

  return (
    <div className="public">
      <form className="authcard" onSubmit={submit}>
        <h1>{forgot ? "Reset your password" : "Sign in"}</h1>
        <p className="muted">{scope === "platform" ? "Platform administration" : "Store dashboard"}</p>
        <div className="tabs">
          <button type="button" className={scope === "tenant" ? "on" : ""} onClick={() => setScope("tenant")}>Store</button>
          <button type="button" className={scope === "platform" ? "on" : ""} onClick={() => setScope("platform")}>Platform</button>
        </div>
        {challenge ? (
          <>
            <p className="muted">Open your authenticator app and enter the 6-digit code. Lost your phone? Use one of your recovery codes instead.</p>
            <Field label="Code"><input value={code} onChange={(e) => setCode(e.target.value)} required autoFocus inputMode="text" autoComplete="one-time-code" /></Field>
          </>
        ) : (<>
        {scope === "tenant" && <Field label="Store ID" hint="The Tenant ID given to you, for example demo"><input value={tenant} onChange={(e) => setTenant(e.target.value)} required autoComplete="organization" /></Field>}
        <Field label="Admin ID (email)"><input type="email" value={email} onChange={(e) => setEmail(e.target.value)} required autoComplete="username" /></Field>
        {!forgot && <Field label="Password"><input type="password" value={password} onChange={(e) => setPassword(e.target.value)} required autoComplete="current-password" /></Field>}
        </>)}
        {err && <p className="error">{err}</p>}
        {sent && <p className="ok">If that account exists, a reset link has been sent.</p>}
        <button className="btn block" disabled={busy}>{busy ? "Please wait…" : forgot ? "Send reset link" : challenge ? "Verify and sign in" : "Sign in"}</button>
        <p className="small" style={{ marginTop: 14, textAlign: "center" }}>
          <a href="#" onClick={(e) => { e.preventDefault(); setForgot(!forgot); setSent(false); setErr(""); }}>{forgot ? "Back to sign in" : "Forgot password?"}</a>
          {" · "}<a href="/start">Create a store</a>{" · "}<a href="/">Home</a>
        </p>
      </form>
    </div>
  );
}

export default function Page() {
  return <Suspense><LoginForm /></Suspense>;
}
