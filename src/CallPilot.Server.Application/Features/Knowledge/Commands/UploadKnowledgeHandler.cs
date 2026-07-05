using CallPilot.Server.Domain.Entities;
using Microsoft.EntityFrameworkCore;

namespace CallPilot.Server.Application.Features.Knowledge.Commands;

public sealed class UploadKnowledgeHandler
{
    private readonly IApplicationDbContext _db;

    public UploadKnowledgeHandler(IApplicationDbContext db)
    {
        _db = db;
    }

    public async Task<Result> Handle(UploadKnowledgeCommand command, CancellationToken ct)
    {
        var uploadDir = Path.Combine("uploads", "knowledge", command.UserId.ToString());
        Directory.CreateDirectory(uploadDir);

        var filePath = Path.Combine(uploadDir, $"{Guid.NewGuid()}_{command.FileName}");
        await using (var fs = File.Create(filePath))
        {
            await command.Content.CopyToAsync(fs, ct);
        }

        var document = new KnowledgeDocument
        {
            Id = Guid.NewGuid(),
            UserId = command.UserId,
            FileName = command.FileName,
            ContentType = command.ContentType,
            FileSize = command.FileSize,
            StoragePath = filePath,
            ProcessingStatus = "Processing",
            CreatedAt = DateTime.UtcNow
        };

        _db.KnowledgeDocuments.Add(document);
        await _db.SaveChangesAsync(ct);

        var text = await ExtractTextAsync(filePath, command.ContentType);
        var chunks = ChunkText(text);

        foreach (var (chunkText, index) in chunks.Select((t, i) => (t, i)))
        {
            _db.KnowledgeChunks.Add(new KnowledgeChunk
            {
                Id = Guid.NewGuid(),
                DocumentId = document.Id,
                ChunkIndex = index,
                Text = chunkText,
                TokenCount = chunkText.Split(' ', StringSplitOptions.RemoveEmptyEntries).Length,
                CharStart = 0,
                CharEnd = chunkText.Length,
                CreatedAt = DateTime.UtcNow
            });
        }

        document.ProcessingStatus = "Ready";
        await _db.SaveChangesAsync(ct);

        return new Result(true, document.Id);
    }

    private static async Task<string> ExtractTextAsync(string filePath, string contentType)
    {
        if (contentType == "application/pdf")
        {
            return await ExtractPdfText(filePath);
        }
        if (contentType is "application/vnd.openxmlformats-officedocument.wordprocessingml.document" or "application/msword")
        {
            return await ExtractDocxText(filePath);
        }
        return await File.ReadAllTextAsync(filePath);
    }

    private static Task<string> ExtractPdfText(string filePath)
    {
        return Task.FromResult($"[PDF content from {Path.GetFileName(filePath)} - requires PdfPig or similar library for full extraction]");
    }

    private static Task<string> ExtractDocxText(string filePath)
    {
        return Task.FromResult($"[DOCX content from {Path.GetFileName(filePath)} - requires DocX or similar library for full extraction]");
    }

    private static List<string> ChunkText(string text, int maxChunkSize = 1000)
    {
        var chunks = new List<string>();
        var paragraphs = text.Split('\n', StringSplitOptions.RemoveEmptyEntries);

        var current = new System.Text.StringBuilder();
        foreach (var paragraph in paragraphs)
        {
            if (current.Length + paragraph.Length > maxChunkSize && current.Length > 0)
            {
                chunks.Add(current.ToString().Trim());
                current.Clear();
            }
            current.AppendLine(paragraph.Trim());
        }

        if (current.Length > 0)
            chunks.Add(current.ToString().Trim());

        return chunks.Count > 0 ? chunks : [text];
    }

    public sealed record Result(bool Success, Guid? DocumentId = null);
}
