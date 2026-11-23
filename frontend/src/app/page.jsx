"use client";
import { useEffect, useState } from "react";
import { api, money, PLATFORM_CURRENCY } from "../lib/api";

const EXAMPLES = [
  ["Fashion boutique", "I want an online fashion boutique called Luna Style selling women's dresses, bags and accessories. Prices in USD. Elegant look with pink and black colours, with discounts and customer reviews."],
  ["Bakery", "I want a shop called Sunrise Bakery that sells fresh cakes, bread and coffee in Lahore. Prices in PKR, cash on delivery, warm brown colours and a simple blog."],
  ["Electronics", "Online store called VoltHub for earphones, smart watches and phone accessories. Modern dark look with blue colours, wishlist and product reviews."],
  ["Skincare", "Natural skincare brand called Green Leaf selling soaps and serums. Calm green colours, discounts and order tracking."],
];

// Small outline icons (24x24, stroke based) so the page needs no icon library.
const ICONS = {
  sparkles: <><path d="M9.9 14.1 12 21l2.1-6.9L21 12l-6.9-2.1L12 3 9.9 9.9 3 12z" /></>,
  bag: <><path d="M6 2 3 6v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V6l-3-4z" /><path d="M3 6h18" /><path d="M16 10a4 4 0 0 1-8 0" /></>,
  card: <><rect x="2" y="5" width="20" height="14" rx="2" /><path d="M2 10h20" /></>,
  receipt: <><path d="M4 2v20l2-1 2 1 2-1 2 1 2-1 2 1 2-1 2 1V2l-2 1-2-1-2 1-2-1-2 1-2-1-2 1z" /><path d="M16 8h-6a2 2 0 1 0 0 4h4a2 2 0 1 1 0 4H8" /><path d="M12 17.5v-11" /></>,
  users: <><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" /><circle cx="9" cy="7" r="4" /><path d="M22 21v-2a4 4 0 0 0-3-3.9" /><path d="M16 3.1a4 4 0 0 1 0 7.8" /></>,
  chart: <><path d="M3 3v18h18" /><path d="M18 17V9" /><path d="M13 17V5" /><path d="M8 17v-3" /></>,
  tag: <><path d="M20.6 13.4 13.4 20.6a2 2 0 0 1-2.8 0L2 12V2h10l8.6 8.6a2 2 0 0 1 0 2.8z" /><circle cx="7" cy="7" r="1" /></>,
  globe: <><circle cx="12" cy="12" r="10" /><path d="M2 12h20" /><path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z" /></>,
};
function Icon({ name }) {
  return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{ICONS[name]}</svg>;
}

const FEATURES = [
  ["sparkles", "AI Store Builder", "Describe it in plain words, preview the draft, change it by chat, publish and roll back. Your whole store appears in about a minute."],
  ["bag", "Products and stock", "Variants, categories, CSV import and low-stock alerts."],
  ["card", "Checkout and payments", "Easypaisa, JazzCash, bank transfer or cash on delivery."],
  ["receipt", "Point of sale", "A cashier screen with receipts that shares stock with your online shop."],
  ["users", "Staff and roles", "Owner, manager, cashier and custom roles with clear permissions."],
  ["chart", "Reports", "Revenue per day, best sellers, web versus in-store sales."],
  ["tag", "Discounts and loyalty", "Promo codes, sale prices and points customers can redeem."],
  ["globe", "Your own domain", "Run your store on your own address, with a free subdomain to start."],
];

export default function Home() {
  const [text, setText] = useState("");
  const [plans, setPlans] = useState([]);
  useEffect(() => { api("/public/packages").then((r) => setPlans(r.packages)).catch(() => {}); }, []);

  function go(e) {
    e?.preventDefault();
    try { localStorage.setItem("start:text", text); } catch { /* storage blocked */ }
    window.location.href = "/start";
  }

  return (
    <>
      <header className="topnav"><div className="inner">
        <a className="brand" href="/" style={{ textDecoration: "none" }}>BuildVendo</a>
        <nav><a href="#how">How it works</a><a href="#features">Features</a><a href="#pricing">Pricing</a><a href="/s/demo">Demo store</a></nav>
        <div className="right"><a href="/login?scope=tenant">Sign in</a><a className="btn sm" href="/start">Start free trial</a></div>
      </div></header>

      <section className="hero">
        <span className="pill"><i /> Launch your online store in minutes</span>
        <h1>Describe your store.<br /><span className="hl">We build it for you.</span></h1>
        <p className="lead">Tell our AI what you want to sell. In a minute you get a complete online store with products, a theme, checkout and a dashboard to run it.</p>
        <form className="promptbox" onSubmit={go}>
          <textarea value={text} onChange={(e) => setText(e.target.value)} placeholder="I want an online shop called Green Leaf that sells organic soaps in Lahore. Prices in PKR, green colours, discounts and reviews." aria-label="Describe your store" />
          <div className="bar"><span className="muted small">Free for 14 days. No card needed.</span><button className="btn lg">Build my store</button></div>
        </form>
        <div className="chips">{EXAMPLES.map(([label, t]) => <button type="button" key={label} className="chip2" onClick={() => setText(t)}>{label}</button>)}</div>

        <div className="mock" aria-hidden="true">
          <div className="bar2"><i /><i /><i /><span>luna-style.buildvendo.app</span></div>
          <div className="body">
            <div className="mhero"><b>Luna Style</b><span>Dresses, bags and accessories. New season, free delivery over Rs 5,000.</span></div>
            {[["Silk wrap dress", "Rs 8,900"], ["Leather tote", "Rs 12,500"], ["Pearl earrings", "Rs 3,200"], ["Evening clutch", "Rs 6,400"]].map(([n, p]) => (
              <div className="mp" key={n}><div /><b>{n}</b><small>{p}</small></div>))}
          </div>
        </div>
      </section>

      <div className="stats">
        <div><b>~1 min</b><span>from idea to live store</span></div>
        <div><b>103</b><span>switchable features</span></div>
        <div><b>PKR</b><span>Easypaisa and JazzCash ready</span></div>
        <div><b>Rs 0</b><span>to start, 14-day full trial</span></div>
      </div>

      <section className="section" id="how">
        <span className="eyebrow">How it works</span>
        <h2 className="big">From idea to live store in three steps</h2><p className="sub">No design or coding skills needed.</p>
        <div className="steps">
          {[["1", "Write what you want", "Say what you sell, where, the colours and the features. Plain words are fine."], ["2", "Preview and adjust", "Review the draft store. Ask for changes in chat, like “make it dark” or “add a Sale category”."], ["3", "Publish and sell", "One click to go live. Manage products, orders, staff and a cashier point of sale from your dashboard."]].map(([n, t, d]) => (
            <div className="step" key={n}><div className="n">{n}</div><h3>{t}</h3><p className="muted" style={{ margin: "6px 0 0" }}>{d}</p></div>))}
        </div>
      </section>

      <section className="section" id="features" style={{ paddingTop: 0 }}>
        <span className="eyebrow">Features</span>
        <h2 className="big">Everything to run a real shop</h2><p className="sub">Switch features on or off as you grow. Your package decides what is included.</p>
        <div className="feat">
          {FEATURES.map(([i, t, d]) => (
            <div className="f" key={t}><div className="i"><Icon name={i} /></div><h3>{t}</h3><p className="muted" style={{ margin: "4px 0 0" }}>{d}</p></div>))}
        </div>
      </section>

      <section className="section" id="pricing" style={{ paddingTop: 0 }}>
        <span className="eyebrow">Pricing</span>
        <h2 className="big">Simple pricing</h2><p className="sub">Every new store starts with a free 14-day trial of all features. No card needed.</p>
        <div className="pricing">
          {plans.map((p) => (
            <div className={`plan ${p.key === "pro" ? "pop" : ""}`} key={p.key}>
              <h3>{p.name}</h3>
              <div className="price">{p.priceMonthly == null ? "Custom" : p.priceMonthly === 0 ? "Free" : money(p.priceMonthly * 100, PLATFORM_CURRENCY)}<small className="muted">{p.priceMonthly == null ? "tailored to you" : p.priceMonthly === 0 ? "forever" : "per month"}</small></div>
              <ul>
                <li>{p.limits.products < 0 ? "Unlimited" : p.limits.products.toLocaleString()} products</li>
                <li>{p.limits.staff < 0 ? "Unlimited staff seats" : `${p.limits.staff} staff seat${p.limits.staff === 1 ? "" : "s"}`}</li>
                <li>{p.limits.aiCredits === 0 ? "No AI credits" : `${p.limits.aiCredits < 0 ? "Unlimited" : p.limits.aiCredits} AI credits / month`}</li>
                <li>{p.featureCount} features included</li>
              </ul>
              <a className={`btn ${p.key === "pro" ? "" : "ghost"}`} href={`/start?plan=${p.key}`}>{p.priceMonthly == null ? "Contact us" : p.priceMonthly === 0 ? "Start for free" : `Choose ${p.name}`}</a>
            </div>))}
        </div>
      </section>

      <section className="cta">
        <h2>Your store is one sentence away.</h2>
        <p>Start free for 14 days. No card, no code.</p>
        <a className="btn lg" href="/start">Build my store</a>
      </section>

      <footer className="footer">BuildVendo · <a href="/s/demo">View the demo store</a> · <a href="/login?scope=platform">Platform admin</a></footer>
    </>
  );
}
