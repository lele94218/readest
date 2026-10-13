import { embed, embedMany } from 'ai';
import { aiStore } from './storage/aiStore';
import { chunkSection, extractTextFromDocument } from './utils/chunker';
import { withRetryAndTimeout, AI_TIMEOUTS, AI_RETRY_CONFIGS } from './utils/retry';
import { getAIProvider } from './providers';
import { aiLogger } from './logger';
import type { AISettings, TextChunk, ScoredChunk, EmbeddingProgress, BookIndexMeta } from './types';

interface SectionItem {
  id: string;
  size: number;
  linear: string;
  createDocument: () => Promise<Document>;
}

interface TOCItem {
  id: number;
  label: string;
  href?: string;
}

export interface BookDocType {
  sections?: SectionItem[];
  toc?: TOCItem[];
  metadata?: { title?: string | { [key: string]: string }; author?: string | { name?: string } };
}

/**
 * Chunks per embedding request. Sized so a batch stays well inside a provider's
 * per-request token ceiling (chunks run several hundred tokens each) while
 * still being few enough round trips to stay quick, and small enough that a
 * retry re-does seconds of work rather than a whole book.
 */
const EMBEDDING_BATCH_SIZE = 64;

/** Name of the embedding model the given settings would index with. */
function embeddingModelNameFor(settings: AISettings): string {
  switch (settings.provider) {
    case 'ollama':
      return settings.ollamaEmbeddingModel;
    case 'openrouter':
      return settings.openrouterEmbeddingModel || 'text-embedding-3-small';
    case 'openai':
      return settings.openaiEmbeddingModel || 'text-embedding-3-small';
    default:
      return settings.aiGatewayEmbeddingModel || 'text-embedding-3-small';
  }
}

export async function isBookIndexed(bookHash: string, settings?: AISettings): Promise<boolean> {
  const meta = await aiStore.getMeta(bookHash);
  const indexed = meta !== null && meta.totalChunks > 0;
  // An index built with a different embedding model is worse than no index:
  // the vectors have a different dimensionality, cosineSimilarity returns 0
  // for every mismatched pair, and retrieval silently degrades to nothing
  // while the book still reports itself as indexed. Treat it as unindexed so
  // the panel offers to build it again.
  if (indexed && settings && meta!.embeddingModel !== embeddingModelNameFor(settings)) {
    aiLogger.rag.isIndexed(bookHash, false);
    return false;
  }
  aiLogger.rag.isIndexed(bookHash, indexed);
  return indexed;
}

function extractTitle(metadata?: BookDocType['metadata']): string {
  if (!metadata?.title) return 'Unknown Book';
  if (typeof metadata.title === 'string') return metadata.title;
  return (
    metadata.title['en'] ||
    metadata.title['default'] ||
    Object.values(metadata.title)[0] ||
    'Unknown Book'
  );
}

function extractAuthor(metadata?: BookDocType['metadata']): string {
  if (!metadata?.author) return 'Unknown Author';
  if (typeof metadata.author === 'string') return metadata.author;
  return metadata.author.name || 'Unknown Author';
}

function getChapterTitle(toc: TOCItem[] | undefined, sectionIndex: number): string {
  if (!toc || toc.length === 0) return `Section ${sectionIndex + 1}`;
  for (let i = toc.length - 1; i >= 0; i--) {
    if (toc[i]!.id <= sectionIndex) return toc[i]!.label;
  }
  return toc[0]?.label || `Section ${sectionIndex + 1}`;
}

export async function indexBook(
  bookDoc: BookDocType,
  bookHash: string,
  settings: AISettings,
  onProgress?: (progress: EmbeddingProgress) => void,
): Promise<void> {
  const startTime = Date.now();
  const title = extractTitle(bookDoc.metadata);

  if (await aiStore.isIndexed(bookHash)) {
    aiLogger.rag.isIndexed(bookHash, true);
    return;
  }

  aiLogger.rag.indexStart(bookHash, title);
  const provider = getAIProvider(settings);
  const sections = bookDoc.sections || [];
  const toc = bookDoc.toc || [];

  // calculate cumulative character sizes like toc.ts does
  const sizes = sections.map((s) => (s.linear !== 'no' && s.size > 0 ? s.size : 0));
  let cumulative = 0;
  const cumulativeSizes = sizes.map((size) => {
    const current = cumulative;
    cumulative += size;
    return current;
  });

  try {
    onProgress?.({ current: 0, total: 1, phase: 'chunking' });
    aiLogger.rag.indexProgress('chunking', 0, sections.length);
    const allChunks: TextChunk[] = [];

    for (let i = 0; i < sections.length; i++) {
      const section = sections[i]!;
      try {
        const doc = await section.createDocument();
        const text = extractTextFromDocument(doc);
        if (text.length < 100) continue;
        const sectionChunks = chunkSection(
          doc,
          i,
          getChapterTitle(toc, i),
          bookHash,
          cumulativeSizes[i] ?? 0,
        );
        aiLogger.chunker.section(i, text.length, sectionChunks.length);
        allChunks.push(...sectionChunks);
      } catch (e) {
        aiLogger.chunker.error(i, (e as Error).message);
      }
    }

    aiLogger.chunker.complete(bookHash, allChunks.length);

    if (allChunks.length === 0) {
      aiLogger.rag.indexComplete(bookHash, 0, Date.now() - startTime);
      return;
    }

    onProgress?.({ current: 0, total: allChunks.length, phase: 'embedding' });
    const embeddingModelName = embeddingModelNameFor(settings);
    aiLogger.embedding.start(embeddingModelName, allChunks.length);

    const texts = allChunks.map((c) => c.text);
    const embeddingModel = provider.getEmbeddingModel();
    let dimensions = 0;
    try {
      // Embed in batches. A whole book used to go out as one embedMany call
      // under a single 2-minute timeout, so a long book simply never finished:
      // the request blew the provider's per-request limits, the one timeout
      // covered thousands of chunks, and a retry restarted the entire book.
      // Batching also makes the progress bar real — it used to jump 0 -> 100
      // after the fact, since there was nothing to report until the end.
      for (let start = 0; start < texts.length; start += EMBEDDING_BATCH_SIZE) {
        const batch = texts.slice(start, start + EMBEDDING_BATCH_SIZE);
        const { embeddings } = await withRetryAndTimeout(
          () => embedMany({ model: embeddingModel, values: batch }),
          AI_TIMEOUTS.EMBEDDING_BATCH,
          AI_RETRY_CONFIGS.EMBEDDING,
        );
        for (let i = 0; i < batch.length; i++) {
          allChunks[start + i]!.embedding = embeddings[i];
        }
        dimensions = embeddings[0]?.length || dimensions;
        const done = Math.min(start + batch.length, allChunks.length);
        onProgress?.({ current: done, total: allChunks.length, phase: 'embedding' });
      }
      aiLogger.embedding.complete(allChunks.length, allChunks.length, dimensions);
    } catch (e) {
      aiLogger.embedding.error('batch', (e as Error).message);
      throw e;
    }

    onProgress?.({ current: 0, total: 2, phase: 'indexing' });
    aiLogger.store.saveChunks(bookHash, allChunks.length);
    await aiStore.saveChunks(allChunks);

    onProgress?.({ current: 1, total: 2, phase: 'indexing' });
    aiLogger.store.saveBM25(bookHash);
    await aiStore.saveBM25Index(bookHash, allChunks);

    const meta: BookIndexMeta = {
      bookHash,
      bookTitle: title,
      authorName: extractAuthor(bookDoc.metadata),
      totalSections: sections.length,
      totalChunks: allChunks.length,
      embeddingModel: embeddingModelName,
      lastUpdated: Date.now(),
    };
    aiLogger.store.saveMeta(meta);
    await aiStore.saveMeta(meta);

    onProgress?.({ current: 2, total: 2, phase: 'indexing' });
    aiLogger.rag.indexComplete(bookHash, allChunks.length, Date.now() - startTime);
  } catch (error) {
    aiLogger.rag.indexError(bookHash, (error as Error).message);
    throw error;
  }
}

export async function hybridSearch(
  bookHash: string,
  query: string,
  settings: AISettings,
  topK = 10,
  maxPage?: number,
): Promise<ScoredChunk[]> {
  aiLogger.search.query(query, maxPage);
  const provider = getAIProvider(settings);
  let queryEmbedding: number[] | null = null;

  try {
    // use AI SDK embed with provider's embedding model
    const { embedding } = await withRetryAndTimeout(
      () =>
        embed({
          model: provider.getEmbeddingModel(),
          value: query,
        }),
      AI_TIMEOUTS.EMBEDDING_SINGLE,
      AI_RETRY_CONFIGS.EMBEDDING,
    );
    queryEmbedding = embedding;
  } catch {
    // bm25 only fallback
  }

  const results = await aiStore.hybridSearch(bookHash, queryEmbedding, query, topK, maxPage);
  aiLogger.search.hybridResults(results.length, [...new Set(results.map((r) => r.searchMethod))]);
  return results;
}

export async function clearBookIndex(bookHash: string): Promise<void> {
  aiLogger.store.clear(bookHash);
  await aiStore.clearBook(bookHash);
}
