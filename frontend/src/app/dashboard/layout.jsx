"use client";
import { useEffect, useState, useCallback } from "react";
import { usePathname } from "next/navigation";
import { api } from "../../lib/api";
import { Shell, Loading } from "../../components/ui";
import { DashContext } from "../../components/DashCtx";

// perm = permission needed to see the item; flag = feature flag that must be on (otherwise shown locked)
const NAV = [
  { href: "/dashboard", label: "Overview" },
  { href: "/dashboard/products", label: "Products", perm: "products.read" },
  { href: "/dashboard/orders", label: "Orders", perm: "orders.read" },
  { href: "/dashboard/returns", label: "Returns", perm: "orders.refund", flag: "ORD-03" },
  { href: "/dashboard/pos", label: "Point of sale", perm: "pos.operate", flag: "POS-01" },
  { href: "/dashboard/payments", label: "Payments", perm: "orders.refund" },
  { href: "/dashboard/customers", label: "Customers", perm: "customers.read" },
  { href: "/dashboard/discounts", label: "Discounts", perm: "discounts.manage", flag: "MKT-02" },
  { href: "/dashboard/blog", label: "Blog", perm: "products.write", flag: "STO-04" },
  { href: "/dashboard/reports", label: "Reports", perm: "reports.view", flag: "ANA-02" },
  { href: "/dashboard/builder", label: "AI Store Builder", perm: "aibuilder.use", flag: "AI-01" },
  { href: "/dashboard/staff", label: "Staff & roles", perm: "staff.manage" },
  { href: "/dashboard/settings", label: "Settings", perm: "theme.edit" },
  { href: "/dashboard/plan", label: "Plan & usage", perm: "plan.billing.manage" },
  { href: "/dashboard/support", label: "Support & news", perm: "account.manage_self" },
  { href: "/dashboard/security", label: "Security", perm: "account.manage_self" },
  { href: "/dashboard/audit", label: "Audit log", perm: "audit.view", flag: "SEC-02" },
];

export default function DashLayout({ children }) {
  const [user, setUser] = useState(null);
  const [feat, setFeat] = useState(null);
  const path = usePathname();

  const refresh = useCallback(async () => {
    try {
      const [m, f] = await Promise.all([api("/auth/me?scope=tenant"), api("/admin/features")]);
      setUser(m.user); setFeat(f);
    } catch { window.location.href = "/login?scope=tenant"; }
  }, []);
  useEffect(() => { refresh(); }, [refresh]);

  if (!user || !feat) return <div className="main"><Loading /></div>;
  const can = (p) => user.perms.includes("*") || user.perms.includes(p);
  const flags = feat.flags;
  const nav = NAV.filter((n) => !n.perm || can(n.perm)).map((n) => ({ ...n, locked: n.flag && !flags[n.flag] }));
  const current = [...nav].sort((a, b) => b.href.length - a.href.length).find((n) => path === n.href || path.startsWith(n.href + "/"))?.href;

  async function logout() {
    await api("/auth/logout", { method: "POST", body: { scope: "tenant" } });
    window.location.href = user.impersonatedBy ? "/platform" : "/login?scope=tenant";
  }

  const pastDue = feat.billing?.state === "past_due" && !user.impersonatedBy ? (
    <div className="banner"><span><strong>Payment problem.</strong> We could not charge your card for your package. Please update your payment method to avoid losing paid features.</span><a className="btn sm" href="/dashboard/plan">Fix payment</a></div>
  ) : null;
  // package ending soon (or ended): remind the owner to pay again
  const ends = feat.billing?.paidUntil ? new Date(feat.billing.paidUntil) : null;
  const daysLeft = ends ? Math.ceil((ends - Date.now()) / 864e5) : null;
  const renewal = ends && daysLeft <= 7 && feat.package !== "free" && can("plan.billing.manage") && !user.impersonatedBy ? (
    <div className="banner"><span><strong>{daysLeft >= 0 ? `Your package ends in ${daysLeft} day${daysLeft === 1 ? "" : "s"}.` : "Your package period has ended."}</strong> Pay again to keep your features. After a 3-day grace period your store moves to the Free package.</span><a className="btn sm" href="/dashboard/plan">Renew</a></div>
  ) : null;
  const banner = user.impersonatedBy ? (
    <div className="banner"><span><strong>Impersonation session.</strong> You are signed in as this store's owner. Reason: {user.impersonationReason}. Every action is logged and the session ends automatically after 30 minutes.</span><button className="btn sm" onClick={logout}>Exit to platform</button></div>
  ) : pastDue || renewal;

  return (
    <DashContext.Provider value={{ user, can, flags, limits: feat.limits, usage: feat.usage, packageKey: feat.package, packages: feat.packages, billing: feat.billing, refresh }}>
      <Shell brand={user.tenantName || "Store"} nav={nav} current={current} user={user} onLogout={logout} banner={banner}>{children}</Shell>
    </DashContext.Provider>
  );
}
