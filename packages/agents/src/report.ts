export interface ReportSection {
  agent: string;
  text: string;
  failed?: boolean;
  note?: string;
  image?: string;
}

export interface CompiledReport {
  topic: string;
  markdown: string;
  sections: ReportSection[];
  coverImage?: string;
  generatedAt: string;
}

const SECTION_TITLES: Record<string, string> = {
  scout: "Intelligence",
  analyst: "On-chain Signals",
  designer: "Cover",
};

export function compileReport(topic: string, sections: ReportSection[]): CompiledReport {
  const coverImage = sections.find((s) => s.image)?.image;
  const body = sections
    .map((s) => {
      const title = SECTION_TITLES[s.agent] ?? s.agent;
      if (s.failed) {
        return `## ${title}\n\n> ⚠ ${s.agent} section unavailable${s.note ? `: ${s.note}` : ""}`;
      }
      return `## ${title}\n\n${s.text}`;
    })
    .join("\n\n");
  return {
    topic,
    markdown: `# Research Brief: ${topic}\n\n${body}`,
    sections,
    coverImage,
    generatedAt: new Date().toISOString(),
  };
}
