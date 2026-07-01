import { requestUrl } from 'obsidian';
import { buildGenerateBody, type GenerateOptions } from './ollama-body.ts';

export type { GenerateOptions };

export async function generate(o: GenerateOptions): Promise<string> {
  const url = `${o.endpoint.replace(/\/$/, '')}/api/generate`;
  const body = JSON.stringify(buildGenerateBody(o));

  const req = requestUrl({
    url,
    method: 'POST',
    contentType: 'application/json',
    body,
    throw: false,
  });
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(
      () => reject(new Error(`Ollama request timed out after ${o.timeoutMs} ms`)),
      o.timeoutMs,
    );
  });

  try {
    const res = await Promise.race([req, timeout]);
    if (res.status !== 200) {
      throw new Error(`Ollama returned HTTP ${res.status}`);
    }
    const text: string = (res.json?.response ?? '').trim();
    if (!text) {
      throw new Error('Ollama returned an empty response');
    }
    return text;
  } finally {
    clearTimeout(timer);
  }
}
