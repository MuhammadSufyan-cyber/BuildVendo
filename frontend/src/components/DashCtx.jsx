"use client";
import { createContext, useContext } from "react";

export const DashContext = createContext(null);
export const useDash = () => useContext(DashContext);

// Shown instead of a page when its feature is not part of the tenant's package.
export function Locked({ feature, name }) {
  return (
    <div className="card" style={{ textAlign: "center", padding: 36 }}>
      <div style={{ fontSize: 40 }}>🔒</div>
      <h2>{name} is not included in your package</h2>
      <p className="muted">This feature (<code>{feature}</code>) is available on a higher package. The server also blocks it, so it cannot be used by other means.</p>
      <a className="btn accent" href="/dashboard/plan">See packages</a>
    </div>
  );
}
