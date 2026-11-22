"use client";
import { Suspense, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { api, money } from "../../../../lib/api";
import { useStore } from "../../../../components/StoreCtx";

function Checkout() {
  const { slug, info, cart, customer, base } = useStore();
  const code = useSearchParams().get("code") || "";
  const [f, setF] = useState({ name: "", email: "", phone: "", line1: "", city: "", postal: "", country: "" });
  const fe = info.features;
  const [pay, setPay] = useState(fe.manual ? "manual" : fe.gateway ? "gateway" : fe.card ? "card" : "cod"); // first way of paying this store offers
  const [pts, setPts] = useState(0); // loyalty points the shopper wants to spend
  const loy = info.features.loyalty;
  const [quote, setQuote] = useState(null); const [err, setErr] = useState(""); const [busy, setBusy] = useState(false); const [done, setDone] = useState(null);
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });

  useEffect(() => { if (customer) setF((x) => ({ ...x, name: x.name || customer.name, email: x.email || customer.email })); }, [customer]);
  useEffect(() => {
    if (!cart.items.length) return;
    // re-price when the country changes (shipping can differ per country); small delay while typing
    const t = setTimeout(() => {
      api(`/store/${slug}/cart/quote`, { method: "POST", body: { items: cart.items.map((i) => ({ productId: i.productId, variantId: i.variantId, qty: i.qty })), ...(code ? { code } : {}), ...(f.country.trim() ? { country: f.country.trim() } : {}), ...(pts > 0 ? { redeemPoints: pts } : {}) } }).then((q) => { setQuote(q); setErr(""); }).catch((e) => setErr(e.message));
    }, 350);
    return () => clearTimeout(t);
  }, [cart.items, code, slug, f.country, pts]);

  async function place(e) {
    e.preventDefault(); setErr(""); setBusy(true);
    try {
      const r = await api(`/store/${slug}/checkout`, { method: "POST", body: {
        items: cart.items.map((i) => ({ productId: i.productId, variantId: i.variantId, qty: i.qty })), ...(code ? { code } : {}), ...(pts > 0 ? { redeemPoints: pts } : {}), paymentMethod: pay,
        customer: { name: f.name, email: f.email, ...(f.phone ? { phone: f.phone } : {}) }, address: { line1: f.line1, city: f.city, country: f.country, ...(f.postal ? { postal: f.postal } : {}) } } });
      if (r.redirectUrl) { window.location.href = r.redirectUrl; return; } // pay on Stripe, come back to /order to confirm
      if (r.payToken) { cart.clear(); window.location.href = `${base}/order?number=${encodeURIComponent(r.order.number)}&t=${r.payToken}`; return; } // transfer / payment link: show how to pay
      setDone(r.order); cart.clear();
    } catch (e2) { setErr(e2.message); }
    setBusy(false);
  }

  if (done) return (
    <div className="s-wrap" style={{ maxWidth: 640 }}>
      <div className="good"><h1 style={{ margin: 0 }}>Thank you! 🎉</h1><p>Your order <strong>#{done.number}</strong> was placed. Total {money(done.total, done.currency)}. {done.status === "pending" ? "Please have the cash ready on delivery." : "Payment received (test payment)."}</p></div>
      <p>Keep your order number{info.features.tracking ? <> and <a href={`${base}/track`}>track your order</a></> : ""}.</p>
      <a className="s-btn" href={base}>Continue shopping</a>
    </div>);
  if (!cart.items.length) return <div className="s-wrap"><h1>Checkout</h1><p>Your cart is empty.</p><a className="s-btn" href={base}>Shop</a></div>;
  if (!customer && !info.features.guestCheckout) return <div className="s-wrap"><h1>Checkout</h1><p>Please <a href={`${base}/account`}>sign in</a> to check out.</p></div>;

  return (
    <div className="s-wrap">
      <h1>Checkout</h1>
      <form className="two" onSubmit={place}>
        <div className="s-card">
          <h2>Contact and delivery</h2>
          <div className="grid g2">
            <label className="field"><span>Full name</span><input value={f.name} onChange={set("name")} required minLength={2} autoComplete="name" /></label>
            <label className="field"><span>Email</span><input type="email" value={f.email} onChange={set("email")} required autoComplete="email" readOnly={!!customer} /></label>
            <label className="field"><span>Phone (optional)</span><input value={f.phone} onChange={set("phone")} autoComplete="tel" /></label>
            <label className="field"><span>Country</span><input value={f.country} onChange={set("country")} required autoComplete="country-name" /></label>
            <label className="field" style={{ gridColumn: "1 / -1" }}><span>Address</span><input value={f.line1} onChange={set("line1")} required minLength={3} autoComplete="street-address" /></label>
            <label className="field"><span>City</span><input value={f.city} onChange={set("city")} required /></label>
            <label className="field"><span>Postal code</span><input value={f.postal} onChange={set("postal")} /></label>
          </div>
          <h2>Payment</h2>
          {fe.manual && <label className="chk"><input type="radio" name="pay" checked={pay === "manual"} onChange={() => setPay("manual")} /> {fe.manual.label} <span className="s-muted small">({fe.manual.methods.map((m) => m.label).join(", ")})</span></label>}
          {fe.gateway && <label className="chk"><input type="radio" name="pay" checked={pay === "gateway"} onChange={() => setPay("gateway")} /> {fe.gateway.label}</label>}
          {fe.card && <label className="chk"><input type="radio" name="pay" checked={pay === "card"} onChange={() => setPay("card")} /> {fe.testCard ? "Pay now (test payment, no real money)" : "Pay by card"}</label>}
          {fe.cod && <label className="chk"><input type="radio" name="pay" checked={pay === "cod"} onChange={() => setPay("cod")} /> Cash on delivery</label>}
          {!fe.manual && !fe.gateway && !fe.card && !fe.cod && <p className="err">This store has not set up a way to pay yet.</p>}
          {pay === "manual" && <p className="small s-muted">After you place the order you will see the account details. Send the money, then upload the reference or a screenshot so the store can confirm it.</p>}
          {pay === "gateway" && <p className="small s-muted">After you place the order you will get a button to pay on the payment page, then confirm here.</p>}
          {fe.testCard && pay === "card" && <p className="small s-muted">Development store: this takes no real money.</p>}
        </div>
        <div className="s-card">
          <h2>Your order</h2>
          {cart.items.map((i) => <div key={i.variantId} className="row between small"><span>{i.qty} × {i.title}{i.vt !== "Default" ? ` (${i.vt})` : ""}</span></div>)}
          {quote && <><hr style={{ borderColor: "var(--s-line)" }} />
            <div className="row between"><span>Subtotal</span><span>{money(quote.subtotal, quote.currency)}</span></div>
            {quote.discount > 0 && <div className="row between"><span>Discount</span><span>−{money(quote.discount, quote.currency)}</span></div>}
            {quote.pointsDiscount > 0 && <div className="row between"><span>Points ({quote.pointsUsed})</span><span>−{money(quote.pointsDiscount, quote.currency)}</span></div>}
            <div className="row between"><span>Shipping</span><span>{quote.shipping ? money(quote.shipping, quote.currency) : "Free"}</span></div>
            <div className="row between" style={{ fontSize: "1.25rem", fontWeight: 800, marginTop: 6 }}><span>Total</span><span>{money(quote.total, quote.currency)}</span></div></>}
          {loy && customer && (customer.points || 0) >= loy.minRedeem && (
            <div style={{ marginTop: 10 }}>
              <label className="field"><span>Use my points (you have {customer.points}, worth {money(customer.points * loy.pointValueCents, quote?.currency || info.currency)})</span>
                <input type="number" min="0" max={customer.points} step="1" value={pts || ""} placeholder={`0 (minimum ${loy.minRedeem})`} onChange={(e) => setPts(Math.max(0, Math.min(customer.points, Number(e.target.value) || 0)))} /></label>
            </div>)}
          {loy && !customer && <p className="small s-muted">Sign in to earn and use loyalty points.</p>}
          {err && <p className="err" style={{ marginTop: 10 }}>{err}</p>}
          <button className="s-btn" style={{ width: "100%", marginTop: 12 }} disabled={busy || !quote}>{busy ? "Placing order…" : "Place order"}</button>
        </div>
      </form>
    </div>
  );
}

export default function Page() {
  return <Suspense><Checkout /></Suspense>;
}
