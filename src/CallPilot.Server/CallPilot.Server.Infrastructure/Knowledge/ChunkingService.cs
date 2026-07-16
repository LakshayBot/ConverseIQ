using System.Text;
using System.Text.Json;
using System.Text.RegularExpressions;

namespace CallPilot.Server.Infrastructure.Knowledge;

/// <summary>
/// Structure-aware text chunker. Splits on paragraph boundaries (\n\n), keeps
/// heading lines attached to the paragraph that follows them, keeps bullet groups
/// together, and emits a JSON metadata blob on every chunk so downstream code can
/// filter by section / chunk type / page.
///
/// The chunker is deliberately conservative: a paragraph is never split in the
/// middle. If a single paragraph exceeds the soft cap it is still emitted as one
/// chunk, with chunk_type="oversized" so callers can re-chunk or skip it.
/// </summary>
public class ChunkingService
{
    // Soft cap. Larger than the old 1000-char flat cap because we no longer split
    // paragraphs in the middle — a feature list or table row often runs 1500+ chars
    // and we'd rather keep it intact than fragment it.
    private const int SoftCap = 2000;

    public List<TextChunk> ChunkText(string text, Guid documentId)
    {
        var structured = ChunkStructuredText(text, documentId, sourceMode: "fast");
        var chunks = new List<TextChunk>(structured.Count);
        var runningOffset = 0;
        for (var i = 0; i < structured.Count; i++)
        {
            var s = structured[i];
            chunks.Add(new TextChunk(
                documentId,
                i,
                s.Text,
                EstimateTokenCount(s.Text),
                runningOffset,
                s.Text.Length,
                s.SectionHeading,
                s.ChunkType,
                s.Pages.FirstOrDefault(),
                SerializeMetadata(s)));
            runningOffset += s.Text.Length + 1; // +1 for the implicit inter-chunk space
        }
        return chunks;
    }

    /// <summary>
    /// Split a document's extracted text into structure-aware chunks.
    /// </summary>
    /// <param name="text">Flat text from an extractor (Docnet / Docling markdown / etc.).</param>
    /// <param name="documentId">Owning document id (stamped on every chunk).</param>
    /// <param name="sourceMode">"fast" for flat extraction, "structured" for Docling output.</param>
    /// <param name="pageHint">Optional 1-based page number for the first page.</param>
    public List<StructuredChunk> ChunkStructuredText(
        string text,
        Guid documentId,
        string sourceMode,
        int? pageHint = null)
    {
        var chunks = new List<StructuredChunk>();
        if (string.IsNullOrWhiteSpace(text)) return chunks;

        // 1. Split into raw paragraph blocks by blank lines. Form-feeds (from PDF
        //    page boundaries in some extractors) also act as block separators and
        //    bump the page counter.
        var blocks = new List<RawBlock>();
        var currentPage = pageHint ?? 1;
        var currentText = new StringBuilder();
        var currentLineIsBullet = false;

        void Flush()
        {
            if (currentText.Length == 0) return;
            var t = currentText.ToString().Trim();
            if (t.Length > 0)
            {
                blocks.Add(new RawBlock(t, currentLineIsBullet, currentPage));
            }
            currentText.Clear();
            currentLineIsBullet = false;
        }

        foreach (var rawLine in text.Split('\n'))
        {
            var line = rawLine.TrimEnd('\r');

            if (line.Contains('\f'))
            {
                Flush();
                foreach (var segment in line.Split('\f'))
                {
                    if (segment.Length > 0)
                    {
                        blocks.Add(new RawBlock(segment.Trim(), IsBullet(segment), currentPage));
                    }
                    currentPage++;
                }
                continue;
            }

            if (string.IsNullOrWhiteSpace(line))
            {
                Flush();
                continue;
            }

            var isBullet = IsBullet(line);
            if (currentText.Length > 0 && isBullet != currentLineIsBullet)
            {
                // Bullet vs non-bullet transition: end the current block so we
                // don't merge a paragraph with the next bullet group.
                Flush();
            }

            currentLineIsBullet = isBullet;
            currentText.AppendLine(line);
        }
        Flush();

        // 2. Walk blocks. Headings get attached to the *next* non-heading block.
        //    Bullet groups stay as one chunk. Everything else is one paragraph per chunk.
        var pendingHeading = (string?)null;
        var i = 0;
        while (i < blocks.Count)
        {
            var block = blocks[i];

            if (IsHeadingLine(block.Text))
            {
                // Coalesce consecutive headings (rare but possible: title + subtitle).
                var heading = new StringBuilder(block.Text);
                while (i + 1 < blocks.Count && IsHeadingLine(blocks[i + 1].Text))
                {
                    i++;
                    heading.AppendLine().Append(blocks[i].Text);
                }
                pendingHeading = heading.ToString().Trim();
                i++;
                continue;
            }

            var chunkType = block.IsBulletLine
                ? "bullet_group"
                : block.Text.Length > SoftCap
                    ? "oversized_paragraph"
                    : "paragraph";

            // If the paragraph is short, optionally absorb the *next* block if it's
            // a closely related paragraph (e.g. continuing sentence). We only do
            // this when both are short to keep chunks coherent.
            var combined = new StringBuilder(block.Text);
            var pages = new List<int> { block.Page };
            while (combined.Length < 800 && i + 1 < blocks.Count
                && !blocks[i + 1].IsBulletLine && !IsHeadingLine(blocks[i + 1].Text))
            {
                i++;
                combined.Append("\n\n").Append(blocks[i].Text);
                pages.Add(blocks[i].Page);
            }

            chunks.Add(new StructuredChunk(
                documentId,
                combined.ToString().Trim(),
                pendingHeading,
                chunkType,
                pages,
                sourceMode));

            pendingHeading = null;
            i++;
        }

        return chunks;
    }

    private static int EstimateTokenCount(string text) =>
        (int)Math.Ceiling(text.Split([' ', '\n', '\r', '\t'], StringSplitOptions.RemoveEmptyEntries).Length * 1.3);

    private static bool IsBullet(string line)
    {
        if (line.Length == 0) return false;
        var c = line[0];
        return c == '•' || c == '-' || c == '*' || c == '–' || c == '·'
            || line.StartsWith("! ", StringComparison.Ordinal)        // "!" prefix used in some PDFs
            || Regex.IsMatch(line, @"^\d+[.)]\s");                     // "1." / "2)"
    }

    private static bool IsHeadingLine(string line)
    {
        if (line.Length == 0 || line.Length > 120) return false;
        if (line.EndsWith('.') || line.EndsWith(':') || line.EndsWith(',')) return false;
        // Mostly letters, very short, often title-cased — heuristic only, but
        // enough to keep section titles attached to their content.
        var letterCount = line.Count(char.IsLetter);
        if (letterCount < 3) return false;
        if (letterCount / (double)line.Length < 0.5) return false;
        var words = line.Split(' ', StringSplitOptions.RemoveEmptyEntries);
        if (words.Length > 10) return false;
        var titleCased = words.Count(w => w.Length > 1 && char.IsUpper(w[0]));
        return titleCased >= Math.Max(2, words.Length - 1);
    }

    private static string SerializeMetadata(StructuredChunk s)
    {
        var dict = new Dictionary<string, object?>
        {
            ["chunk_type"] = s.ChunkType,
            ["source_mode"] = s.SourceMode,
            ["section_heading"] = s.SectionHeading,
            ["pages"] = s.Pages,
        };
        return JsonSerializer.Serialize(dict);
    }

    private record RawBlock(string Text, bool IsBulletLine, int Page);
}

/// <summary>
/// Intermediate chunk record before mapping to the persistence model. Carries
/// everything the chunker knows about the chunk so callers (e.g. the Docling
/// pipeline in Phase 2) can pass extra metadata through without re-parsing.
/// </summary>
public record StructuredChunk(
    Guid DocumentId,
    string Text,
    string? SectionHeading,
    string ChunkType,
    List<int> Pages,
    string SourceMode);

/// <summary>
/// Final chunk record consumed by KnowledgeUploadHandler when persisting to the
/// KnowledgeChunks table. Mirrors the persistence model 1:1 so the handler
/// doesn't have to remap.
/// </summary>
public record TextChunk(
    Guid DocumentId,
    int ChunkIndex,
    string Text,
    int TokenCount,
    int CharOffset,
    int CharLength,
    string? SectionHeading,
    string ChunkType,
    int PageHint,
    string MetadataJson);
