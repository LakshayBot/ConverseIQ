using CallPilot.Server.Domain.Entities;
using Microsoft.EntityFrameworkCore;

namespace CallPilot.Server.Application.Features.Knowledge.Queries;

public sealed class GetKnowledgeHandler
{
    private readonly IApplicationDbContext _db;

    public GetKnowledgeHandler(IApplicationDbContext db)
    {
        _db = db;
    }

    public async Task<List<DocumentDto>> Handle(GetKnowledgeQuery query, CancellationToken ct)
    {
        return await _db.KnowledgeDocuments
            .Where(d => d.UserId == query.UserId)
            .OrderByDescending(d => d.CreatedAt)
            .Select(d => new DocumentDto(
                d.Id,
                d.FileName,
                d.ContentType,
                d.FileSize,
                d.ProcessingStatus,
                d.CreatedAt))
            .ToListAsync(ct);
    }

    public sealed record DocumentDto(
        Guid Id,
        string FileName,
        string ContentType,
        long FileSize,
        string ProcessingStatus,
        DateTime CreatedAt);
}
