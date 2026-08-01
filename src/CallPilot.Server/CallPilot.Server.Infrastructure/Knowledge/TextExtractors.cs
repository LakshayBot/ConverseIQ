using Docnet.Core;
using Docnet.Core.Models;
using Microsoft.Extensions.Logging;

namespace CallPilot.Server.Infrastructure.Knowledge;

public interface ITextExtractor
{
    bool CanExtract(string contentType);
    Task<string> ExtractTextAsync(Stream fileStream);
}

public class PdfTextExtractor : ITextExtractor
{
    private readonly ILogger<PdfTextExtractor>? _logger;

    public PdfTextExtractor() { }

    public PdfTextExtractor(ILogger<PdfTextExtractor> logger) => _logger = logger;

    public bool CanExtract(string contentType) =>
        contentType.Contains("pdf") || contentType == "application/pdf";

    public async Task<string> ExtractTextAsync(Stream fileStream)
    {
        // Docnet.Core takes a byte[] snapshot - drain the stream so the caller can
        // rewind/seek freely without us depending on the input stream type.
        if (fileStream.CanSeek)
        {
            fileStream.Position = 0;
        }
        using var ms = new MemoryStream();
        await fileStream.CopyToAsync(ms);
        var bytes = ms.ToArray();

        if (bytes.Length == 0)
        {
            _logger?.LogWarning("PDF extraction skipped: empty stream");
            return string.Empty;
        }

        var text = new System.Text.StringBuilder();
        int pagesWithText = 0;
        int pageCount = 0;

        using var library = DocLib.Instance;
        using var docReader = library.GetDocReader(bytes, new PageDimensions());
        pageCount = docReader.GetPageCount();

        for (var i = 0; i < pageCount; i++)
        {
            using var pageReader = docReader.GetPageReader(i);
            var pageText = pageReader.GetText();
            if (!string.IsNullOrWhiteSpace(pageText))
            {
                pagesWithText++;
                text.AppendLine(pageText);
            }
        }

        var result = text.ToString().Trim();
        _logger?.LogInformation(
            "Docnet extracted {Chars} chars from {Pages} page(s) (out of {Total} total)",
            result.Length, pagesWithText, pageCount);

        return result;
    }
}

public class DocxTextExtractor : ITextExtractor
{
    public bool CanExtract(string contentType) =>
        contentType.Contains("openxml") || contentType.Contains("docx") ||
        contentType == "application/vnd.openxmlformats-officedocument.wordprocessingml.document";

    public Task<string> ExtractTextAsync(Stream fileStream)
    {
        using var document = DocumentFormat.OpenXml.Packaging.WordprocessingDocument.Open(fileStream, false);
        var body = document.MainDocumentPart?.Document.Body;
        var text = body?.InnerText ?? string.Empty;
        return Task.FromResult(text.Trim());
    }
}

public class MarkdownTextExtractor : ITextExtractor
{
    public bool CanExtract(string contentType) =>
        contentType.Contains("markdown") || contentType.Contains("text/plain") ||
        contentType.Contains("text/markdown") || contentType.Contains("octet-stream") ||
        contentType.Contains("text/") || true; // Fallback for any text-based content

    public async Task<string> ExtractTextAsync(Stream fileStream)
    {
        using var reader = new StreamReader(fileStream);
        return (await reader.ReadToEndAsync()).Trim();
    }
}

public class TextExtractorFactory
{
    private readonly IReadOnlyList<ITextExtractor> _extractors;

    public TextExtractorFactory(IEnumerable<ITextExtractor> extractors)
    {
        _extractors = extractors.ToList();
    }

    public ITextExtractor? GetExtractor(string contentType)
    {
        return _extractors.FirstOrDefault(e => e.CanExtract(contentType))
            ?? _extractors.OfType<MarkdownTextExtractor>().FirstOrDefault();
    }
}
