using System.Text.RegularExpressions;

namespace CallPilot.Server.Infrastructure.Knowledge;

public class ChunkingService
{
    private readonly int _maxChunkSize;
    private readonly int _chunkOverlap;

    public ChunkingService(int maxChunkSize = 1000, int chunkOverlap = 100)
    {
        _maxChunkSize = maxChunkSize;
        _chunkOverlap = chunkOverlap;
    }

    public List<TextChunk> ChunkText(string text, Guid documentId)
    {
        var chunks = new List<TextChunk>();
        if (string.IsNullOrWhiteSpace(text)) return chunks;

        var sentences = SplitSentences(text);
        var currentChunk = new System.Text.StringBuilder();
        int charOffset = 0;
        int chunkIndex = 0;

        foreach (var sentence in sentences)
        {
            if (currentChunk.Length + sentence.Length > _maxChunkSize && currentChunk.Length > 0)
            {
                chunks.Add(CreateChunk(documentId, chunkIndex++, currentChunk.ToString(), charOffset));
                charOffset += currentChunk.Length;

                var overlapStart = Math.Max(0, currentChunk.Length - _chunkOverlap);
                currentChunk.Clear();
                if (overlapStart > 0)
                {
                    currentChunk.Append(currentChunk.ToString().Substring(overlapStart));
                    charOffset -= _chunkOverlap;
                }
            }

            currentChunk.Append(sentence);
            currentChunk.Append(' ');
        }

        if (currentChunk.Length > 0)
        {
            chunks.Add(CreateChunk(documentId, chunkIndex, currentChunk.ToString().Trim(), charOffset));
        }

        return chunks;
    }

    private static TextChunk CreateChunk(Guid documentId, int index, string text, int offset)
    {
        return new TextChunk(
            documentId,
            index,
            text.Trim(),
            EstimateTokenCount(text),
            offset,
            text.Length);
    }

    private static List<string> SplitSentences(string text)
    {
        var sentences = Regex.Split(text, @"(?<=[.!?])\s+")
            .Where(s => !string.IsNullOrWhiteSpace(s))
            .ToList();

        if (sentences.Count == 0)
        {
            sentences.Add(text);
        }

        return sentences;
    }

    private static int EstimateTokenCount(string text)
    {
        return (int)Math.Ceiling(text.Split([' ', '\n', '\r', '\t'], StringSplitOptions.RemoveEmptyEntries).Length * 1.3);
    }
}

public class TextChunk
{
    public Guid DocumentId { get; }
    public int ChunkIndex { get; }
    public string Text { get; }
    public int TokenCount { get; }
    public int CharOffset { get; }
    public int CharLength { get; }

    public TextChunk(Guid documentId, int chunkIndex, string text, int tokenCount, int charOffset, int charLength)
    {
        DocumentId = documentId;
        ChunkIndex = chunkIndex;
        Text = text;
        TokenCount = tokenCount;
        CharOffset = charOffset;
        CharLength = charLength;
    }
}
