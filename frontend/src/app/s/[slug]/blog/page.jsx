"use client";
import { useApi } from "../../../../components/ui";
import { useStore } from "../../../../components/StoreCtx";

export default function BlogList() {
  const { slug, base } = useStore();
  const { data, error, loading } = useApi(`/store/${slug}/blog`);
  return (
    <div className="s-wrap">
      <h1>Blog</h1>
      {loading ? <p className="s-muted">Loading…</p> : error ? <p className="s-muted">There is no blog here yet.</p> : !data.posts.length ? <div className="s-card">No posts yet. Come back soon.</div> : (
        <div className="pgrid">{data.posts.map((p) => (
          <a key={p.slug} className="pcard" href={`${base}/blog/${p.slug}`}>
            {p.image ? <div className="pimg" style={{ aspectRatio: "16 / 9" }}><img src={p.image} alt="" /></div> : null}
            <div className="pbody"><div style={{ fontWeight: 700, fontSize: "1.05rem" }}>{p.title}</div><div className="s-muted small">{new Date(p.publishedAt).toLocaleDateString()}{p.author ? ` · ${p.author}` : ""}</div><p style={{ margin: "6px 0 0" }}>{p.excerpt}</p></div>
          </a>))}</div>)}
    </div>
  );
}
