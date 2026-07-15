using UglyToad.PdfPig;
using UglyToad.PdfPig.Content;

namespace CallPilot.Server.Infrastructure.Knowledge;

public interface ITextExtractor
{
    bool CanExtract(string contentType);
    Task<string> ExtractTextAsync(Stream fileStream);
}

public class PdfTextExtractor : ITextExtractor
{
    public bool CanExtract(string contentType) =>
        contentType.Contains("pdf") || contentType == "application/pdf";

    public Task<string> ExtractTextAsync(Stream fileStream)
    {
        try
        {
            using var document = PdfDocument.Open(fileStream);
            var text = new System.Text.StringBuilder();

            foreach (var page in document.GetPages())
            {
                var pageText = page.Text;
                if (!string.IsNullOrWhiteSpace(pageText))
                {
                    text.AppendLine(pageText);
                }
            }

            return Task.FromResult(text.ToString().Trim());
        }
        catch
        {
            // Fall back to original naive extraction for corrupt PDFs
            fileStream.Position = 0;
            using var reader = new StreamReader(fileStream, leaveOpen: true);
            var raw = reader.ReadToEnd();
            if (raw.StartsWith("%PDF"))
            {
                return Task.FromResult(ExtractPdfTextFallback(raw));
            }
            return Task.FromResult(string.Empty);
        }
    }

    private static string ExtractPdfTextFallback(string pdfContent)
    {
        var text = new System.Text.StringBuilder();
        var lines = pdfContent.Split('\n');
        bool inStream = false;

        foreach (var line in lines)
        {
            if (line.Contains("BT")) { inStream = true; continue; }
            if (line.Contains("ET")) { inStream = false; continue; }
            if (inStream)
            {
                var matches = System.Text.RegularExpressions.Regex.Matches(line, @"\(([^)]*)\)");
                foreach (System.Text.RegularExpressions.Match match in matches)
                {
                    text.Append(match.Groups[1].Value);
                    text.Append(' ');
                }
            }
        }

        return text.ToString().Trim();
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
