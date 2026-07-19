using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace CallPilot.Server.Infrastructure.Data.Migrations
{
    /// <inheritdoc />
    public partial class DropUniqueChunkIndex : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropIndex(
                name: "IX_KnowledgeChunks_DocumentId_ChunkIndex",
                table: "KnowledgeChunks");

            migrationBuilder.CreateIndex(
                name: "IX_KnowledgeChunks_DocumentId_ChunkIndex",
                table: "KnowledgeChunks",
                columns: new[] { "DocumentId", "ChunkIndex" });
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropIndex(
                name: "IX_KnowledgeChunks_DocumentId_ChunkIndex",
                table: "KnowledgeChunks");

            migrationBuilder.CreateIndex(
                name: "IX_KnowledgeChunks_DocumentId_ChunkIndex",
                table: "KnowledgeChunks",
                columns: new[] { "DocumentId", "ChunkIndex" },
                unique: true);
        }
    }
}
