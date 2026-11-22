"use client";
import { useState } from "react";
import { useApi, Field, act, notify, Loading } from "./ui";
import { api } from "../lib/api";

// Two-factor login setup, used on both the platform and the store dashboard. scope = "platform" | "tenant".
export default function SecurityCard({ scope }) {
  const { data, reload } = useApi(`/auth/2fa/status?scope=${scope}`);
  const [setup, setSetup] = useState(null); const [code, setCode] = useState(""); const [codes, setCodes] = useState(null);
  const [off, setOff] = useState(false); const [pw, setPw] = useState("");
  if (!data) return <Loading />;
  const q = `?scope=${scope}`;

  const start = async () => { const r = await act(() => api(`/auth/2fa/setup${q}`, { method: "POST" })); if (r && r !== true) { setSetup(r); setCode(""); } };
  const enable = async (e) => {
    e.preventDefault();
    const r = await act(() => api(`/auth/2fa/enable${q}`, { method: "POST", body: { code } }), "Two-factor login is on");
    if (r && r !== true) { setCodes(r.recoveryCodes); setSetup(null); reload(); }
  };
  const disable = async (e) => {
    e.preventDefault();
    const ok = await act(() => api(`/auth/2fa/disable${q}`, { method: "POST", body: { password: pw, code } }), "Two-factor login is off");
    if (ok) { setOff(false); setPw(""); setCode(""); reload(); }
  };

  return (
    <div className="card">
      <div className="row between"><h2 style={{ margin: 0 }}>Two-factor login</h2><span className={`badge ${data.enabled ? "green" : "amber"}`}>{data.enabled ? "on" : "off"}</span></div>
      <p className="muted">Adds a second step at sign-in: a 6-digit code from an authenticator app on your phone (Google Authenticator, Microsoft Authenticator, Authy or 1Password). A stolen password alone is then not enough.</p>
      {data.requiredByPlatform && !data.enabled && <p className="error">Platform staff must turn this on before continuing.</p>}

      {codes && (
        <div className="banner" style={{ flexDirection: "column", alignItems: "stretch" }}>
          <strong>Save your recovery codes now. They are shown only once.</strong>
          <span>Each code works one time if you lose your phone. Keep them somewhere safe, not on the same phone.</span>
          <pre style={{ margin: 0 }}>{codes.join("\n")}</pre>
          <div className="row"><button className="btn ghost sm" onClick={() => { navigator.clipboard?.writeText(codes.join("\n")); notify("Codes copied"); }}>Copy</button><button className="btn sm" onClick={() => setCodes(null)}>I saved them</button></div>
        </div>)}

      {!data.enabled && !setup && !codes && <button className="btn" onClick={start}>Set up two-factor login</button>}
      {setup && (
        <form onSubmit={enable}>
          <p><strong>1.</strong> Scan this QR code with your authenticator app.</p>
          <img src={setup.qr} alt="QR code to scan with your authenticator app" width={200} height={200} style={{ border: "1px solid var(--line)", borderRadius: 8 }} />
          <p className="small muted">Cannot scan? Type this key into the app instead: <code>{setup.secret}</code></p>
          <p><strong>2.</strong> Enter the 6-digit code the app shows.</p>
          <Field label="Code"><input value={code} onChange={(e) => setCode(e.target.value)} inputMode="numeric" maxLength={7} required style={{ maxWidth: 160 }} autoComplete="one-time-code" /></Field>
          <div className="row"><button className="btn">Turn on</button><button type="button" className="btn ghost" onClick={() => setSetup(null)}>Cancel</button></div>
        </form>)}

      {data.enabled && !off && <div className="row"><span className="muted small">{data.recoveryCodesLeft} recovery codes left</span><button className="btn ghost" onClick={() => setOff(true)}>Turn off</button></div>}
      {data.enabled && off && (
        <form onSubmit={disable}>
          <Field label="Your password"><input type="password" value={pw} onChange={(e) => setPw(e.target.value)} required autoComplete="current-password" /></Field>
          <Field label="Current code (or a recovery code)"><input value={code} onChange={(e) => setCode(e.target.value)} required style={{ maxWidth: 220 }} autoComplete="one-time-code" /></Field>
          <div className="row"><button className="btn danger">Turn off two-factor login</button><button type="button" className="btn ghost" onClick={() => setOff(false)}>Cancel</button></div>
        </form>)}
    </div>
  );
}
