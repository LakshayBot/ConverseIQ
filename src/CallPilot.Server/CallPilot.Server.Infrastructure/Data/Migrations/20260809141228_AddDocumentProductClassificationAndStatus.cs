using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace CallPilot.Server.Infrastructure.Data.Migrations
{
    /// <inheritdoc />
    public partial class AddDocumentProductClassificationAndStatus : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<string>(
                name: "EnrichmentStatus",
                table: "DocumentEntities",
                type: "character varying(30)",
                maxLength: 30,
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "EntityCategory",
                table: "DocumentEntities",
                type: "character varying(40)",
                maxLength: 40,
                nullable: true);

            migrationBuilder.AddColumn<DateTime>(
                name: "LastEnrichedAt",
                table: "DocumentEntities",
                type: "timestamp with time zone",
                nullable: true);

            migrationBuilder.AddColumn<Guid>(
                name: "ProductIntelligenceId",
                table: "DocumentEntities",
                type: "uuid",
                nullable: true);

            migrationBuilder.CreateIndex(
                name: "IX_DocumentEntities_ProductIntelligenceId",
                table: "DocumentEntities",
                column: "ProductIntelligenceId");

            migrationBuilder.AddForeignKey(
                name: "FK_DocumentEntities_ProductIntelligences_ProductIntelligenceId",
                table: "DocumentEntities",
                column: "ProductIntelligenceId",
                principalTable: "ProductIntelligences",
                principalColumn: "Id",
                onDelete: ReferentialAction.SetNull);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropForeignKey(
                name: "FK_DocumentEntities_ProductIntelligences_ProductIntelligenceId",
                table: "DocumentEntities");

            migrationBuilder.DropIndex(
                name: "IX_DocumentEntities_ProductIntelligenceId",
                table: "DocumentEntities");

            migrationBuilder.DropColumn(
                name: "EnrichmentStatus",
                table: "DocumentEntities");

            migrationBuilder.DropColumn(
                name: "EntityCategory",
                table: "DocumentEntities");

            migrationBuilder.DropColumn(
                name: "LastEnrichedAt",
                table: "DocumentEntities");

            migrationBuilder.DropColumn(
                name: "ProductIntelligenceId",
                table: "DocumentEntities");
        }
    }
}
