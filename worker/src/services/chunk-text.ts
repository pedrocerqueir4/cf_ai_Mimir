/**
 * Chunks text into overlapping word-based segments for Vectorize embedding.
 *
 * Uses 300-word chunks (not 350) to stay safely below the bge-large-en-v1.5
 * 512-token limit — typical English text averages ~1.3 tokens/word, so
 * 300 words ≈ 390 tokens, leaving comfortable headroom.
 *
 * @param text - Plain text to chunk (strip Markdown before calling).
 * @param chunkWords - Target chunk size in words (default: 300).
 * @param overlapWords - Overlap between consecutive chunks in words (default: 50).
 * @returns Array of text chunks, each suitable for embedding.
 */
export function chunkText(text: string, chunkWords = 300, overlapWords = 50): string[] {
  const words = text.split(/\s+/).filter((w) => w.length > 0);
  const chunks: string[] = [];
  let start = 0;

  while (start < words.length) {
    const end = Math.min(start + chunkWords, words.length);
    chunks.push(words.slice(start, end).join(" "));
    if (end === words.length) break;
    start = end - overlapWords;
  }

  return chunks;
}
