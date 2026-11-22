"use client";
import { useEffect, useState } from "react";
import { usePathname } from "next/navigation";
import { api } from "../../lib/api";
import { Shell, Loading } from "../../components/ui";

import { PlatformContext } from "../../components/PlatformCtx";

const NAV = [
  { href: "/platform", label: "Overview", perm: "platform.analytics.view" },
  { href: "/platform/tenants", label: "Tenants", perm: "platform.tenants.view" },
  { href: "/platform/payments", label: "Payments", perm: "platform.billing.view" },
  { href: "/platform/packages", label: "Packages", perm: "platform.packages.manage" },
  { href: "/platform/features", label: "Feature flags", perm: "platform.flags.manage" },
  { href: "/platform/support", label: "Support & broadcasts", perm: "platform.tickets.manage" },
  { href: "/platform/audit", label: "Audit log", perm: "platform.audit.view" },
  { href: "/platform/security", label: "Security" },
];

export default function PlatformLayout({ children }) {
  const [user, setUser] = useState(null);
  const path = usePathname();

  useEffect(() => {
    api("/auth/me?scope=platform").then(async (r) => {
      setUser(r.user);
      // when the platform requires 2FA for staff, send them to set it up first
      try { const s = await api("/auth/2fa/status?scope=platform"); if (s.requiredByPlatform && !s.enabled && !window.location.pathname.startsWith("/platform/security")) window.location.href = "/platform/security"; } catch { /* ignore */ }
    }).catch(() => { window.location.href = "/login?scope=platform"; });
  }, []);

  if (!user) return <div className="main"><Loading /></div>;
  const can = (p) => user.perms.includes("*") || user.perms.includes(p);
  const nav = NAV.filter((n) => !n.perm || can(n.perm));
  const current = [...nav].sort((a, b) => b.href.length - a.href.length).find((n) => path === n.href || path.startsWith(n.href + "/"))?.href;
  async function logout() { await api("/auth/logout", { method: "POST", body: { scope: "platform" } }); window.location.href = "/login?scope=platform"; }

  return (
    <PlatformContext.Provider value={{ user, can }}>
      <Shell brand="BuildVendo Admin" nav={nav} current={current} user={user} onLogout={logout}>{children}</Shell>
    </PlatformContext.Provider>
  );
}
