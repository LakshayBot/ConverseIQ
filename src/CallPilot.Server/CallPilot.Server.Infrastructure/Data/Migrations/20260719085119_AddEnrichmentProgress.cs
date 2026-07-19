using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace CallPilot.Server.Infrastructure.Data.Migrations
{
    /// <summary>
    /// Adds the <c>EnrichmentProgressJson</c> jsonb column on
    /// <c>KnowledgeDocuments</c>.  The background enrichment task writes
    /// to it after each page completes so the dashboard polls (every
    /// ~1.5s) can render per-page status in real time rather than just
    /// showing "enriching" for the duration of the batch.
    ///
    /// Hand-edited to use <c>ADD COLUMN IF NOT EXISTS</c> for
    /// idempotency, matching the rest of the migration set.
    /// </summary>
    public partial class AddEnrichmentProgress : Migration
    {
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.Sql(@"
ALTER TABLE ""KnowledgeDocuments""
  ADD COLUMN IF NOT EXISTS ""EnrichmentProgressJson"" jsonb NULL;
");
        }

        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.Sql(@"
ALTER TABLE ""KnowledgeDocuments""
  DROP COLUMN IF EXISTS ""EnrichmentProgressJson"";
");
        }
    }
}
