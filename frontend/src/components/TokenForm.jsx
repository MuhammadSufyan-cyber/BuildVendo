"use client";
import { Suspense, useState } from "react";
import { useSearchParams } from "next/navigation";
import { api } from "../lib/api";
import { Field } from "./ui";

// Used for both invitations ("invite") and password resets ("reset").
export default function TokenForm({ mode }) {
  const token = useSearchParams().get("token") || "";
  const [password, setPassword] = useState("");
  const [again, setAgain] = useState("");
  const [err, setErr] = useState("");
  const [done, setDone] = useState(null);
  const [busy, setBusy] = useState(false);
  const invite = mode === "invite";

  async function submit(e) {
    e.preventDefault();
    setErr("");
    if (password !== again) return setErr("The two passwords do not match.");
    setBusy(true);
    try {
      const r = await api(invite ? "/auth/invite/accept" : "/auth/password/reset", { method: "POST", body: { token, password } });
      setDone(r);
    } catch (e2) { setErr(e2.message); }
    setBusy(false);
  }

  if (!token) return <div className="public"><div className="authcard"><p className="error">This link is missing its token.</p></div></div>;
  if (done) {
    const href = done.scope === "platform" ? "/login?scope=platform" : `/login?scope=tenant${done.tenantId ? `&tenant=${done.tenantId}` : ""}`;
    return <div className="public"><div className="authcard"><h1>All set</h1><p className="ok">Your password has been saved.</p><a className="btn block" href={href}>Go to sign in</a></div></div>;
  }
  return (
    <div className="public">
      <form className="authcard" onSubmit={submit}>
        <h1>{invite ? "Set your password" : "Choose a new password"}</h1>
        <p className="muted">At least 12 characters. Nobody, including the platform owner, can see your password.</p>
        <Field label="New password"><input type="password" value={password} onChange={(e) => setPassword(e.target.value)} required minLength={12} autoComplete="new-password" /></Field>
        <Field label="Repeat password"><input type="password" value={again} onChange={(e) => setAgain(e.target.value)} required autoComplete="new-password" /></Field>
        {err && <p className="error">{err}</p>}
        <button className="btn block" disabled={busy}>{busy ? "Saving…" : "Save password"}</button>
      </form>
    </div>
  );
}

