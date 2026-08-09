using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace CallPilot.Server.Infrastructure.Data.Migrations
{
    /// <inheritdoc />
    public partial class AddProductIntelligence : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<Guid>(
                name: "ProductIntelligenceId",
                table: "ConversationEvents",
                type: "uuid",
                nullable: true);

            migrationBuilder.CreateTable(
                name: "ProductIntelligences",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uuid", nullable: false),
                    CanonicalName = table.Column<string>(type: "character varying(300)", maxLength: 300, nullable: false),
                    DisplayName = table.Column<string>(type: "character varying(300)", maxLength: 300, nullable: false),
                    Manufacturer = table.Column<string>(type: "character varying(300)", maxLength: 300, nullable: true),
                    Category = table.Column<string>(type: "character varying(200)", maxLength: 200, nullable: true),
                    Description = table.Column<string>(type: "text", nullable: true),
                    WhatItDoes = table.Column<string>(type: "text", nullable: true),
                    UseCases = table.Column<string>(type: "jsonb", nullable: false),
                    TargetIndustries = table.Column<string>(type: "jsonb", nullable: false),
                    KeyFeatures = table.Column<string>(type: "jsonb", nullable: false),
                    KeySpecifications = table.Column<string>(type: "jsonb", nullable: false),
                    StandoutPoints = table.Column<string>(type: "jsonb", nullable: false),
                    Variants = table.Column<string>(type: "jsonb", nullable: false),
                    Limitations = table.Column<string>(type: "jsonb", nullable: false),
                    SearchQuery = table.Column<string>(type: "character varying(500)", maxLength: 500, nullable: true),
                    SearchStatus = table.Column<int>(type: "integer", nullable: false),
                    EnrichmentStatus = table.Column<int>(type: "integer", nullable: false),
                    ConfidenceScore = table.Column<double>(type: "double precision", nullable: false),
                    CreatedAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: false),
                    UpdatedAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: true),
                    LastEnrichedAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: true),
                    LastError = table.Column<string>(type: "text", nullable: true)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_ProductIntelligences", x => x.Id);
                });

            migrationBuilder.CreateTable(
                name: "ProductSources",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uuid", nullable: false),
                    ProductIntelligenceId = table.Column<Guid>(type: "uuid", nullable: false),
                    Title = table.Column<string>(type: "character varying(500)", maxLength: 500, nullable: false),
                    Url = table.Column<string>(type: "character varying(1000)", maxLength: 1000, nullable: false),
                    Domain = table.Column<string>(type: "character varying(300)", maxLength: 300, nullable: true),
                    SourceType = table.Column<string>(type: "character varying(50)", maxLength: 50, nullable: false),
                    Snippet = table.Column<string>(type: "text", nullable: true),
                    RelevanceScore = table.Column<double>(type: "double precision", nullable: false),
                    RetrievedAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_ProductSources", x => x.Id);
                    table.ForeignKey(
                        name: "FK_ProductSources_ProductIntelligences_ProductIntelligenceId",
                        column: x => x.ProductIntelligenceId,
                        principalTable: "ProductIntelligences",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateIndex(
                name: "IX_ProductIntelligences_CanonicalName",
                table: "ProductIntelligences",
                column: "CanonicalName",
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_ProductIntelligences_Category",
                table: "ProductIntelligences",
                column: "Category");

            migrationBuilder.CreateIndex(
                name: "IX_ProductIntelligences_EnrichmentStatus",
                table: "ProductIntelligences",
                column: "EnrichmentStatus");

            migrationBuilder.CreateIndex(
                name: "IX_ProductIntelligences_Manufacturer",
                table: "ProductIntelligences",
                column: "Manufacturer");

            migrationBuilder.CreateIndex(
                name: "IX_ProductSources_ProductIntelligenceId",
                table: "ProductSources",
                column: "ProductIntelligenceId");

            migrationBuilder.CreateIndex(
                name: "IX_ConversationEvents_ProductIntelligenceId",
                table: "ConversationEvents",
                column: "ProductIntelligenceId");

            migrationBuilder.AddForeignKey(
                name: "FK_ConversationEvents_ProductIntelligences_ProductIntelligenceId",
                table: "ConversationEvents",
                column: "ProductIntelligenceId",
                principalTable: "ProductIntelligences",
                principalColumn: "Id",
                onDelete: ReferentialAction.SetNull);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropTable(
                name: "ProductSources");

            migrationBuilder.DropTable(
                name: "ProductIntelligences");

            migrationBuilder.DropForeignKey(
                name: "FK_ConversationEvents_ProductIntelligences_ProductIntelligenceId",
                table: "ConversationEvents");

            migrationBuilder.DropColumn(
                name: "ProductIntelligenceId",
                table: "ConversationEvents");
        }
    }
}
