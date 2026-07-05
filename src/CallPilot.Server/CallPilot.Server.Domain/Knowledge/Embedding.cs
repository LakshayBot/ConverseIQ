namespace CallPilot.Server.Domain.Knowledge;

public class Embedding
{
    public Guid Id { get; private set; }
    public Guid ChunkId { get; private set; }
    public string Model { get; private set; }
    public int Dimensions { get; private set; }
    public DateTime CreatedAt { get; private set; }

    public KnowledgeChunk Chunk { get; private set; } = null!;

    private Embedding() { }

    public Embedding(Guid chunkId, float[] vector, string model)
    {
        Id = Guid.NewGuid();
        ChunkId = chunkId;
        SetVector(vector);
        Model = model;
        CreatedAt = DateTime.UtcNow;
    }

    public float[] GetVector()
    {
        return VectorData.Split(',').Select(float.Parse).ToArray();
    }

    public void SetVector(float[] vector)
    {
        Dimensions = vector.Length;
        VectorData = string.Join(",", vector.Select(v => v.ToString("F6")));
    }

    public string VectorData { get; private set; } = string.Empty;
}
