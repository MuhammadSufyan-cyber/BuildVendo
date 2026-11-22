"use client";
import SecurityCard from "../../../components/SecurityCard";

export default function Security() {
  return (
    <>
      <div className="page-head"><div><h1>Security</h1><p className="muted">Protect your account. Store owners should turn this on.</p></div></div>
      <div style={{ maxWidth: 640 }}><SecurityCard scope="tenant" /></div>
    </>
  );
}
