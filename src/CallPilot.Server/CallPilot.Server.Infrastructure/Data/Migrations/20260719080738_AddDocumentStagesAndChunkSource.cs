using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace CallPilot.Server.Infrastructure.Data.Migrations
{
    /// <summary>
    /// Adds the per-stage ingest log + last-error summary + raw-output
    /// cache to <c>KnowledgeDocuments</c>, and a <c>Source</c> column on
    /// <c>KnowledgeChunks</c> so the dashboard can split the chunks view
    /// by fast / structured / enriched.
    ///
    /// Hand-edited from the EF-generated output to use raw SQL with
    /// <c>IF NOT EXISTS</c> / <c>IF EXISTS</c> guards — matching the
    /// pattern in <c>20260718160000_AddDocumentEntitiesTable</c>.  The
    /// non-idempotent <c>AddColumn</c> / <c>DropColumn</c> EF emits by
    /// default is a footgun in dev where the schema can drift between
    /// containers (e.g. partial migrations that crashed mid-way).
    /// </summary>
    public partial class AddDocumentStagesAndChunkSource : Migration
    {
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            // ── KnowledgeDocuments: stage log + last error + raw output ──
            // All nullable jsonb so existing rows survive without
            // rewriting.  The dashboard treats NULL as "legacy document,
            // show the string-prefix fallback UI" rather than as an
            // error.
            migrationBuilder.Sql(@"ALTER TABLE ""KnowledgeDocuments"" ADD COLUMN IF NOT EXISTS ""StagesJson"" jsonb NULL;");
            migrationBuilder.Sql(@"ALTER TABLE ""KnowledgeDocuments"" ADD COLUMN IF NOT EXISTS ""LastErrorJson"" jsonb NULL;");
            migrationBuilder.Sql(@"ALTER TABLE ""KnowledgeDocuments"" ADD COLUMN IF NOT EXISTS ""RawOutputJson"" jsonb NULL;");

            // ── KnowledgeChunks: Source ──
            // NOT NULL with a server-side default so the ALTER is safe
            // on tables that already contain rows.  EF will read the
            // default back when it materialises a chunk.
            migrationBuilder.Sql(@"
ALTER TABLE ""KnowledgeChunks"" ADD COLUMN IF NOT EXISTS ""Source"" varchar(16) NOT NULL DEFAULT 'fast';
");

            // Backfill Source from existing ChunkType / MetadataJson so
            // the dashboard can split the chunks view correctly for
            // documents that were ingested before this migration.
            migrationBuilder.Sql(@"
UPDATE ""KnowledgeChunks""
SET ""Source"" = 'enriched'
WHERE ""ChunkType"" = 'product_card'
  AND ""Source"" <> 'enriched';
");
            migrationBuilder.Sql(@"
UPDATE ""KnowledgeChunks""
SET ""Source"" = 'structured'
WHERE ""ChunkType"" <> 'product_card'
  AND ""MetadataJson"" IS NOT NULL
  AND ""MetadataJson""::text LIKE '%source_mode%structured%'
  AND ""Source"" = 'fast';
");

            // GIN index on the new StagesJson jsonb so the dashboard's
            // per-stage queries (e.g. "any stage currently failed?")
            // stay fast as the table grows.  IF NOT EXISTS keeps the
            // migration idempotent.
            migrationBuilder.Sql(@"
CREATE INDEX IF NOT EXISTS ""IX_KnowledgeDocuments_StagesJson""
  ON ""KnowledgeDocuments"" USING gin (""StagesJson"");
");
        }

        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.Sql(@"DROP INDEX IF EXISTS ""IX_KnowledgeDocuments_StagesJson"";");
            migrationBuilder.Sql(@"ALTER TABLE ""KnowledgeDocuments"" DROP COLUMN IF EXISTS ""RawOutputJson"";");
            migrationBuilder.Sql(@"ALTER TABLE ""KnowledgeDocuments"" DROP COLUMN IF EXISTS ""LastErrorJson"";");
            migrationBuilder.Sql(@"ALTER TABLE ""KnowledgeDocuments"" DROP COLUMN IF EXISTS ""StagesJson"";");
            migrationBuilder.Sql(@"ALTER TABLE ""KnowledgeChunks"" DROP COLUMN IF EXISTS ""Source"";");
        }
    }
}
