"use client";
import { useState } from "react";
import { useApi, Loading, ErrorBox, Empty, Badge } from "../../../components/ui";
import { fmtDate } from "../../../lib/api";

export default function Audit() {
  const [tenant, setTenant] = useState(""); const [action, setAction] = useState("");
  const qs = new URLSearchParams({ ...(tenant && { tenant }), ...(action && { action }) }).toString();
  const { data, error, loading } = useApi(`/platform/audit?${qs}`);
  return (
    <>
      <div className="page-head"><div><h1>Audit log</h1><p className="muted">Every sensitive platform action. Entries cannot be edited or deleted.</p></div></div>
      <div className="row" style={{ marginBottom: 12 }}>
        <input style={{ maxWidth: 220 }} placeholder="Tenant ID" value={tenant} onChange={(e) => setTenant(e.target.value)} />
        <input style={{ maxWidth: 240 }} placeholder="Action starts with (e.g. tenant.)" value={action} onChange={(e) => setAction(e.target.value)} />
      </div>
      {loading ? <Loading /> : error ? <ErrorBox error={error} /> : !data.logs.length ? <Empty>No entries.</Empty> : (
        <div className="tablewrap"><table>
          <thead><tr><th>When</th><th>Who</th><th>Action</th><th>Target</th><th>Tenant</th><th>Reason</th><th>IP</th></tr></thead>
          <tbody>{data.logs.map((l) => (
            <tr key={l._id}><td>{fmtDate(l.createdAt)}</td><td>{l.actor?.email}{l.impersonatedBy && <> <Badge tone="amber">impersonated</Badge></>}</td><td><code>{l.action}</code></td><td>{l.target}</td><td>{l.tenantId}</td><td>{l.reason}</td><td className="small">{l.ip}</td></tr>))}</tbody>
        </table></div>
      )}
    </>
  );
}
