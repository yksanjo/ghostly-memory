import { Episode, RetrievalContext, RetrievalResult, ERROR_PATTERNS } from '../types.js';
import { getEpisodesByProject, searchEpisodesByText, getAllEpisodesWithEmbeddings } from '../storage/db.js';
import { generateEmbedding, cosineSimilarity, textSimilarity, calculateConfidence } from '../storage/embeddings.js';
import { hashProjectPath } from '../extraction/index.js';

// Confidence threshold for displaying suggestions
const CONFIDENCE_THRESHOLD = 0.75;

// Check if we should trigger retrieval
export function shouldRetrieve(context: RetrievalContext): boolean {
  // Always retrieve on command failure
  if (context.exit_code !== 0) {
    return true;
  }
  
  // Check for error patterns in stderr
  const lowerStderr = context.stderr.toLowerCase();
  if (ERROR_PATTERNS.some(pattern => lowerStderr.includes(pattern.toLowerCase()))) {
    return true;
  }
  
  return false;
}

// Retrieve similar episodes from memory
export async function retrieveSimilarEpisodes(
  context: RetrievalContext,
  maxResults: number = 3
): Promise<RetrievalResult[]> {
  const projectHash = hashProjectPath(context.cwd);
  const projectEpisodes = getEpisodesByProject(projectHash);
  
  if (projectEpisodes.length === 0) {
    return [];
  }
  
  const results: RetrievalResult[] = [];
  
  // Generate embedding for current error
  const currentErrorText = `Error: ${context.stderr}\nCommand: ${context.command}`;
  const currentEmbedding = await generateEmbedding(currentErrorText);
  
  for (const episode of projectEpisodes) {
    let similarity = 0;
    
    if (currentEmbedding && episode.embedding) {
      // Use embedding similarity
      similarity = cosineSimilarity(currentEmbedding, episode.embedding);
    } else {
      // Fallback to text similarity
      similarity = textSimilarity(
        `${episode.problem_summary} ${episode.keywords}`,
        `${context.stderr} ${context.command}`
      );
    }
    
    // Calculate confidence
    const projectMatch = episode.project_hash === projectHash;
    const commandSimilarity = textSimilarity(
      episode.problem_summary,
      context.stderr
    );
    
    const confidence = calculateConfidence(similarity, projectMatch, commandSimilarity);
    
    if (confidence >= CONFIDENCE_THRESHOLD) {
      results.push({
        episode,
        similarity,
        confidence,
      });
    }
  }
  
  // Sort by confidence and return top results
  return results
    .sort((a, b) => b.confidence - a.confidence)
    .slice(0, maxResults);
}

// Search memory by text query
export async function searchMemory(query: string, maxResults: number = 5): Promise<Episode[]> {
  // First try text search
  let episodes = searchEpisodesByText(query, maxResults);
  
  // If no results, try embedding search
  if (episodes.length === 0) {
    const queryEmbedding = await generateEmbedding(query);
    if (queryEmbedding) {
      const allWithEmbeddings = getAllEpisodesWithEmbeddings();
      
      const scored = allWithEmbeddings.map(episode => ({
        episode,
        similarity: episode.embedding 
          ? cosineSimilarity(queryEmbedding, episode.embedding)
          : 0,
      }));
      
      scored.sort((a, b) => b.similarity - a.similarity);
      episodes = scored.slice(0, maxResults).map(s => s.episode);
    }
  }
  
  return episodes;
}

// Format retrieval result for display
export function formatRetrievalResult(result: RetrievalResult): string {
  const { episode, confidence } = result;
  const date = new Date(episode.last_seen);
  const dateStr = date.toLocaleDateString();
  
  return `
💭 You hit something similar before:

Last time (${dateStr}):
- Problem: ${episode.problem_summary}
- Fix: ${episode.fix_sequence}

Occurrences: ${episode.occurrence_count}
Confidence: ${(confidence * 100).toFixed(0)}%
  `.trim();
}

// Generate suggested next step
export function suggestNextStep(result: RetrievalResult): string | null {
  const { episode } = result;
  const fixCommands = episode.fix_sequence.split(' && ');
  
  if (fixCommands.length > 0 && fixCommands[0].trim()) {
    return fixCommands[0].trim();
  }
  
  return null;
}

// Full retrieval with suggestion
export async function retrieveAndSuggest(context: RetrievalContext): Promise<{
  shouldShow: boolean;
  message: string | null;
  suggestedCommand: string | null;
}> {
  if (!shouldRetrieve(context)) {
    return {
      shouldShow: false,
      message: null,
      suggestedCommand: null,
    };
  }
  
  const results = await retrieveSimilarEpisodes(context, 1);
  
  if (results.length === 0) {
    return {
      shouldShow: false,
      message: null,
      suggestedCommand: null,
    };
  }
  
  const topResult = results[0];
  const message = formatRetrievalResult(topResult);
  const suggestedCommand = suggestNextStep(topResult);
  
  return {
    shouldShow: true,
    message,
    suggestedCommand,
  };
}
