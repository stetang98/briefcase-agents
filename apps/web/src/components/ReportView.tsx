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

export function ReportView({ report }: { report: JobReport }) {
  const blocks = renderMarkdown(report.markdown);
  return (
    <article className="report">
      {report.coverImage && (
        <img
          className="report-cover"
          src={
            report.coverImage.startsWith("http") || report.coverImage.startsWith("data:")
              ? report.coverImage
              : `data:image/webp;base64,${report.coverImage}`
          }
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
