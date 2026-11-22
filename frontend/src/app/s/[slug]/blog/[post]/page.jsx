"use client";
import { useParams } from "next/navigation";
import { useApi } from "../../../../../components/ui";
import { useStore } from "../../../../../components/StoreCtx";

export default function BlogPost() {
  const { post } = useParams();
  const { slug, base } = useStore();
  const { data, error, loading } = useApi(`/store/${slug}/blog/${post}`);
  if (loading) return <div className="s-wrap"><p className="s-muted">Loading…</p></div>;
  if (error) return <div className="s-wrap"><p className="err">{error.message}</p><a href={`${base}/blog`}>← All posts</a></div>;
  const p = data.post;
  return (
    <div className="s-wrap" style={{ maxWidth: 760 }}>
      <p className="small"><a href={`${base}/blog`}>← All posts</a></p>
      <h1 style={{ marginBottom: 4 }}>{p.title}</h1>
      <p className="s-muted">{new Date(p.publishedAt).toLocaleDateString()}{p.author ? ` · ${p.author}` : ""}</p>
      {p.image && <img src={p.image} alt="" style={{ width: "100%", maxHeight: 380, objectFit: "cover", borderRadius: "var(--s-radius)", margin: "8px 0 16px" }} />}
      {/* plain text only: paragraphs are split on empty lines and rendered as text, never as HTML */}
      {p.body.split(/\n\s*\n/).map((para, i) => <p key={i} style={{ whiteSpace: "pre-wrap", fontSize: "1.05rem", lineHeight: 1.7 }}>{para.trim()}</p>)}
    </div>
  );
}
