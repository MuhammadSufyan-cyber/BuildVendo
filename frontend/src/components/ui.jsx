"use client";
import { useCallback, useEffect, useState } from "react";
import { api } from "../lib/api";

export function useApi(path, deps = []) {
  const [state, set] = useState({ data: null, error: null, loading: true });
  const load = useCallback(async () => {
    if (!path) return;
    set((s) => ({ ...s, loading: true }));
    try { set({ data: await api(path), error: null, loading: false }); }
    catch (e) { set({ data: null, error: e, loading: false }); }
  }, [path]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { load(); }, [load, ...deps]); // eslint-disable-line react-hooks/exhaustive-deps
  return { ...state, reload: load };
}

export function notify(message, type = "ok") {
  if (typeof window !== "undefined") window.dispatchEvent(new CustomEvent("toast", { detail: { message, type, id: Math.random() } }));
}

export function Toaster() {
  const [items, setItems] = useState([]);
  useEffect(() => {
    const h = (e) => {
      setItems((a) => [...a, e.detail]);
      setTimeout(() => setItems((a) => a.filter((x) => x.id !== e.detail.id)), 4500);
    };
    window.addEventListener("toast", h);
    return () => window.removeEventListener("toast", h);
  }, []);
  return (
    <div className="toasts" role="status" aria-live="polite">
      {items.map((t) => <div key={t.id} className={`toast ${t.type}`}>{t.message}</div>)}
    </div>
  );
}

export function Modal({ title, onClose, children, wide }) {
  useEffect(() => {
    const k = (e) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", k);
    return () => window.removeEventListener("keydown", k);
  }, [onClose]);
  return (
    <div className="modal-back" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className={`modal ${wide ? "wide" : ""}`} role="dialog" aria-modal="true" aria-label={title}>
        <div className="modal-head"><h3>{title}</h3><button className="btn ghost sm" onClick={onClose} aria-label="Close">✕</button></div>
        <div className="modal-body">{children}</div>
      </div>
    </div>
  );
}

export const Field = ({ label, hint, children }) => (
  <label className="field"><span>{label}</span>{children}{hint && <small>{hint}</small>}</label>
);
export const Badge = ({ tone = "gray", children }) => <span className={`badge ${tone}`}>{children}</span>;
export const Loading = () => <p className="muted">Loading…</p>;
export const ErrorBox = ({ error }) => error ? <p className="error">{error.message}</p> : null;
export const Empty = ({ children }) => <p className="empty">{children}</p>;

const STATUS_TONE = { active: "green", trial: "blue", suspended: "red", deleted: "gray", pending: "amber", paid: "blue", fulfilled: "green", cancelled: "gray", refunded: "red", invited: "amber", open: "amber", closed: "gray", done: "green", failed: "red", running: "blue", queued: "gray", draft: "amber", published: "green", superseded: "gray" };
export const StatusBadge = ({ status }) => <Badge tone={STATUS_TONE[status] || "gray"}>{status}</Badge>;

export function Stat({ label, value, sub }) {
  return <div className="stat"><div className="stat-label">{label}</div><div className="stat-value">{value}</div>{sub && <div className="stat-sub">{sub}</div>}</div>;
}

export function Shell({ brand, nav, current, user, onLogout, banner, children }) {
  return (
    <div className="shell">
      <aside className="side">
        <div className="brand">{brand}</div>
        <nav>
          {nav.map((n) => (
            <a key={n.href} href={n.href} className={current === n.href ? "active" : ""} title={n.locked ? "Not included in your package" : undefined}>
              {n.label}{n.locked && <span className="lock">🔒</span>}
            </a>
          ))}
        </nav>
        <div className="side-foot">
          <div className="who">{user?.name}<small>{user?.email}</small><small>{user?.role}</small></div>
          <button className="btn ghost sm" onClick={onLogout}>Sign out</button>
        </div>
      </aside>
      <main className="main">{banner}{children}</main>
    </div>
  );
}

export function Confirm({ message, onYes, onNo }) {
  return (
    <Modal title="Please confirm" onClose={onNo}>
      <p>{message}</p>
      <div className="row end"><button className="btn ghost" onClick={onNo}>Cancel</button><button className="btn danger" onClick={onYes}>Yes, continue</button></div>
    </Modal>
  );
}

// Run an async action with a toast; returns true on success
export async function act(fn, okMsg) {
  try { const r = await fn(); if (okMsg) notify(okMsg); return r === undefined ? true : r; }
  catch (e) { notify(e.message, "err"); return false; }
}
