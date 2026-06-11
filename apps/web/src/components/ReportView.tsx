import type { JobReport } from "../lib/api.js";
import "./report-view.css";

/** Minimal, safe markdown rendering: headings + bullets + paragraphs only. */
function renderMarkdown(md: string): { type: "h1" | "h2" | "li" | "p"; text: string }[] {
  return md
    .split("\n")
    .map((line) => line.trimEnd())
    .filter((line) => line.length > 0)
    .map((line) => {
      if (line.startsWith("# ")) return { type: "h1" as const, text: line.slice(2) };
      if (line.startsWith("## ")) return { type: "h2" as const, text: line.slice(3) };
      if (line.startsWith("- ") || line.startsWith("> "))
        return { type: "li" as const, text: line.slice(2) };
      return { type: "p" as const, text: line };
    });
}

/** Allow only image data URIs and https; otherwise treat as raw base64. */
function safeImageSrc(raw: string): string {
  if (/^data:image\/(webp|png|jpeg|jpg|gif);base64,/.test(raw)) return raw;
  if (raw.startsWith("https://")) return raw;
  return `data:image/webp;base64,${raw}`;
}

export function ReportView({ report }: { report: JobReport }) {
  const blocks = renderMarkdown(report.markdown);
  return (
    <article className="report">
      {report.coverImage && (
        <img
          className="report-cover"
          src={safeImageSrc(report.coverImage)}
          alt={`Cover for ${report.topic}`}
          width={640}
          height={240}
        />
      )}
      {blocks.map((b, i) => {
        if (b.type === "h1") return <h1 key={i}>{b.text}</h1>;
        if (b.type === "h2") return <h2 key={i}>{b.text}</h2>;
        if (b.type === "li") return <li key={i}>{b.text}</li>;
        return <p key={i}>{b.text}</p>;
      })}
    </article>
  );
}
