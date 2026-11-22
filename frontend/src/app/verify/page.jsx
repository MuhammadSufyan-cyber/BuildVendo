"use client";
import { Suspense, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { api } from "../../lib/api";

function Verify() {
  const token = useSearchParams().get("token") || "";
  const [err, setErr] = useState("");
  useEffect(() => {
    if (!token) { setErr("This link is missing its token."); return; }
    api("/public/verify", { method: "POST", body: { token } })
      .then(() => { try { localStorage.removeItem("start:text"); } catch { /* ignore */ } window.location.href = "/dashboard/builder?auto=1"; })
      .catch((e) => setErr(e.message));
  }, [token]);
  return (
    <div className="public"><div className="authcard" style={{ textAlign: "center" }}>
      <div className="brand" style={{ justifyContent: "center" }}>BuildVendo</div>
      {err ? <><h1>That did not work</h1><p className="error">{err}</p><a className="btn" href="/start">Start again</a></> : <><h1>Opening your store…</h1><p className="muted">Confirming your email.</p></>}
    </div></div>
  );
}
export default function Page() { return <Suspense><Verify /></Suspense>; }
