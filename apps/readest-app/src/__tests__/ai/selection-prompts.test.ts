import { describe, it, expect } from 'vitest';
import {
  SELECTION_ASK_PRESETS,
  buildSelectionSystemPrompt,
  buildSelectionUserPrompt,
} from '@/services/ai/prompts';

const ctx = {
  bookTitle: 'Moby-Dick',
  authorName: 'Herman Melville',
  chapterTitle: 'Loomings',
  selectedText: 'Call me Ishmael.',
};

describe('buildSelectionSystemPrompt', () => {
  it('names the book and chapter so the model knows where it is', () => {
    const prompt = buildSelectionSystemPrompt(ctx);
    expect(prompt).toContain('Moby-Dick');
    expect(prompt).toContain('Herman Melville');
    expect(prompt).toContain('Loomings');
  });

  it('omits the author and chapter clauses when they are unknown', () => {
    const prompt = buildSelectionSystemPrompt({ bookTitle: 'Untitled', selectedText: 'x' });
    expect(prompt).toContain('Untitled');
    expect(prompt).not.toContain('by ');
    expect(prompt).not.toContain('Chapter:');
  });

  it('asks for the answer in the reader UI language when one is given', () => {
    expect(buildSelectionSystemPrompt({ ...ctx, responseLanguage: 'zh-CN' })).toContain('zh-CN');
  });

  it('keeps the spoiler rule so the model does not read ahead', () => {
    expect(buildSelectionSystemPrompt(ctx).toLowerCase()).toContain('spoil');
  });
});

describe('buildSelectionUserPrompt', () => {
  it('carries the selected passage and the question', () => {
    const prompt = buildSelectionUserPrompt(ctx, 'What does this mean?');
    expect(prompt).toContain('Call me Ishmael.');
    expect(prompt).toContain('What does this mean?');
  });

  it('includes surrounding text only when supplied', () => {
    const withCtx = buildSelectionUserPrompt(
      { ...ctx, surroundingText: 'Some years ago—never mind how long precisely—' },
      'Explain',
    );
    expect(withCtx).toContain('never mind how long precisely');
    expect(buildSelectionUserPrompt(ctx, 'Explain')).not.toContain('<SURROUNDING>');
  });

  it('trims whitespace-only questions down to nothing so callers can guard', () => {
    expect(buildSelectionUserPrompt(ctx, '   ')).not.toContain('<QUESTION>');
  });
});

describe('SELECTION_ASK_PRESETS', () => {
  it('exposes unique ids and a non-empty instruction for each preset', () => {
    const ids = SELECTION_ASK_PRESETS.map((p) => p.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const preset of SELECTION_ASK_PRESETS) {
      expect(preset.label.length).toBeGreaterThan(0);
      expect(preset.instruction.length).toBeGreaterThan(0);
    }
  });
});
