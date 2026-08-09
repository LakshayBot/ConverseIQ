using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace CallPilot.Server.Infrastructure.Data.Migrations
{
    /// <inheritdoc />
    public partial class AddKnowledgeBaseAndProductScope : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropIndex(
                name: "IX_ProductIntelligences_CanonicalName",
                table: "ProductIntelligences");

            migrationBuilder.AddColumn<string>(
                name: "CompanyName",
                table: "ProductIntelligences",
                type: "character varying(300)",
                maxLength: 300,
                nullable: true);

            migrationBuilder.AddColumn<Guid>(
                name: "KnowledgeBaseId",
                table: "ProductIntelligences",
                type: "uuid",
                nullable: true);

            migrationBuilder.AddColumn<Guid>(
                name: "KnowledgeBaseId",
                table: "KnowledgeDocuments",
                type: "uuid",
                nullable: true);

            migrationBuilder.CreateTable(
                name: "KnowledgeBases",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uuid", nullable: false),
                    UserId = table.Column<Guid>(type: "uuid", nullable: false),
                    Name = table.Column<string>(type: "character varying(300)", maxLength: 300, nullable: false),
                    CompanyName = table.Column<string>(type: "character varying(300)", maxLength: 300, nullable: false),
                    Website = table.Column<string>(type: "character varying(500)", maxLength: 500, nullable: true),
                    Description = table.Column<string>(type: "text", nullable: true),
                    CreatedAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: false),
                    UpdatedAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: true)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_KnowledgeBases", x => x.Id);
                });

            migrationBuilder.CreateIndex(
                name: "IX_ProductIntelligences_CompanyName_CanonicalName",
                table: "ProductIntelligences",
                columns: new[] { "CompanyName", "CanonicalName" },
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_ProductIntelligences_KnowledgeBaseId",
                table: "ProductIntelligences",
                column: "KnowledgeBaseId");

            migrationBuilder.CreateIndex(
                name: "IX_KnowledgeDocuments_KnowledgeBaseId",
                table: "KnowledgeDocuments",
                column: "KnowledgeBaseId");

            migrationBuilder.CreateIndex(
                name: "IX_KnowledgeBases_CompanyName",
                table: "KnowledgeBases",
                column: "CompanyName");

            migrationBuilder.CreateIndex(
                name: "IX_KnowledgeBases_UserId",
                table: "KnowledgeBases",
                column: "UserId");

            migrationBuilder.AddForeignKey(
                name: "FK_KnowledgeDocuments_KnowledgeBases_KnowledgeBaseId",
                table: "KnowledgeDocuments",
                column: "KnowledgeBaseId",
                principalTable: "KnowledgeBases",
                principalColumn: "Id",
                onDelete: ReferentialAction.SetNull);

            migrationBuilder.AddForeignKey(
                name: "FK_ProductIntelligences_KnowledgeBases_KnowledgeBaseId",
                table: "ProductIntelligences",
                column: "KnowledgeBaseId",
                principalTable: "KnowledgeBases",
                principalColumn: "Id",
                onDelete: ReferentialAction.SetNull);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropForeignKey(
                name: "FK_KnowledgeDocuments_KnowledgeBases_KnowledgeBaseId",
                table: "KnowledgeDocuments");

            migrationBuilder.DropForeignKey(
                name: "FK_ProductIntelligences_KnowledgeBases_KnowledgeBaseId",
                table: "ProductIntelligences");

            migrationBuilder.DropTable(
                name: "KnowledgeBases");

            migrationBuilder.DropIndex(
                name: "IX_ProductIntelligences_CompanyName_CanonicalName",
                table: "ProductIntelligences");

            migrationBuilder.DropIndex(
                name: "IX_ProductIntelligences_KnowledgeBaseId",
                table: "ProductIntelligences");

            migrationBuilder.DropIndex(
                name: "IX_KnowledgeDocuments_KnowledgeBaseId",
                table: "KnowledgeDocuments");

            migrationBuilder.DropColumn(
                name: "CompanyName",
                table: "ProductIntelligences");

            migrationBuilder.DropColumn(
                name: "KnowledgeBaseId",
                table: "ProductIntelligences");

            migrationBuilder.DropColumn(
                name: "KnowledgeBaseId",
                table: "KnowledgeDocuments");

            migrationBuilder.CreateIndex(
                name: "IX_ProductIntelligences_CanonicalName",
                table: "ProductIntelligences",
                column: "CanonicalName",
                unique: true);
        }
    }
}
