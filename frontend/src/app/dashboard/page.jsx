"use client";
import { useApi, Stat, Loading, ErrorBox, StatusBadge, Empty } from "../../components/ui";
import { money, fmtDate } from "../../lib/api";
import { useDash } from "../../components/DashCtx";

function Meter({ label, used, max }) {
  const unlimited = max === undefined || max === null || max < 0;
  const pct = unlimited ? 0 : Math.min(100, Math.round((used / Math.max(max, 1)) * 100));
  return (
    <div style={{ marginBottom: 12 }}>
      <div className="row between small"><span>{label}</span><span className="muted">{used} / {unlimited ? "unlimited" : max}</span></div>
      <div className="progress" title={`${pct}%`}><div style={{ width: `${pct}%`, background: pct >= 100 ? "var(--red)" : pct >= 80 ? "var(--amber)" : undefined }} /></div>
      {!unlimited && pct >= 80 && <small style={{ color: pct >= 100 ? "var(--red)" : "var(--amber)" }}>{pct >= 100 ? "Limit reached. " : "Almost at your limit. "}<a href="/dashboard/plan">Upgrade</a></small>}
    </div>
  );
}

export default function Overview() {
  const { data, error, loading } = useApi("/admin/overview");
  const { can } = useDash();
  if (loading) return <Loading />;
  if (error) return <ErrorBox error={error} />;
  const cur = data.currency;
  const steps = [
    ["Add your first products", data.usage.products > 0, "/dashboard/products"],
    ["Customise your store look", false, "/dashboard/settings"],
    ["Receive your first order", Object.keys(data.ordersByStatus).length > 0, "/dashboard/orders"],
  ];
  return (
    <>
      <div className="page-head"><div><h1>{data.tenant.name}</h1><p className="muted">Package: <strong>{data.package.name}</strong>{data.tenant.status === "trial" && <> · trial ends {fmtDate(data.tenant.trialEndsAt)}</>} · <a href={`/s/${data.tenant.slug}`} target="_blank" rel="noreferrer">view storefront ↗</a></p></div></div>
      {data.tenant.status === "suspended" && <p className="error">This store is suspended. Your storefront is offline and the dashboard is read-only. Please contact support.</p>}
      <div className="grid g4">
        <Stat label="Revenue, last 30 days" value={money(data.last30.revenue, cur)} />
        <Stat label="Orders, last 30 days" value={data.last30.orders} />
        <Stat label="Products" value={data.usage.products} />
        <Stat label="Unread notices" value={data.unreadNotifications} sub={<a href="/dashboard/support">Open</a>} />
      </div>
      <div className="grid g2" style={{ marginTop: 16 }}>
        <div className="card"><h2>Recent orders</h2>
          {!data.recentOrders.length ? <Empty>No orders yet.</Empty> : <table><tbody>{data.recentOrders.map((o) => (
            <tr key={o._id}><td>#{o.number}</td><td>{o.customer?.name || "-"}</td><td><StatusBadge status={o.status} /></td><td className="num">{money(o.total, cur)}</td></tr>))}</tbody></table>}
          {can("orders.read") && <p style={{ marginBottom: 0 }}><a href="/dashboard/orders">All orders →</a></p>}
        </div>
        <div className="card"><h2>Usage this month</h2>
          <Meter label="Products" used={data.usage.products} max={data.limits.products} />
          <Meter label="Orders" used={data.usage.orders} max={data.limits.orders} />
          <Meter label="Staff seats" used={data.usage.staff} max={data.limits.staff} />
          <Meter label="AI credits" used={data.usage.aiCredits} max={data.limits.aiCredits} />
        </div>
        <div className="card"><h2>Low stock</h2>
          {!data.lowStock.length ? <p className="muted">Nothing is running low.</p> : <table><tbody>{data.lowStock.map((l, i) => <tr key={i}><td>{l.title} <span className="muted">({l.variant})</span></td><td className="num"><strong style={{ color: l.stock === 0 ? "var(--red)" : "var(--amber)" }}>{l.stock}</strong></td></tr>)}</tbody></table>}
        </div>
        <div className="card"><h2>Get started</h2>
          {steps.map(([t, done, href]) => <div key={t} className="chk">{done ? "✅" : "⬜"} <a href={href}>{t}</a></div>)}
        </div>
      </div>
    </>
  );
}
