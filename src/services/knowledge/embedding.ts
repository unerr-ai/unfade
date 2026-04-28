// FILE: src/services/knowledge/embedding.ts
// Layer 2.5 KE-16: Embedding infrastructure.
// Loads all-MiniLM-L6-v2 via @huggingface/transformers for local embedding
// generation. Produces 384d vectors for facts and 64d projected vectors for entities.
//
// Soft dependency: @huggingface/transformers is an optional dependency.
// If unavailable, loadEmbeddingModel() returns null and all downstream
// consumers (entity-resolver Pass 3, contradiction-detector HNSW) gracefully
// fall back to non-embedding paths. The product works perfectly without embeddings.
//
// Model is lazy-loaded on first embed() call, cached for process lifetime.
// Model files cached at ~/.unfade/models/ (or HF_HOME default).

import { freemem } from "node:os";
import { join } from "node:path";
import { logger } from "../../utils/logger.js";
import { getUnfadeHome } from "../../utils/paths.js";

// ─── Types ──────────────────────────────────────────────────────────────────

export interface EmbeddingModel {
  /** Generate a 384-dimensional embedding for a single text. */
  embed(text: string): Promise<number[]>;
  /** Generate 384-dimensional embeddings for a batch of texts. */
  embedBatch(texts: string[]): Promise<number[][]>;
  /** Whether the underlying model is loaded and ready. */
  isLoaded(): boolean;
  /** Release the model from memory. */
  unload(): void;
}

// ─── Constants ──────────────────────────────────────────────────────────────

const MODEL_NAME = "Xenova/all-MiniLM-L6-v2";
const EMBEDDING_DIM = 384;
const ENTITY_EMBEDDING_DIM = 64;
const MIN_FREE_MEMORY_BYTES = 1024 * 1024 * 1024; // 1 GB

// ─── Singleton ──────────────────────────────────────────────────────────────

let singleton: EmbeddingModel | null = null;

// ─── Public API ─────────────────────────────────────────────────────────────

/**
 * Load the embedding model (lazy singleton).
 *
 * Returns null if:
 *   - @huggingface/transformers is not installed (optional dependency)
 *   - System has < 1GB free memory
 *   - Model loading fails for any reason
 *
 * The model is cached for the process lifetime. Subsequent calls return
 * the same instance.
 */
export async function loadEmbeddingModel(
  homeOverride?: string,
): Promise<EmbeddingModel | null> {
  if (singleton) return singleton;

  if (freemem() < MIN_FREE_MEMORY_BYTES) {
    logger.debug("Skipping embedding model — insufficient free memory", {
      freeMemMB: Math.round(freemem() / 1024 / 1024),
      requiredMB: Math.round(MIN_FREE_MEMORY_BYTES / 1024 / 1024),
    });
    return null;
  }

  try {
    const model = await createTransformersModel(homeOverride);
    singleton = model;
    return model;
  } catch (err) {
    logger.debug("Embedding model unavailable — optional dependency @huggingface/transformers not installed or model load failed", {
      error: err instanceof Error ? err.message : String(err),
    });
    return null;
  }
}

/**
 * Create an embedFn for entity resolution (KE-10 Pass 3).
 * Produces 64-dimensional vectors by projecting 384d → 64d via mean-pooling.
 * Matches the CozoDB entity:semantic_vec HNSW index (dim: 64).
 */
export function createEntityEmbedFn(
  model: EmbeddingModel,
): (text: string) => Promise<number[]> {
  return async (text: string) => {
    const vec384 = await model.embed(text);
    return projectTo64d(vec384);
  };
}

/**
 * Create an embedFn for fact contradiction detection (KE-12 HNSW).
 * Returns native 384-dimensional vectors matching fact_embedding:fact_vec_idx.
 */
export function createFactEmbedFn(
  model: EmbeddingModel,
): (text: string) => Promise<number[]> {
  return (text: string) => model.embed(text);
}

// ─── Dimensionality Reduction ───────────────────────────────────────────────

/**
 * Project a 384-dimensional vector to 64 dimensions via mean-pooling.
 * Chunks the input into 64 groups of 6, averages each group.
 * Preserves more information than simple truncation.
 */
export function projectTo64d(vec384: number[]): number[] {
  if (vec384.length !== EMBEDDING_DIM) {
    throw new Error(`Expected ${EMBEDDING_DIM}d vector, got ${vec384.length}d`);
  }

  const chunkSize = EMBEDDING_DIM / ENTITY_EMBEDDING_DIM; // 6
  const result = new Array<number>(ENTITY_EMBEDDING_DIM);

  for (let i = 0; i < ENTITY_EMBEDDING_DIM; i++) {
    let sum = 0;
    const start = i * chunkSize;
    for (let j = start; j < start + chunkSize; j++) {
      sum += vec384[j];
    }
    result[i] = sum / chunkSize;
  }

  return result;
}

/**
 * Compute cosine similarity between two vectors of the same dimension.
 * Returns a value in [-1, 1] where 1 = identical direction.
 */
export function cosineSimilarity(a: number[], b: number[]): number {
  if (a.length !== b.length || a.length === 0) return 0;

  let dotProduct = 0;
  let normA = 0;
  let normB = 0;

  for (let i = 0; i < a.length; i++) {
    dotProduct += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }

  const denominator = Math.sqrt(normA) * Math.sqrt(normB);
  return denominator === 0 ? 0 : dotProduct / denominator;
}

// ─── @huggingface/transformers Provider ─────────────────────────────────────

async function createTransformersModel(
  homeOverride?: string,
): Promise<EmbeddingModel> {
  const hf = await import("@huggingface/transformers");

  const cacheDir = join(getUnfadeHome(homeOverride), "models");

  // Configure cache directory via env (transformers.js respects HF_HOME)
  if (hf.env) {
    hf.env.cacheDir = cacheDir;
  }

  let extractor: Awaited<ReturnType<typeof hf.pipeline>> | null = null;
  let loaded = false;

  async function ensureLoaded() {
    if (extractor) return;
    logger.debug("Loading embedding model", { model: MODEL_NAME, cacheDir });
    extractor = await hf.pipeline("feature-extraction", MODEL_NAME, {
      dtype: "fp32",
    });
    loaded = true;
    logger.debug("Embedding model loaded", { model: MODEL_NAME });
  }

  return {
    async embed(text: string): Promise<number[]> {
      await ensureLoaded();
      const output = await extractor!(text, { pooling: "mean", normalize: true });
      return Array.from(output.data as Float32Array).slice(0, EMBEDDING_DIM);
    },

    async embedBatch(texts: string[]): Promise<number[][]> {
      await ensureLoaded();
      const results: number[][] = [];
      for (const text of texts) {
        const output = await extractor!(text, { pooling: "mean", normalize: true });
        results.push(Array.from(output.data as Float32Array).slice(0, EMBEDDING_DIM));
      }
      return results;
    },

    isLoaded(): boolean {
      return loaded;
    },

    unload(): void {
      extractor = null;
      loaded = false;
      singleton = null;
    },
  };
}
