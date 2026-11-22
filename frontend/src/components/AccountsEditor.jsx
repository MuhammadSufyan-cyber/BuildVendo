"use client";
import { Field } from "./ui";

export const BLANK_ACCOUNT = { type: "bank", label: "", accountName: "", accountNumber: "", details: "" };
const TYPES = [["bank", "Bank account"], ["jazzcash", "JazzCash"], ["easypaisa", "Easypaisa"], ["other", "Other wallet"]];

// Edits a list of bank / wallet accounts (used for a store's accounts and for the platform's accounts).
export default function AccountsEditor({ methods, onChange }) {
  const set = (i, k, v) => onChange(methods.map((m, j) => (j === i ? { ...m, [k]: v } : m)));
  return (
    <div>
      {methods.map((m, i) => (
        <div key={m.id || i} className="card" style={{ background: "#fafbfb", marginBottom: 10, padding: 14 }}>
          <div className="grid g3">
            <Field label="Type"><select value={m.type} onChange={(e) => set(i, "type", e.target.value)}>{TYPES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select></Field>
            <Field label="Name shown to payers"><input value={m.label} onChange={(e) => set(i, "label", e.target.value)} placeholder="e.g. JazzCash or Bank Alfalah" required maxLength={60} /></Field>
            <Field label="Account holder name"><input value={m.accountName} onChange={(e) => set(i, "accountName", e.target.value)} maxLength={80} /></Field>
            <Field label="Account / IBAN / wallet number"><input value={m.accountNumber} onChange={(e) => set(i, "accountNumber", e.target.value)} required maxLength={60} /></Field>
            <Field label="Extra details (optional)"><input value={m.details} onChange={(e) => set(i, "details", e.target.value)} placeholder="Branch, notes" maxLength={400} /></Field>
          </div>
          <button type="button" className="btn ghost sm" onClick={() => onChange(methods.filter((_, j) => j !== i))}>Remove this account</button>
        </div>))}
      <button type="button" className="btn ghost" onClick={() => onChange([...methods, { ...BLANK_ACCOUNT }])}>+ Add a bank or wallet account</button>
    </div>
  );
}
