import { describe, it, expect, vi, beforeEach } from 'vitest';
import { z } from 'zod';

/**
 * Regression test for a real CI incident: OpenRouter (or its upstream model)
 * returned a 200 OK with a truncated body — the OpenAI SDK's own `maxRetries`
 * doesn't cover this (it only retries network failures / non-2xx statuses,
 * before the body is parsed), so `chat.completions.create()` threw
 * `TypeError: invalid json response body at <url> reason: Unexpected end of
 * JSON input` straight out of `completeStructured`, failing that agent's
 * entire CI run. See reviewer-core/src/llm/openrouter.ts (`withBodyParseRetry`).
 */
const create = vi.fn();

vi.mock('openai', () => ({
  default: class MockOpenAI {
    chat = { completions: { create } };
  },
}));

const { OpenRouterProvider } = await import('./openrouter.js');

function bodyParseError(): Error {
  return new Error(
    'invalid json response body at https://openrouter.ai/api/v1/chat/completions reason: Unexpected end of JSON input',
  );
}

function chatResponse(content: string) {
  return {
    choices: [{ message: { content } }],
    usage: { prompt_tokens: 10, completion_tokens: 5 },
  };
}

describe('OpenRouterProvider — transient body-parse-error retry', () => {
  beforeEach(() => {
    create.mockReset();
  });

  it('retries once on a body-parse error and succeeds on the next attempt', async () => {
    create.mockRejectedValueOnce(bodyParseError());
    create.mockResolvedValueOnce(chatResponse('{"ok":true}'));

    const provider = new OpenRouterProvider('key');
    const result = await provider.completeStructured({
      schema: z.object({ ok: z.boolean() }),
      schemaName: 'test',
      model: 'test-model',
      messages: [{ role: 'user', content: 'hi' }],
    });

    expect(result.data).toEqual({ ok: true });
    expect(create).toHaveBeenCalledTimes(2);
  });

  it('gives up after exhausting body-parse retries and rethrows the original error', async () => {
    create.mockRejectedValue(bodyParseError());

    const provider = new OpenRouterProvider('key');
    await expect(
      provider.completeStructured({
        schema: z.object({ ok: z.boolean() }),
        schemaName: 'test',
        model: 'test-model',
        messages: [{ role: 'user', content: 'hi' }],
      }),
    ).rejects.toThrow(/invalid json response body/i);

    // 1 initial attempt + 2 retries = 3 calls, then it gives up.
    expect(create).toHaveBeenCalledTimes(3);
  });

  it('does not retry a non-body-parse error (e.g. an auth failure)', async () => {
    create.mockRejectedValue(new Error('401 Unauthorized'));

    const provider = new OpenRouterProvider('key');
    await expect(
      provider.completeStructured({
        schema: z.object({ ok: z.boolean() }),
        schemaName: 'test',
        model: 'test-model',
        messages: [{ role: 'user', content: 'hi' }],
      }),
    ).rejects.toThrow('401 Unauthorized');

    expect(create).toHaveBeenCalledTimes(1);
  });
});
