// A stand-in OpenAI-compatible provider for rehearsing the widget load test
// without spending a real key. Answers /v1/chat/completions (streamed or not)
// after a configurable delay, and refuses with 429 + Retry-After once more than
// FAKE_MAX_CONCURRENT requests are in flight, which is how a real provider's
// rate limit looks from the runtime's side.
//
// FAKE_PORT=11500 FAKE_LATENCY_MS=1500 FAKE_MAX_CONCURRENT=8 \
// node apps/web/scripts/fake-openai-provider.mjs
//
// Then run apps/web with OPENAI_COMPATIBLE_BASE_URL=http://localhost:11500/v1
// and OPENAI_COMPATIBLE_CHAT_MODEL=fake. See docs/runbooks/widget-load-test.md.

import { createServer } from "node:http";

const port = Number(process.env.FAKE_PORT ?? 11500);
const latencyMs = Number(process.env.FAKE_LATENCY_MS ?? 1500);
const maxConcurrent = Number(process.env.FAKE_MAX_CONCURRENT ?? 8);
const retryAfterSeconds = Number(process.env.FAKE_RETRY_AFTER_S ?? 1);
const words = "This is a rehearsal answer from the fake provider, streamed a word at a time.".split(" ");

let inFlight = 0;
let served = 0;
let refused = 0;

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function chunk(id, delta, finish = null) {
  return `data: ${JSON.stringify({
    id,
    object: "chat.completion.chunk",
    created: Math.floor(Date.now() / 1000),
    model: "fake",
    choices: [{ index: 0, delta, finish_reason: finish }],
  })}\n\n`;
}

async function readJson(request) {
  let raw = "";
  for await (const part of request) raw += part;
  return raw ? JSON.parse(raw) : {};
}

const server = createServer(async (request, response) => {
  if (request.method === "GET" && request.url?.endsWith("/models")) {
    response.writeHead(200, { "content-type": "application/json" });
    response.end(JSON.stringify({ object: "list", data: [{ id: "fake", object: "model" }] }));
    return;
  }
  if (request.method !== "POST" || !request.url?.endsWith("/chat/completions")) {
    response.writeHead(404).end();
    return;
  }
  const body = await readJson(request);
  if (inFlight >= maxConcurrent) {
    refused += 1;
    response.writeHead(429, {
      "content-type": "application/json",
      "retry-after": String(retryAfterSeconds),
    });
    response.end(
      JSON.stringify({ error: { message: "Rate limit reached", type: "rate_limit_error" } })
    );
    return;
  }
  inFlight += 1;
  try {
    const id = `chatcmpl-${crypto.randomUUID()}`;
    // Half the latency before the first token, half spread over the rest, so
    // time-to-first-token and time-to-done are both visible in the report.
    await sleep(latencyMs / 2);
    if (body.stream) {
      response.writeHead(200, {
        "content-type": "text/event-stream",
        "cache-control": "no-cache",
      });
      response.write(chunk(id, { role: "assistant", content: "" }));
      for (const word of words) {
        response.write(chunk(id, { content: `${word} ` }));
        await sleep(latencyMs / 2 / words.length);
      }
      response.write(chunk(id, {}, "stop"));
      response.write(
        `data: ${JSON.stringify({
          id,
          object: "chat.completion.chunk",
          created: Math.floor(Date.now() / 1000),
          model: "fake",
          choices: [],
          usage: { prompt_tokens: 200, completion_tokens: words.length, total_tokens: 200 + words.length },
        })}\n\n`
      );
      response.end("data: [DONE]\n\n");
    } else {
      await sleep(latencyMs / 2);
      response.writeHead(200, { "content-type": "application/json" });
      response.end(
        JSON.stringify({
          id,
          object: "chat.completion",
          created: Math.floor(Date.now() / 1000),
          model: "fake",
          choices: [
            {
              index: 0,
              message: { role: "assistant", content: words.join(" ") },
              finish_reason: "stop",
            },
          ],
          usage: { prompt_tokens: 200, completion_tokens: words.length, total_tokens: 200 + words.length },
        })
      );
    }
    served += 1;
  } finally {
    inFlight -= 1;
  }
});

server.listen(port, () => {
  console.log(
    `fake provider on http://localhost:${port}/v1 (latency ${latencyMs}ms, ` +
      `429 above ${maxConcurrent} in flight, Retry-After ${retryAfterSeconds}s)`
  );
});

setInterval(() => {
  console.log(`served ${served}, refused ${refused}, in flight ${inFlight}`);
}, 10_000).unref();
