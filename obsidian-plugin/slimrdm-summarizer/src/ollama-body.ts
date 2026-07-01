export interface GenerateOptions {
  endpoint: string;
  model: string;
  prompt: string;
  temperature: number;
  numCtx: number;
  timeoutMs: number;
}

/** Pure builder for the Ollama /api/generate request body (no obsidian deps → unit-testable). */
export function buildGenerateBody(o: GenerateOptions) {
  return {
    model: o.model,
    prompt: o.prompt,
    stream: false as const,
    options: { temperature: o.temperature, num_ctx: o.numCtx },
  };
}
