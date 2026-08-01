using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace CallPilot.Server.Infrastructure.Data.Migrations
{
    /// <summary>
    /// Adds structure-aware metadata columns to KnowledgeChunks:
    ///   SectionHeading  - section title the chunk belongs to (e.g. "i-Credit 350")
    ///   ChunkType       - "paragraph" | "bullet_group" | "oversized_paragraph" | ...
    ///   PageHint        - 1-based source page (0 if unknown)
    ///   MetadataJson    - JSONB blob with arbitrary metadata (source_mode, pages, bbox)
    /// Also creates a GIN index on MetadataJson so structured filters stay fast.
    /// </summary>
    /// <remarks>
    /// Hand-written because the EF migration scaffolder is currently in a no-op
    /// state - the model snapshot already has these columns from a prior (later
    /// reverted) regeneration, so diffing the model against the snapshot produces
    /// an empty migration. This file ships the actual SQL the running DB needs.
    /// </remarks>
    public partial class AddChunkStructureMetadata : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<string>(
                name: "ChunkType",
                table: "KnowledgeChunks",
                type: "character varying(50)",
                maxLength: 50,
                nullable: false,
                defaultValue: "paragraph");

            migrationBuilder.AddColumn<string>(
                name: "MetadataJson",
                table: "KnowledgeChunks",
                type: "jsonb",
                nullable: true);

            migrationBuilder.AddColumn<int>(
                name: "PageHint",
                table: "KnowledgeChunks",
                type: "integer",
                nullable: false,
                defaultValue: 0);

            migrationBuilder.AddColumn<string>(
                name: "SectionHeading",
                table: "KnowledgeChunks",
                type: "character varying(500)",
                maxLength: 500,
                nullable: true);

            migrationBuilder.CreateIndex(
                name: "IX_KnowledgeChunks_MetadataJson",
                table: "KnowledgeChunks",
                column: "MetadataJson")
                .Annotation("Npgsql:IndexMethod", "gin");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropIndex(
                name: "IX_KnowledgeChunks_MetadataJson",
                table: "KnowledgeChunks");

            migrationBuilder.DropColumn(
                name: "ChunkType",
                table: "KnowledgeChunks");

            migrationBuilder.DropColumn(
                name: "MetadataJson",
                table: "KnowledgeChunks");

            migrationBuilder.DropColumn(
                name: "PageHint",
                table: "KnowledgeChunks");

            migrationBuilder.DropColumn(
                name: "SectionHeading",
                table: "KnowledgeChunks");
        }
    }
}
