import OpenAI from 'openai';

let cached: OpenAI | null = null;

export function client(): OpenAI {
  if (cached) return cached;
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    throw new Error('OPENAI_API_KEY is not set. Add it to your environment (or .env) and restart.');
  }
  cached = new OpenAI({ apiKey });
  return cached;
}

export const DEFAULT_MODEL = process.env.AGENTRAFT_MODEL ?? 'gpt-4o-mini';

export interface ToolSpec {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
}

export async function callText(opts: {
  system: string;
  user: string;
  model?: string;
  maxTokens?: number;
}): Promise<string> {
  const c = client();
  const res = await c.chat.completions.create({
    model: opts.model ?? DEFAULT_MODEL,
    max_tokens: opts.maxTokens ?? 150,
    messages: [
      { role: 'system', content: opts.system },
      { role: 'user', content: opts.user },
    ],
  });
  return res.choices[0]?.message?.content?.trim() ?? '';
}

export async function callTool<T>(opts: {
  system: string;
  user: string;
  tool: ToolSpec;
  model?: string;
  maxTokens?: number;
}): Promise<T> {
  const c = client();
  const res = await c.chat.completions.create({
    model: opts.model ?? DEFAULT_MODEL,
    max_tokens: opts.maxTokens ?? 512,
    messages: [
      { role: 'system', content: opts.system },
      { role: 'user', content: opts.user },
    ],
    tools: [
      {
        type: 'function',
        function: {
          name: opts.tool.name,
          description: opts.tool.description,
          parameters: opts.tool.inputSchema as any,
        },
      },
    ],
    tool_choice: { type: 'function', function: { name: opts.tool.name } },
  });
  const call = res.choices[0]?.message?.tool_calls?.[0];
  if (!call || call.function.name !== opts.tool.name) {
    throw new Error(`agent ${opts.tool.name} returned no matching tool_call`);
  }
  return JSON.parse(call.function.arguments) as T;
}
