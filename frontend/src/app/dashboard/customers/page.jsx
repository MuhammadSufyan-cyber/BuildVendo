"use client";
import { useState } from "react";
import { useApi, Loading, ErrorBox, Empty, Confirm, act } from "../../../components/ui";
import { api, money, fmtDate } from "../../../lib/api";
import { useDash } from "../../../components/DashCtx";

export default function Customers() {
  const { can, flags } = useDash();
  const { data, error, loading, reload } = useApi("/admin/customers");
  const [del, setDel] = useState(null);
  const gdpr = flags["SEC-06"] && can("customers.export");
  return (
    <>
      <div className="page-head"><div><h1>Customers</h1><p className="muted">People who bought from or registered at your store.</p></div>
        {can("customers.export") && <a className="btn ghost" href="/api/admin/customers/export" download="customers.csv">Export CSV</a>}</div>
      {loading ? <Loading /> : error ? <ErrorBox error={error} /> : !data.customers.length ? <Empty>No customers yet.</Empty> : (
        <div className="tablewrap"><table>
          <thead><tr><th>Name</th><th>Email</th><th>Account</th><th className="num">Points</th><th className="num">Orders</th><th className="num">Spent</th><th>Joined</th>{gdpr && <th></th>}</tr></thead>
          <tbody>{data.customers.map((c) => <tr key={c._id}><td>{c.name}</td><td>{c.email}</td><td>{c.hasAccount ? "Registered" : "Guest"}</td><td className="num">{c.points || 0}</td><td className="num">{c.orders}</td><td className="num">{money(c.spent)}</td><td>{fmtDate(c.createdAt)}</td>{gdpr && <td>{!c.deletedAt && <button className="btn ghost sm" onClick={() => setDel(c)}>Erase data</button>}</td>}</tr>)}</tbody>
        </table></div>
      )}
      {del && <Confirm message={`Erase all personal data of ${del.name} (${del.email})? Their orders stay for your accounting but lose names and addresses. This cannot be undone.`} onNo={() => setDel(null)} onYes={() => act(async () => { await api(`/admin/customers/${del._id}`, { method: "DELETE" }); setDel(null); reload(); }, "Customer data erased")} />}
    </>
  );
}
