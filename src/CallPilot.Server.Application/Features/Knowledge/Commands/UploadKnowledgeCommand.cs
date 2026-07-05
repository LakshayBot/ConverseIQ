namespace CallPilot.Server.Application.Features.Knowledge.Commands;

public sealed record UploadKnowledgeCommand(Guid UserId, string FileName, string ContentType, long FileSize, Stream Content);
