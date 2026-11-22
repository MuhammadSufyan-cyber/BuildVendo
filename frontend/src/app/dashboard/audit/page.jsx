"use client";
import { useApi, Loading, ErrorBox, Empty, Badge } from "../../../components/ui";
import { fmtDate } from "../../../lib/api";
import { useDash, Locked } from "../../../components/DashCtx";

export default function Audit() {
  const { flags } = useDash();
  const { data, error, loading } = useApi(flags["SEC-02"] ? "/admin/audit" : null);
  if (!flags["SEC-02"]) return <Locked feature="SEC-02" name="Audit log" />;
  return (
    <>
      <div className="page-head"><div><h1>Audit log</h1><p className="muted">Who did what in your store. Includes platform support sessions.</p></div></div>
      {loading ? <Loading /> : error ? <ErrorBox error={error} /> : !data.logs.length ? <Empty>No entries.</Empty> : (
        <div className="tablewrap"><table><thead><tr><th>When</th><th>Who</th><th>Action</th><th>Target</th><th>Reason</th></tr></thead>
          <tbody>{data.logs.map((l) => <tr key={l._id}><td>{fmtDate(l.createdAt)}</td><td>{l.actor?.email}{l.impersonatedBy && <> <Badge tone="amber">platform support</Badge></>}</td><td><code>{l.action}</code></td><td>{l.target}</td><td>{l.reason}</td></tr>)}</tbody></table></div>
      )}
    </>
  );
}
