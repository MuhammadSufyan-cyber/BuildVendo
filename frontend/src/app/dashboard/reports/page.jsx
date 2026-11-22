"use client";
import { useState } from "react";
import { useApi, Loading, ErrorBox, Stat, Empty } from "../../../components/ui";
import { money } from "../../../lib/api";
import { useDash, Locked } from "../../../components/DashCtx";

export default function Reports() {
  const { flags } = useDash();
  const [days, setDays] = useState(30);
  const { data, error, loading } = useApi(flags["ANA-02"] ? `/admin/reports/sales?days=${days}` : null);
  if (!flags["ANA-02"]) return <Locked feature="ANA-02" name="Sales reports" />;
  if (loading) return <Loading />;
  if (error) return <ErrorBox error={error} />;
  const revenue = data.daily.reduce((s, d) => s + d.revenue, 0), orders = data.daily.reduce((s, d) => s + d.orders, 0);
  const max = Math.max(1, ...data.daily.map((d) => d.revenue));
  return (
    <>
      <div className="page-head"><div><h1>Sales reports</h1><p className="muted">Cancelled and refunded orders are excluded.</p></div>
        <select style={{ maxWidth: 160 }} value={days} onChange={(e) => setDays(Number(e.target.value))}>{[7, 30, 90, 365].map((d) => <option key={d} value={d}>Last {d} days</option>)}</select></div>
      <div className="grid g3"><Stat label="Revenue" value={money(revenue)} /><Stat label="Orders" value={orders} /><Stat label="Average order" value={money(orders ? Math.round(revenue / orders) : 0)} /></div>
      <div className="card" style={{ marginTop: 16 }}><h2>Revenue per day</h2>
        {!data.daily.length ? <Empty>No sales in this period.</Empty> : (
          <div style={{ display: "flex", alignItems: "flex-end", gap: 3, height: 160, borderBottom: "1px solid var(--line)" }} role="img" aria-label="Revenue per day bar chart">
            {data.daily.map((d) => <div key={d._id} title={`${d._id}: ${money(d.revenue)} (${d.orders} orders)`} style={{ flex: 1, minWidth: 4, background: "var(--accent)", height: `${(d.revenue / max) * 100}%`, borderRadius: "3px 3px 0 0" }} />)}
          </div>)}
      </div>
      <div className="grid g2" style={{ marginTop: 16 }}>
        <div className="card"><h2>Top products</h2>{!data.top.length ? <p className="muted">No data.</p> : <table><thead><tr><th>Product</th><th className="num">Sold</th><th className="num">Revenue</th></tr></thead><tbody>{data.top.map((t) => <tr key={t._id}><td>{t._id}</td><td className="num">{t.qty}</td><td className="num">{money(t.revenue)}</td></tr>)}</tbody></table>}</div>
        <div className="card"><h2>By channel</h2>{!data.channel.length ? <p className="muted">No data.</p> : <table><thead><tr><th>Channel</th><th className="num">Orders</th><th className="num">Revenue</th></tr></thead><tbody>{data.channel.map((c) => <tr key={c._id}><td>{c._id}</td><td className="num">{c.orders}</td><td className="num">{money(c.revenue)}</td></tr>)}</tbody></table>}</div>
      </div>
    </>
  );
}
