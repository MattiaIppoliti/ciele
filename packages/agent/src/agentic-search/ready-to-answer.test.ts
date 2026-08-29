import { describe, expect, it } from 'vitest';
import {
  createTerminalState,
  readyToAnswerTool,
  resolveTerminalStatus,
  writeTimeInstructions,
} from './ready-to-answer';
import type { RuntimeEvent } from '../types';

const call = async (tool: unknown, input: Record<string, unknown>) =>
  (tool as { execute: (i: unknown, o: unknown) => Promise<unknown> }).execute(input, {
    toolCallId: 'ready-1',
    messages: [],
  });

describe('writeTimeInstructions', () => {
  it('gives each status its own constraint', () => {
    expect(writeTimeInstructions('needs_clarification')).toContain(
      'ONE concise, user-facing clarification question'
    );
    expect(writeTimeInstructions('insufficient_information')).toContain(
      'reach out to a human'
    );
    // A dead end must never be filled with general knowledge.
    expect(writeTimeInstructions('insufficient_information')).toContain(
      'do not fall back on general knowledge'
    );
    expect(writeTimeInstructions('answer')).toContain('Write the final answer now');
  });

  it('late-binds the answering style above the generic guidance', () => {
    const out = writeTimeInstructions('answer', {
      answeringStyle: 'Keep answers short.',
    });
    expect(out).toContain('Keep answers short.');
    expect(out).toContain('take priority over the general guidance');
  });

  it('explains itself when a second clarification was blocked', () => {
    const out = writeTimeInstructions('answer', {}, { reClarifyBlocked: true });
    expect(out).toContain('ALREADY asked the visitor to clarify');
    expect(out).toContain('best answer you can');
  });
});

describe('readyToAnswerTool', () => {
  it('records the declaration and returns the write-time instructions', async () => {
    const state = createTerminalState();
    const out = (await call(readyToAnswerTool(state, {}), {
      status: 'insufficient_information',
    })) as { instructions: string };
    expect(state.status).toBe('insufficient_information');
    expect(state.calls).toBe(1);
    expect(out.instructions).toContain('reach out to a human');
  });

  it('keeps the first status when called twice', async () => {
    // A confused model must not be able to downgrade a real answer into a dead
    // end (or the reverse) on a retry.
    const state = createTerminalState();
    const tool = readyToAnswerTool(state, {});
    await call(tool, { status: 'answer' });
    const second = (await call(tool, { status: 'insufficient_information' })) as {
      note?: string;
    };
    expect(state.status).toBe('answer');
    expect(state.calls).toBe(2);
    expect(second.note).toContain('your first status stands');
  });

  it('coerces a garbled status to the safe end rather than licensing an answer', async () => {
    const state = createTerminalState();
    await call(readyToAnswerTool(state, {}), { status: 'ok-i-guess' });
    expect(state.status).toBe('insufficient_information');
  });

  it('blocks a second clarification in the same conversation', async () => {
    const state = createTerminalState();
    const out = (await call(
      readyToAnswerTool(state, { alreadyClarified: true }),
      { status: 'needs_clarification' }
    )) as { instructions: string };
    expect(state.status).toBe('answer');
    expect(state.reClarifyBlocked).toBe(true);
    expect(out.instructions).toContain('ALREADY asked the visitor to clarify');
  });

  it('allows the FIRST clarification through untouched', async () => {
    const state = createTerminalState();
    await call(readyToAnswerTool(state, { alreadyClarified: false }), {
      status: 'needs_clarification',
    });
    expect(state.status).toBe('needs_clarification');
    expect(state.reClarifyBlocked).toBe(false);
  });

  it('emits the tool lifecycle so the declaration shows for every Inbox reader', async () => {
    // A `thought` would be hidden below the reasoning Role gate; the terminal
    // declaration is operational fact, so it rides the tool lifecycle (#574).
    const events: RuntimeEvent[] = [];
    const state = createTerminalState();
    await call(
      readyToAnswerTool(state, { alreadyClarified: true }, (event) =>
        events.push(event)
      ),
      { status: 'needs_clarification' }
    );
    expect(events.map((e) => e.type)).toEqual(['tool-start', 'tool-end']);
    expect(events[0]).toMatchObject({
      tool: 'readyToAnswer',
      label: 'Getting ready to answer…',
      // The raw declaration, so the trace shows what the model actually said…
      input: { status: 'needs_clarification' },
    });
    // …and the structured result carries the FINAL status after coercion,
    // which is what the fold persists and the Inbox badge shows.
    expect(events[1]).toMatchObject({
      tool: 'readyToAnswer',
      ok: true,
      result: { status: 'answer' },
    });
  });
});

describe('resolveTerminalStatus', () => {
  it('honours the model declaration', () => {
    expect(resolveTerminalStatus('needs_clarification', true)).toBe(
      'needs_clarification'
    );
  });

  it('falls back on the grounding when the gather never declared', () => {
    // A budget that ran out mid-gather must still write, and a dead end dressed
    // up as an answer is the one outcome a Visitor must never get.
    expect(resolveTerminalStatus(null, true)).toBe('answer');
    expect(resolveTerminalStatus(null, false)).toBe('insufficient_information');
  });
});
