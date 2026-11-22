"use client";
import { money } from "../lib/api";

export default function ProductCard({ p, base, currency }) {
  return (
    <a className="pcard" href={`${base}/p/${p.slug}`}>
      <div className="pimg" aria-hidden="true">{p.images?.[0] ? <img src={p.images[0]} alt="" style={{ width: "100%", height: "100%", objectFit: "cover" }} /> : p.emoji || "🛍️"}</div>
      <div className="pbody">
        <div style={{ fontWeight: 600 }}>{p.title}</div>
        <div className="s-muted" style={{ fontSize: ".85rem" }}>{p.category}</div>
        <div className="pprice">{p.variants.length > 1 ? "From " : ""}{money(Math.min(...p.variants.map((v) => v.price)), currency)} {!p.inStock && <span className="sold">· Sold out</span>}</div>
      </div>
    </a>
  );
}
