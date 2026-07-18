using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace CallPilot.Server.Infrastructure.Data.Migrations
{
    /// <inheritdoc />
    public partial class AddEnrichmentStatus : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<string>(
                name: "EnrichmentStatus",
                table: "KnowledgeDocuments",
                type: "character varying(50)",
                maxLength: 50,
                nullable: true);

            migrationBuilder.CreateIndex(
                name: "IX_KnowledgeDocuments_EnrichmentStatus",
                table: "KnowledgeDocuments",
                column: "EnrichmentStatus");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropIndex(
                name: "IX_KnowledgeDocuments_EnrichmentStatus",
                table: "KnowledgeDocuments");

            migrationBuilder.DropColumn(
                name: "EnrichmentStatus",
                table: "KnowledgeDocuments");
        }
    }
}
