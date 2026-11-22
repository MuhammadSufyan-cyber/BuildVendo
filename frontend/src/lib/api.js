// Small fetch wrapper for the backend API (same-origin through the Next.js rewrite).
export async function api(path, { method = "GET", body, raw } = {}) {
  const res = await fetch(path.startsWith("/api") ? path : `/api${path}`, {
    method,
    credentials: "same-origin",
    headers: body !== undefined ? { "content-type": "application/json" } : undefined,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  if (raw) return res;
  let data = null;
  try { data = await res.json(); } catch { /* empty body */ }
  if (!res.ok) {
    const err = new Error((data && data.error) || `Request failed (${res.status})`);
    err.status = res.status;
    err.data = data;
    throw err;
  }
  return data;
}

// Amounts are stored as integers in minor units (cents).
export function money(cents, currency = "USD") {
  try {
    const whole = (cents || 0) % 100 === 0; // 5000 instead of 5,000.00
    return new Intl.NumberFormat(undefined, { style: "currency", currency, minimumFractionDigits: whole ? 0 : 2, maximumFractionDigits: 2 }).format((cents || 0) / 100);
  } catch {
    return `${currency} ${((cents || 0) / 100).toFixed(2)}`;
  }
}

export const fmtDate = (d) => (d ? new Date(d).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" }) : "-");
export const toCents = (v) => Math.round(Number(v) * 100);
// The currency the platform charges stores in (package prices). Change here and in backend/.env (PLATFORM_CURRENCY).
export const PLATFORM_CURRENCY = "PKR";

// Reads an image file as a data URL for upload. Refuses non-images and files over maxMB.
export function readImage(file, maxMB = 2) {
  return new Promise((resolve, reject) => {
    if (!file) return reject(new Error("No file chosen."));
    if (!/^image\/(png|jpeg|gif|webp)$/.test(file.type)) return reject(new Error("Please choose a PNG, JPG, GIF or WEBP image."));
    if (file.size > maxMB * 1024 * 1024) return reject(new Error(`That image is larger than ${maxMB} MB.`));
    const fr = new FileReader();
    fr.onload = () => resolve(fr.result);
    fr.onerror = () => reject(new Error("Could not read that file."));
    fr.readAsDataURL(file);
  });
}
