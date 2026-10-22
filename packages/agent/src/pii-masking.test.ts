import { afterEach, describe, expect, it } from "vitest";
import {
  generateText,
  simulateReadableStream,
  stepCountIs,
  streamText,
  tool,
  wrapLanguageModel,
  type LanguageModel,
} from "ai";
import { MockLanguageModelV4 } from "ai/test";
import type { LanguageModelV4CallOptions, LanguageModelV4StreamPart } from "@ai-sdk/provider";
import { z } from "zod";
import { createPiiMasker, defaultGuardrail, PII_DETECTORS, type MaskingGuardrail } from "@agent-hub/core";
import {
  maskOutbound,
  maskOutboundValue,
  maskPrompt,
  piiMaskingMiddleware,
  piiMaskingTrace,
  turnPiiMasking,
  withPiiMasking,
} from "./pii-masking";
import { getRuntimeHost, registerRuntimeHost, resetRuntimeHost } from "./host";

const EMAIL = "jane.doe@example.com";
const PHONE = "+39 06 1234 5678";

const usage = {
  inputTokens: { total: 1, noCache: 1, cacheRead: undefined, cacheWrite: undefined },
  outputTokens: { total: 1, text: 1, reasoning: undefined },
};
const finish = (unified: "stop" | "tool-calls" = "stop") =>
  ({ type: "finish", finishReason: { unified, raw: unified }, usage }) as const;

/** Every prompt the wrapped model was sent, as one string per call. */
function recording(respond: (call: number) => LanguageModelV4StreamPart[]) {
  const prompts: string[] = [];
  const inner = new MockLanguageModelV4({
    doStream: async (options: LanguageModelV4CallOptions) => {
      prompts.push(JSON.stringify(options.prompt));
      return { stream: simulateReadableStream({ chunks: respond(prompts.length) }) };
    },
    doGenerate: async (options: LanguageModelV4CallOptions) => {
      prompts.push(JSON.stringify(options.prompt));
      return {
        content: [
          { type: "text", text: `Hello [EMAIL_1], call [PHONE_1].` },
          { type: "tool-call", toolCallId: "t1", toolName: "send", input: JSON.stringify({ to: "[EMAIL_1]" }) },
        ],
        finishReason: { unified: "stop", raw: "stop" },
        usage,
        warnings: [],
      };
    },
  });
  const model: LanguageModel = wrapLanguageModel({ model: inner, middleware: piiMaskingMiddleware() });
  return { model, prompts };
}

const masking = (detectors = [...PII_DETECTORS]): MaskingGuardrail => ({
  ...(defaultGuardrail("pii_masking", "pii") as MaskingGuardrail),
  detectors,
});

describe("outside a masking scope", () => {
  it("changes nothing", async () => {
    expect(maskOutbound(`mail ${EMAIL}`)).toBe(`mail ${EMAIL}`);
    expect(maskOutboundValue({ to: EMAIL })).toEqual({ to: EMAIL });
    const { model, prompts } = recording(() => [
      { type: "text-start", id: "1" },
      { type: "text-delta", id: "1", delta: "[EMAIL_1]" },
      { type: "text-end", id: "1" },
      finish(),
    ]);
    const result = streamText({ model, prompt: `mail ${EMAIL}` });
    expect(await result.text).toBe("[EMAIL_1]");
    expect(prompts[0]).toContain(EMAIL);
  });
});

describe("maskOutbound / maskOutboundValue", () => {
  it("mask with the active masker, strings at any depth, keys left alone", () => {
    const masker = createPiiMasker(PII_DETECTORS);
    withPiiMasking(masker, () => {
      expect(maskOutbound(`mail ${EMAIL}`)).toBe("mail [EMAIL_1]");
      expect(maskOutboundValue({ [EMAIL]: [{ phone: PHONE }], n: 3 })).toEqual({
        [EMAIL]: [{ phone: "[PHONE_1]" }],
        n: 3,
      });
    });
  });
});

describe("maskPrompt", () => {
  it("masks every role and every text a provider reads, files as they are", () => {
    const masker = createPiiMasker(PII_DETECTORS);
    const file = { type: "file" as const, mediaType: "image/png", data: { type: "data" as const, data: "AAAA" } };
    const out = maskPrompt(
      [
        { role: "system", content: `Support is ${EMAIL}` },
        { role: "user", content: [{ type: "text", text: `I am ${EMAIL}` }, file] },
        {
          role: "assistant",
          content: [
            { type: "reasoning", text: `call ${PHONE}` },
            { type: "tool-call", toolCallId: "t", toolName: "send", input: { to: EMAIL, n: 1 } },
          ],
        },
        {
          role: "tool",
          content: [
            { type: "tool-result", toolCallId: "t", toolName: "send", output: { type: "json", value: { echo: EMAIL } } },
            { type: "tool-result", toolCallId: "u", toolName: "read", output: { type: "text", value: PHONE } },
          ],
        },
      ],
      masker
    );
    const sent = JSON.stringify(out);
    expect(sent).not.toContain(EMAIL);
    expect(sent).not.toContain(PHONE);
    expect(sent).toContain('"to":"[EMAIL_1]","n":1');
    expect(out[1]!.content).toContainEqual(file);
  });
});

describe("piiMaskingMiddleware", () => {
  it("masks the prompt and restores a generated answer and its tool-call arguments", async () => {
    const masker = createPiiMasker(PII_DETECTORS);
    const { model, prompts } = recording(() => []);
    const result = await withPiiMasking(masker, () =>
      generateText({ model, prompt: `I am ${EMAIL}, phone ${PHONE}` })
    );
    expect(prompts[0]).not.toContain(EMAIL);
    expect(prompts[0]).not.toContain(PHONE);
    expect(result.text).toBe(`Hello ${EMAIL}, call ${PHONE}.`);
    expect(result.toolCalls[0]?.input).toEqual({ to: EMAIL });
  });

  it("restores a placeholder split across streamed deltas, and leaves one it never issued", async () => {
    const masker = createPiiMasker(PII_DETECTORS);
    const { model } = recording(() => [
      { type: "text-start", id: "1" },
      { type: "text-delta", id: "1", delta: "Hi [EMA" },
      { type: "text-delta", id: "1", delta: "IL_1], not [EMAIL_" },
      { type: "text-delta", id: "1", delta: "9]. Call [PHONE_1" },
      { type: "text-delta", id: "1", delta: "]" },
      { type: "text-end", id: "1" },
      finish(),
    ]);
    const deltas: string[] = [];
    const text = await withPiiMasking(masker, async () => {
      const result = streamText({ model, prompt: `I am ${EMAIL} on ${PHONE}` });
      for await (const delta of result.textStream) deltas.push(delta);
      return result.text;
    });
    expect(text).toBe(`Hi ${EMAIL}, not [EMAIL_9]. Call ${PHONE}`);
    // No delta the wire saw ends in a fragment of a placeholder.
    expect(deltas.filter((d) => /\[[A-Z]*(?:_\d*)?$/.test(d))).toEqual([]);
  });

  it("hands a tool the real value and masks it again in the next step", async () => {
    const masker = createPiiMasker(PII_DETECTORS);
    const { model, prompts } = recording((call) =>
      call === 1
        ? [
            { type: "tool-input-start", id: "c1", toolName: "lookup" },
            { type: "tool-input-delta", id: "c1", delta: '{"email":"[EMA' },
            { type: "tool-input-delta", id: "c1", delta: 'IL_1]"}' },
            { type: "tool-input-end", id: "c1" },
            { type: "tool-call", toolCallId: "c1", toolName: "lookup", input: '{"email":"[EMAIL_1]"}' },
            finish("tool-calls"),
          ]
        : [
            { type: "text-start", id: "2" },
            { type: "text-delta", id: "2", delta: "Your order ships to [EMAIL_1]. Questions: [PHONE_1]." },
            { type: "text-end", id: "2" },
            finish(),
          ]
    );
    const received: string[] = [];
    const text = await withPiiMasking(masker, async () => {
      const result = streamText({
        model,
        prompt: `Where is my order? I am ${EMAIL}`,
        tools: {
          lookup: tool({
            inputSchema: z.object({ email: z.string() }),
            execute: async ({ email }) => {
              received.push(email);
              // The tool brings a value of its own that no one typed.
              return { status: "shipped", contact: email, desk: PHONE };
            },
          }),
        },
        stopWhen: stepCountIs(3),
      });
      return result.text;
    });
    expect(received).toEqual([EMAIL]);
    expect(prompts).toHaveLength(2);
    // The second step carries the tool call and its result: both masked.
    for (const prompt of prompts) {
      expect(prompt).not.toContain(EMAIL);
      expect(prompt).not.toContain(PHONE);
    }
    expect(prompts[1]).toContain("[EMAIL_1]");
    expect(prompts[1]).toContain("[PHONE_1]");
    // The tool's own value comes back in the answer like the Visitor's.
    expect(text).toBe(`Your order ships to ${EMAIL}. Questions: ${PHONE}.`);
  });
});

describe("turnPiiMasking / piiMaskingTrace", () => {
  it("is null when the guardrail is off or absent", () => {
    expect(turnPiiMasking(undefined, [], EMAIL)).toBeNull();
    expect(turnPiiMasking([{ ...masking(), enabled: false }], [], EMAIL)).toBeNull();
    expect(piiMaskingTrace(null)).toBeUndefined();
  });

  it("numbers the Visitor's values in transcript order, then the new message", () => {
    const turnMasking = turnPiiMasking(
      [masking()],
      [
        { role: "user", content: [{ type: "text", text: "first@example.com" }] },
        { role: "assistant", content: [{ type: "text", text: "Write to help@example.org" }] },
      ],
      "now second@example.com"
    )!;
    expect(turnMasking.masker.mask("second@example.com help@example.org first@example.com")).toBe(
      "[EMAIL_3] [EMAIL_2] [EMAIL_1]"
    );
    expect(piiMaskingTrace(turnMasking)).toEqual({
      id: "pii",
      name: "PII masking",
      masked: [
        { detector: "email", origin: "visitor", count: 2 },
        { detector: "email", origin: "other", count: 1 },
      ],
    });
  });

  it("reserves a placeholder the Visitor typed in a later message", () => {
    const { masker } = turnPiiMasking(
      [masking()],
      [{ role: "user", content: [{ type: "text", text: `I am ${EMAIL}` }] }],
      "what does [EMAIL_1] mean?"
    )!;
    expect(masker.mask(EMAIL)).toBe("[EMAIL_2]");
    expect(masker.restore("[EMAIL_1] and [EMAIL_2]")).toBe(`[EMAIL_1] and ${EMAIL}`);
  });

  it("counts a value from an attached file as the Visitor's", () => {
    const { masker } = turnPiiMasking([masking()], [], "see the file", [{ name: "cv.pdf", text: `Contact: ${EMAIL}` }])!;
    masker.mask(`Context: ${EMAIL}`);
    expect(masker.report()).toEqual([{ detector: "email", origin: "visitor", count: 1 }]);
  });

  it("masks only the detectors the guardrail selects, and leaves no trace when nothing was sent", () => {
    const turnMasking = turnPiiMasking([masking(["phone"])], [], `${EMAIL} ${PHONE}`)!;
    expect(piiMaskingTrace(turnMasking)).toBeUndefined();
    expect(turnMasking.masker.mask(`${EMAIL} ${PHONE}`)).toBe(`${EMAIL} [PHONE_1]`);
  });
});

describe("work scheduled after the response", () => {
  afterEach(() => resetRuntimeHost());

  it("runs outside the turn's masking scope, whatever the host's after() carries", async () => {
    // A host whose after() runs the work in the caller's context, as Next's does.
    registerRuntimeHost({ scheduleAfterResponse: (work) => void work() });
    const seen: string[] = [];
    withPiiMasking(createPiiMasker(PII_DETECTORS), () => {
      seen.push(maskOutbound(EMAIL));
      getRuntimeHost().scheduleAfterResponse(() => seen.push(maskOutbound(EMAIL)));
    });
    expect(seen).toEqual(["[EMAIL_1]", EMAIL]);
  });
});
