import clsx from 'clsx';
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { streamText } from 'ai';
import { PiRobot } from 'react-icons/pi';
import { FiSend } from 'react-icons/fi';
import Popup from '@/components/Popup';
import { useTranslation } from '@/hooks/useTranslation';
import { useSettingsStore } from '@/store/settingsStore';
import { useBookDataStore } from '@/store/bookDataStore';
import { useReaderStore } from '@/store/readerStore';
import { getAIProvider } from '@/services/ai/providers';
import { DEFAULT_AI_SETTINGS } from '@/services/ai/constants';
import {
  SELECTION_ASK_PRESETS,
  buildSelectionSystemPrompt,
  buildSelectionUserPrompt,
  type SelectionAskContext,
} from '@/services/ai/prompts';
import { aiLogger } from '@/services/ai/logger';
import { getLocale } from '@/utils/misc';
import { Position, TextSelection } from '@/utils/sel';

/**
 * Text around the selection, used to disambiguate a short highlight ("it",
 * "the second one"). The enclosing block element is the natural unit — big
 * enough to resolve a pronoun, small enough not to blow up the prompt.
 */
const MAX_SURROUNDING_CHARS = 1200;

const getSurroundingText = (selection: TextSelection): string | undefined => {
  const container = selection.range?.startContainer;
  const block = container?.parentElement?.closest('p, li, blockquote, td, div');
  const text = block?.textContent?.trim();
  if (!text || text === selection.text.trim()) return undefined;
  return text.length > MAX_SURROUNDING_CHARS ? text.slice(0, MAX_SURROUNDING_CHARS) : text;
};

interface AskAIPopupProps {
  bookKey: string;
  selection: TextSelection;
  position: Position;
  trianglePosition: Position;
  popupWidth: number;
  popupHeight: number;
  onDismiss: () => void;
  onOpenInNotebook?: () => void;
}

const AskAIPopup: React.FC<AskAIPopupProps> = ({
  bookKey,
  selection,
  position,
  trianglePosition,
  popupWidth,
  popupHeight,
  onDismiss,
  onOpenInNotebook,
}) => {
  const _ = useTranslation();
  const { settings } = useSettingsStore();
  const getBookData = useBookDataStore((s) => s.getBookData);
  const { getProgress } = useReaderStore();

  const [question, setQuestion] = useState('');
  const [answer, setAnswer] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const answerRef = useRef<HTMLDivElement>(null);

  const aiSettings = settings?.aiSettings ?? DEFAULT_AI_SETTINGS;
  const bookData = getBookData(bookKey);
  const progress = getProgress(bookKey);

  // Abort any in-flight stream when the popup goes away, so a dismissed
  // question stops burning tokens (and can't setState on an unmounted tree).
  useEffect(() => {
    return () => abortRef.current?.abort();
  }, []);

  const ask = useCallback(
    async (asked: string) => {
      if (!asked.trim() || loading) return;
      abortRef.current?.abort();
      const controller = new AbortController();
      abortRef.current = controller;

      setLoading(true);
      setError(null);
      setAnswer('');

      const ctx: SelectionAskContext = {
        bookTitle: bookData?.book?.title || _('this book'),
        authorName: bookData?.book?.author || undefined,
        chapterTitle: progress?.sectionLabel || undefined,
        selectedText: selection.text,
        surroundingText: getSurroundingText(selection),
        responseLanguage: getLocale(),
      };

      try {
        const provider = getAIProvider(aiSettings);
        const result = streamText({
          model: provider.getModel(),
          system: buildSelectionSystemPrompt(ctx),
          prompt: buildSelectionUserPrompt(ctx, asked),
          abortSignal: controller.signal,
        });
        for await (const delta of result.textStream) {
          if (controller.signal.aborted) return;
          setAnswer((prev) => prev + delta);
        }
      } catch (e) {
        if (controller.signal.aborted) return;
        const message = (e as Error).message;
        aiLogger.provider.error(aiSettings.provider, `ask-ai failed: ${message}`);
        setError(message);
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [aiSettings, bookData, progress, selection, loading],
  );

  // Keep the newest tokens in view while the answer streams in.
  useEffect(() => {
    const el = answerRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [answer]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    ask(question);
  };

  const notConfigured = !aiSettings.enabled;

  return (
    <Popup
      trianglePosition={trianglePosition}
      width={popupWidth}
      minHeight={popupHeight}
      maxHeight={720}
      position={position}
      className='flex h-full select-text flex-col'
      onDismiss={onDismiss}
    >
      <div className='flex items-center gap-2 px-4 pt-3 font-sans'>
        <PiRobot className='shrink-0' size={16} />
        <h1 className='text-sm font-medium'>{_('Ask AI')}</h1>
      </div>

      <p className='line-clamp-3 px-4 pt-2 text-sm italic text-base-content/70'>{selection.text}</p>

      {notConfigured ? (
        <p className='px-4 py-4 text-sm text-base-content/80'>
          {_('Turn on the AI assistant in Settings → AI Assistant to ask about a selection.')}
        </p>
      ) : (
        <>
          <div className='flex flex-wrap gap-1.5 px-4 pt-3 font-sans'>
            {SELECTION_ASK_PRESETS.map((preset) => (
              <button
                key={preset.id}
                type='button'
                disabled={loading}
                className='eink-bordered rounded-full bg-base-100 px-2.5 py-1 text-xs disabled:opacity-50'
                onClick={() => {
                  setQuestion('');
                  ask(preset.instruction);
                }}
              >
                {_(preset.label)}
              </button>
            ))}
          </div>

          <div
            ref={answerRef}
            className={clsx(
              'min-h-0 flex-1 overflow-y-auto px-4 py-3 font-sans text-sm',
              !answer && !loading && !error && 'text-base-content/60',
            )}
          >
            {error ? (
              <p className='text-red-600'>{error}</p>
            ) : answer ? (
              <p className='whitespace-pre-wrap'>{answer}</p>
            ) : loading ? (
              <p className='italic'>{_('Loading...')}</p>
            ) : (
              <p>{_('Pick a question above, or type your own.')}</p>
            )}
          </div>

          <form
            onSubmit={handleSubmit}
            className='flex shrink-0 items-center gap-2 rounded-b-lg px-4 py-2 font-sans'
          >
            <input
              type='text'
              value={question}
              disabled={loading}
              placeholder={_('Ask about this passage...')}
              onChange={(e) => setQuestion(e.target.value)}
              className='eink-bordered min-w-0 flex-1 rounded-md bg-base-100 px-2 py-1 text-sm outline-none disabled:opacity-50'
            />
            <button
              type='submit'
              disabled={loading || !question.trim()}
              aria-label={_('Send')}
              className='btn btn-ghost btn-xs shrink-0 disabled:opacity-40'
            >
              <FiSend size={14} />
            </button>
            {onOpenInNotebook && answer && !loading && (
              <button
                type='button'
                className='shrink-0 whitespace-nowrap text-xs text-base-content/60 underline'
                onClick={onOpenInNotebook}
              >
                {_('Continue in Notebook')}
              </button>
            )}
          </form>
        </>
      )}
    </Popup>
  );
};

export default AskAIPopup;
