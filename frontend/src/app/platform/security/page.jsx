"use client";
import SecurityCard from "../../../components/SecurityCard";

export default function Security() {
  return (
    <>
      <div className="page-head"><div><h1>Security</h1><p className="muted">Protect your Super Admin account.</p></div></div>
      <div style={{ maxWidth: 640 }}><SecurityCard scope="platform" /></div>
    </>
  );
}
