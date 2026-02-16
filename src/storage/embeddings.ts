import OpenAI from 'openai';
import { Episode } from '../types.js';

let openai: OpenAI | null = null;

function getOpenAI(): OpenAI | null {
  if (!openai && (process.env.OPENAI_API_KEY || process.env.OPENAI_KEY)) {
    openai = new OpenAI({
      apiKey: process.env.OPENAI_API_KEY || process.env.OPENAI_KEY,
    });
  }
  return openai;
}

const EMBEDDING_MODEL = 'text-embedding-3-small';
const EMBEDDING_DIMENSIONS = 1536;

export async function generateEmbedding(text: string): Promise<number[] | null> {
  const client = getOpenAI();
  if (!client) {
    console.warn('No OpenAI API key found. Embeddings disabled.');
    return null;
  }

  try {
    const response = await client.embeddings.create({
      model: EMBEDDING_MODEL,
      input: text,
      dimensions: EMBEDDING_DIMENSIONS,
    });

    return response.data[0].embedding;
  } catch (error) {
    console.error('Failed to generate embedding:', error);
    return null;
  }
}

export function generateEmbeddingText(episode: Episode): string {
  const parts = [
    `Problem: ${episode.problem_summary}`,
    `Directory: ${episode.directory}`,
    `Environment: ${episode.environment}`,
    `Fix: ${episode.fix_sequence}`,
    `Keywords: ${episode.keywords}`,
  ];
  
  return parts.join('\n');
}

export async function generateEpisodeEmbedding(episode: Episode): Promise<number[] | null> {
  const text = generateEmbeddingText(episode);
  return generateEmbedding(text);
}

// Cosine similarity between two vectors
export function cosineSimilarity(a: number[], b: number[]): number {
  if (a.length !== b.length) return 0;
  
  let dotProduct = 0;
  let normA = 0;
  let normB = 0;
  
  for (let i = 0; i < a.length; i++) {
    dotProduct += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  
  if (normA === 0 || normB === 0) return 0;
  
  return dotProduct / (Math.sqrt(normA) * Math.sqrt(normB));
}

// Simple text-based similarity for when embeddings aren't available
export function textSimilarity(text1: string, text2: string): number {
  const words1 = new Set(text1.toLowerCase().split(/\s+/));
  const words2 = new Set(text2.toLowerCase().split(/\s+/));
  
  const intersection = new Set([...words1].filter(x => words2.has(x)));
  const union = new Set([...words1, ...words2]);
  
  return intersection.size / union.size;
}

// Extract keywords from text
export function extractKeywords(text: string): string[] {
  const commonWords = new Set([
    'the', 'a', 'an', 'and', 'or', 'but', 'in', 'on', 'at', 'to', 'for',
    'of', 'with', 'by', 'from', 'is', 'was', 'are', 'were', 'been', 'be',
    'have', 'has', 'had', 'do', 'does', 'did', 'will', 'would', 'could',
    'should', 'may', 'might', 'must', 'can', 'this', 'that', 'these',
    'those', 'i', 'you', 'he', 'she', 'it', 'we', 'they', 'what', 'which',
    'who', 'when', 'where', 'why', 'how', 'all', 'each', 'every', 'both',
    'few', 'more', 'most', 'other', 'some', 'such', 'no', 'nor', 'not',
    'only', 'own', 'same', 'so', 'than', 'too', 'very', 'just', 'error',
    'failed', 'fail', 'failed', 'file', 'module', 'import', 'export',
  ]);
  
  const words = text.toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter(word => word.length > 2 && !commonWords.has(word));
  
  // Return unique words, limited to top 10
  return [...new Set(words)].slice(0, 10);
}

// Calculate confidence score based on multiple factors
export function calculateConfidence(
  semanticSimilarity: number,
  projectMatch: boolean,
  commandSimilarity: number
): number {
  const weights = {
    semantic: 0.5,
    project: 0.3,
    command: 0.2,
  };
  
  const score = 
    weights.semantic * semanticSimilarity +
    weights.project * (projectMatch ? 1 : 0) +
    weights.command * commandSimilarity;
  
  return Math.min(score, 1);
}
