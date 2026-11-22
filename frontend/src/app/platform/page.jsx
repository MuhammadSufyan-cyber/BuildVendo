"use client";
import { useApi, Stat, Loading, ErrorBox, Badge } from "../../components/ui";
import { money, PLATFORM_CURRENCY } from "../../lib/api";

export default function Overview() {
  const { data, error, loading } = useApi("/platform/overview");
  if (loading) return <Loading />;
  if (error) return <ErrorBox error={error} />;
  return (
    <>
      <div className="page-head"><div><h1>Platform overview</h1><p className="muted">All tenants at a glance. Revenue figures are summed across every store.</p></div></div>
      <div className="grid g4">
        <Stat label="Tenants" value={data.tenants} sub={Object.entries(data.byStatus).map(([k, v]) => `${v} ${k}`).join(" · ")} />
        <Stat label="MRR (subscriptions)" value={money(data.mrr * 100, PLATFORM_CURRENCY)} sub="Active tenants x package price" />
        <Stat label="GMV (all stores)" value={money(data.gmv)} sub={`${data.orders} orders`} />
        <Stat label="AI credits this month" value={data.aiCreditsUsed} />
      </div>
      <div className="card" style={{ marginTop: 16 }}>
        <h2>Tenants by package</h2>
        <div className="row">{Object.entries(data.byPackage).map(([k, v]) => <Badge key={k} tone="blue">{k}: {v}</Badge>)}</div>
      </div>
    </>
  );
}
