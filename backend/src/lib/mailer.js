// Email sending (SRS 16). With SMTP_* set in .env, mail is really sent (nodemailer).
// Without it, mail is printed in the backend console and kept in the "outbox" collection (development only).
const nodemailer = require("nodemailer");
const { getDb } = require("../db");

let transport = null;
function getTransport() {
  if (!process.env.SMTP_HOST) return null;
  if (!transport) {
    transport = nodemailer.createTransport({
      host: process.env.SMTP_HOST, port: Number(process.env.SMTP_PORT) || 587,
      secure: Number(process.env.SMTP_PORT) === 465,
      auth: process.env.SMTP_USER ? { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS } : undefined,
    });
  }
  return transport;
}
const configured = () => !!process.env.SMTP_HOST;
const appUrl = () => process.env.FRONTEND_URL || "http://localhost:3000";
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));

function layout(title, bodyHtml, cta) {
  return `<div style="font-family:system-ui,Arial,sans-serif;max-width:520px;margin:0 auto;padding:24px;color:#202223">
  <h2 style="margin:0 0 12px">${esc(title)}</h2>${bodyHtml}
  ${cta ? `<p style="margin:24px 0"><a href="${cta.url}" style="background:#d9480f;color:#fff;padding:12px 22px;border-radius:8px;text-decoration:none;font-weight:600">${esc(cta.label)}</a></p><p style="font-size:12px;color:#6d7175">If the button does not work, copy this link:<br>${esc(cta.url)}</p>` : ""}</div>`;
}

async function sendMail({ to, subject, text, html }) {
  const from = process.env.MAIL_FROM || "BuildVendo <no-reply@localhost>";
  const t = getTransport();
  if (!t) {
    console.log(`[mail:dev] To: ${to}\n[mail:dev] Subject: ${subject}\n[mail:dev] ${text}\n`);
    try { await getDb().collection("outbox").insertOne({ to, subject, text, createdAt: new Date(), delivered: false }); } catch { /* dev helper only */ }
    return { sent: false };
  }
  try { await t.sendMail({ from, to, subject, text, html }); return { sent: true }; }
  catch (e) { console.error("[mail] send failed:", e.message); return { sent: false, error: true }; }
}

// ---- templates ----
const templates = {
  verify: ({ name, url }) => ({ subject: "Confirm your email to open your store", text: `Hi ${name},\n\nConfirm your email to open your store:\n${url}\n\nThe link works once and expires in 24 hours.`,
    html: layout("Confirm your email", `<p>Hi ${esc(name)}, one click and your store is ready.</p>`, { url, label: "Confirm email" }) }),
  invite: ({ name, store, url }) => ({ subject: `You were invited to ${store}`, text: `Hi ${name},\n\nYou have been invited to ${store}. Choose your password here:\n${url}\n\nThe link works once and expires in 72 hours.`,
    html: layout(`Join ${store}`, `<p>Hi ${esc(name)}, you have been invited. You choose your own password.</p>`, { url, label: "Set my password" }) }),
  reset: ({ url }) => ({ subject: "Reset your password", text: `Reset your password here:\n${url}\n\nThe link works once and expires in 30 minutes. If you did not ask for this, ignore this email.`,
    html: layout("Reset your password", `<p>Use the button below. If you did not ask for this, ignore this email.</p>`, { url, label: "Choose a new password" }) }),
  order: ({ store, order, money }) => ({ subject: `Your ${store} order #${order.number}`,
    text: `Thank you for your order #${order.number}.\n\n${order.lines.map((l) => `${l.qty} x ${l.title}`).join("\n")}\n\nTotal: ${money}\n\n${store}`,
    html: layout(`Thank you! Order #${order.number}`, `<p>${order.lines.map((l) => `${l.qty} &times; ${esc(l.title)}`).join("<br>")}</p><p><strong>Total: ${esc(money)}</strong></p><p>${esc(store)}</p>`) }),
  proofRejected: ({ store, number, reason, url }) => ({ subject: `Payment for order #${number} was not accepted`, text: `${store} could not confirm your payment for order #${number}.
Reason: ${reason}

You can send a new reference or screenshot here:
${url}`,
    html: layout(`Payment not accepted`, `<p>${esc(store)} could not confirm your payment for order #${esc(number)}.</p><p><strong>Reason:</strong> ${esc(reason)}</p>`, { url, label: "Send new payment proof" }) }),
  billingApproved: ({ name, plan, until }) => ({ subject: `Payment approved: ${plan} package`, text: `Hi ${name}, we received your payment. Your ${plan} package is active until ${until}.`, html: layout("Payment approved", `<p>Hi ${esc(name)}, we received your payment.</p><p>Your <strong>${esc(plan)}</strong> package is active until <strong>${esc(until)}</strong>.</p>`) }),
  billingRejected: ({ name, plan, reason }) => ({ subject: `Payment for the ${plan} package was not accepted`, text: `Hi ${name}, we could not confirm your payment for the ${plan} package.
Reason: ${reason}
Please submit it again from Plan & usage.`, html: layout("Payment not accepted", `<p>Hi ${esc(name)}, we could not confirm your payment for the <strong>${esc(plan)}</strong> package.</p><p><strong>Reason:</strong> ${esc(reason)}</p><p>Please submit it again from Plan &amp; usage.</p>`) }),
  returnUpdate: ({ store, number, status, note }) => ({ subject: `Your return for order #${number}: ${status}`, text: [`${store} updated your return request for order #${number}.`, `Status: ${status}`, note || ""].filter(Boolean).join("\n"),
    html: layout(`Return ${status}`, `<p>${esc(store)} updated your return request for order #${esc(number)}.</p><p><strong>Status:</strong> ${esc(status)}</p>${note ? `<p>${esc(note)}</p>` : ""}`) }),
  receipt: ({ name, plan }) => ({ subject: `You are now on the ${plan} package`, text: `Hi ${name}, your package is now ${plan}. Thank you!`, html: layout("Package updated", `<p>Hi ${esc(name)}, your package is now <strong>${esc(plan)}</strong>.</p>`) }),
};

async function send(kind, to, data) {
  const t = templates[kind](data);
  return sendMail({ to, ...t });
}

module.exports = { send, sendMail, configured, appUrl };
