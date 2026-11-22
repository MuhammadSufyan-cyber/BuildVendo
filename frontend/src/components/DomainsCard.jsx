"use client";
import { useState } from "react";
import { useApi, Field, Badge, act, notify } from "./ui";
import { api } from "../lib/api";
import { useDash } from "./DashCtx";

// Store address: the free subdomain, plus custom domains verified with a DNS TXT record (PLT-02).
export default function DomainsCard() {
  const { flags, can } = useDash();
  const { data, reload } = useApi(can("settings.manage") && flags["PLT-02"] ? "/admin/domains" : null);
  const [domain, setDomain] = useState(""); const [help, setHelp] = useState(null);
  if (!can("settings.manage")) return null;
  async function add(e) {
    e.preventDefault();
    const r = await act(() => api("/admin/domains", { method: "POST", body: { domain } }));
    if (r && r !== true) { setHelp({ domain: domain.trim().toLowerCase(), ...r.instructions }); setDomain(""); reload(); }
  }
  const verify = (d) => act(async () => { await api(`/admin/domains/${encodeURIComponent(d)}/verify`, { method: "POST" }); setHelp(null); reload(); }, "Domain verified. Your store now opens on it.");
  return (
    <div className="card" style={{ marginTop: 16 }}>
      <h2>Store address</h2>
      {!flags["PLT-02"] ? <p className="muted">🔒 Custom domains are available on higher packages. Your store is always available at <code>/s/your-store-id</code>.</p> : !data ? <p className="muted">Loading…</p> : (
        <>
          <p className="muted">Free address: <code>{data.subdomain}</code> (works when the platform has wildcard DNS set up). You can use {data.max < 0 ? "any number of" : data.max} custom domain(s).</p>
          {data.domains.map((d) => (
            <div key={d.name} className="row between" style={{ padding: "8px 0", borderTop: "1px solid var(--line)" }}>
              <span><strong>{d.name}</strong> {d.verified ? <Badge tone="green">verified</Badge> : <Badge tone="amber">waiting for DNS</Badge>}</span>
              <span className="row">
                {!d.verified && <button className="btn sm" onClick={() => setHelp({ domain: d.name, txtHost: `_commerce-verify.${d.name}`, txtValue: d.token, cname: data.subdomain })}>Show DNS steps</button>}
                {!d.verified && <button className="btn ghost sm" onClick={() => verify(d.name)}>Verify now</button>}
                <button className="btn ghost sm" onClick={() => act(async () => { await api(`/admin/domains/${encodeURIComponent(d.name)}`, { method: "DELETE" }); reload(); }, "Domain removed")}>Remove</button>
              </span>
            </div>))}
          <form className="row" onSubmit={add} style={{ marginTop: 12 }}>
            <input style={{ maxWidth: 320 }} placeholder="shop.yourbrand.com" value={domain} onChange={(e) => setDomain(e.target.value)} required aria-label="Custom domain" />
            <button className="btn">Add domain</button>
          </form>
          {help && (
            <div className="banner" style={{ marginTop: 14, flexDirection: "column", alignItems: "stretch" }}>
              <strong>Connect {help.domain}</strong>
              <span>1. In your domain provider's DNS settings add a <strong>TXT</strong> record: host <code>{help.txtHost}</code>, value <code>{help.txtValue}</code>.</span>
              <span>2. Add a <strong>CNAME</strong> record pointing <code>{help.domain}</code> to <code>{help.cname}</code>.</span>
              <span>3. Wait a few minutes (sometimes hours), then press <strong>Verify now</strong>.</span>
              <button className="btn ghost sm" style={{ alignSelf: "flex-start" }} onClick={() => { navigator.clipboard?.writeText(help.txtValue); notify("TXT value copied"); }}>Copy TXT value</button>
            </div>)}
        </>
      )}
    </div>
  );
}
