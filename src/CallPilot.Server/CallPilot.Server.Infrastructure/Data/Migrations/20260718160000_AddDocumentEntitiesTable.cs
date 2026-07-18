using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace CallPilot.Server.Infrastructure.Data.Migrations
{
    /// <summary>
    /// Adds the DocumentEntities table that GLiNER writes to.  This table
    /// existed in earlier databases via EnsureCreatedAsync but was never
    /// captured in a migration, so fresh databases (post the MigrateAsync
    /// migration in Program.cs) are missing it.  The Up body uses raw SQL
    /// wrapped in try/catch via IF NOT EXISTS so the migration is safe to
    /// re-run against the partially-built state we hit in dev.
    /// </summary>
    public partial class AddDocumentEntitiesTable : Migration
    {
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.Sql(@"
CREATE TABLE IF NOT EXISTS ""DocumentEntities"" (
  ""Id"" uuid NOT NULL,
  ""ChunkId"" uuid NULL,
  ""Confidence"" double precision NOT NULL,
  ""CreatedAt"" timestamp with time zone NOT NULL,
  ""DocumentId"" uuid NOT NULL,
  ""EntityText"" varchar(300) NOT NULL,
  ""EntityType"" varchar(50) NOT NULL,
  CONSTRAINT ""PK_DocumentEntities"" PRIMARY KEY (""Id"")
);");
            migrationBuilder.Sql(@"
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'FK_DocumentEntities_KnowledgeChunks_ChunkId') THEN
    ALTER TABLE ""DocumentEntities""
      ADD CONSTRAINT ""FK_DocumentEntities_KnowledgeChunks_ChunkId""
      FOREIGN KEY (""ChunkId"") REFERENCES ""KnowledgeChunks""(""Id"") ON DELETE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'FK_DocumentEntities_KnowledgeDocuments_DocumentId') THEN
    ALTER TABLE ""DocumentEntities""
      ADD CONSTRAINT ""FK_DocumentEntities_KnowledgeDocuments_DocumentId""
      FOREIGN KEY (""DocumentId"") REFERENCES ""KnowledgeDocuments""(""Id"") ON DELETE CASCADE;
  END IF;
END$$;");
            migrationBuilder.Sql(@"CREATE INDEX IF NOT EXISTS ""IX_DocumentEntities_ChunkId"" ON ""DocumentEntities"" (""ChunkId"");");
            migrationBuilder.Sql(@"CREATE INDEX IF NOT EXISTS ""IX_DocumentEntities_DocumentId"" ON ""DocumentEntities"" (""DocumentId"");");
            migrationBuilder.Sql(@"CREATE INDEX IF NOT EXISTS ""IX_DocumentEntities_EntityText_EntityType"" ON ""DocumentEntities"" (""EntityText"", ""EntityType"");");
        }

        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.Sql(@"DROP TABLE IF EXISTS ""DocumentEntities"" CASCADE;");
        }
    }
}
