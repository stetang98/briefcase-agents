import type { VeniceTool } from "./venice.js";

export interface ToolImpl {
  description: string;
  parameters: unknown;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  run: (args: any) => Promise<unknown>;
}
export type ToolMap = Record<string, ToolImpl>;

export function toVeniceTools(tools: ToolMap): VeniceTool[] {
  return Object.entries(tools).map(([name, t]) => ({
    type: "function" as const,
    function: { name, description: t.description, parameters: t.parameters },
  }));
}
