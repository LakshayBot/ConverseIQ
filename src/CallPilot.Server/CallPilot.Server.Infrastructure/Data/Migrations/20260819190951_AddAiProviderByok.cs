using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace CallPilot.Server.Infrastructure.Data.Migrations
{
    /// <inheritdoc />
    public partial class AddAiProviderByok : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<string>(
                name: "EnrichmentModel",
                table: "KnowledgeDocuments",
                type: "character varying(200)",
                maxLength: 200,
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "EnrichmentProviderType",
                table: "KnowledgeDocuments",
                type: "character varying(100)",
                maxLength: 100,
                nullable: true);

            migrationBuilder.CreateTable(
                name: "AiUsageLogs",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uuid", nullable: false),
                    UserId = table.Column<Guid>(type: "uuid", nullable: false),
                    ProviderConfigurationId = table.Column<Guid>(type: "uuid", nullable: true),
                    ProviderType = table.Column<string>(type: "character varying(100)", maxLength: 100, nullable: false),
                    Model = table.Column<string>(type: "character varying(200)", maxLength: 200, nullable: true),
                    Feature = table.Column<string>(type: "character varying(100)", maxLength: 100, nullable: true),
                    RequestedAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: false),
                    InputTokens = table.Column<int>(type: "integer", nullable: true),
                    OutputTokens = table.Column<int>(type: "integer", nullable: true),
                    TotalTokens = table.Column<int>(type: "integer", nullable: true),
                    Success = table.Column<bool>(type: "boolean", nullable: false),
                    DurationMs = table.Column<int>(type: "integer", nullable: false),
                    EstimatedCostUsd = table.Column<decimal>(type: "numeric", nullable: true),
                    ErrorCode = table.Column<string>(type: "character varying(100)", maxLength: 100, nullable: true),
                    DocumentId = table.Column<Guid>(type: "uuid", nullable: true),
                    PageNumber = table.Column<int>(type: "integer", nullable: true)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_AiUsageLogs", x => x.Id);
                    table.ForeignKey(
                        name: "FK_AiUsageLogs_ProviderConfigurations_ProviderConfigurationId",
                        column: x => x.ProviderConfigurationId,
                        principalTable: "ProviderConfigurations",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.SetNull);
                    table.ForeignKey(
                        name: "FK_AiUsageLogs_Users_UserId",
                        column: x => x.UserId,
                        principalTable: "Users",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateTable(
                name: "ProviderLimitSnapshots",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uuid", nullable: false),
                    UserId = table.Column<Guid>(type: "uuid", nullable: false),
                    ProviderConfigurationId = table.Column<Guid>(type: "uuid", nullable: false),
                    SnapshotJson = table.Column<string>(type: "jsonb", nullable: false),
                    CapturedAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_ProviderLimitSnapshots", x => x.Id);
                    table.ForeignKey(
                        name: "FK_ProviderLimitSnapshots_ProviderConfigurations_ProviderConfi~",
                        column: x => x.ProviderConfigurationId,
                        principalTable: "ProviderConfigurations",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                    table.ForeignKey(
                        name: "FK_ProviderLimitSnapshots_Users_UserId",
                        column: x => x.UserId,
                        principalTable: "Users",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateTable(
                name: "UserFeaturePreferences",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uuid", nullable: false),
                    UserId = table.Column<Guid>(type: "uuid", nullable: false),
                    Feature = table.Column<string>(type: "character varying(100)", maxLength: 100, nullable: false),
                    ProviderConfigurationId = table.Column<Guid>(type: "uuid", nullable: true),
                    Model = table.Column<string>(type: "character varying(200)", maxLength: 200, nullable: true),
                    UpdatedAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_UserFeaturePreferences", x => x.Id);
                    table.ForeignKey(
                        name: "FK_UserFeaturePreferences_ProviderConfigurations_ProviderConfi~",
                        column: x => x.ProviderConfigurationId,
                        principalTable: "ProviderConfigurations",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.SetNull);
                    table.ForeignKey(
                        name: "FK_UserFeaturePreferences_Users_UserId",
                        column: x => x.UserId,
                        principalTable: "Users",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateIndex(
                name: "IX_AiUsageLogs_ProviderConfigurationId",
                table: "AiUsageLogs",
                column: "ProviderConfigurationId");

            migrationBuilder.CreateIndex(
                name: "IX_AiUsageLogs_UserId_RequestedAt",
                table: "AiUsageLogs",
                columns: new[] { "UserId", "RequestedAt" });

            migrationBuilder.CreateIndex(
                name: "IX_ProviderLimitSnapshots_ProviderConfigurationId_CapturedAt",
                table: "ProviderLimitSnapshots",
                columns: new[] { "ProviderConfigurationId", "CapturedAt" });

            migrationBuilder.CreateIndex(
                name: "IX_ProviderLimitSnapshots_UserId",
                table: "ProviderLimitSnapshots",
                column: "UserId");

            migrationBuilder.CreateIndex(
                name: "IX_UserFeaturePreferences_ProviderConfigurationId",
                table: "UserFeaturePreferences",
                column: "ProviderConfigurationId");

            migrationBuilder.CreateIndex(
                name: "IX_UserFeaturePreferences_UserId_Feature",
                table: "UserFeaturePreferences",
                columns: new[] { "UserId", "Feature" },
                unique: true);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropTable(
                name: "AiUsageLogs");

            migrationBuilder.DropTable(
                name: "ProviderLimitSnapshots");

            migrationBuilder.DropTable(
                name: "UserFeaturePreferences");

            migrationBuilder.DropColumn(
                name: "EnrichmentModel",
                table: "KnowledgeDocuments");

            migrationBuilder.DropColumn(
                name: "EnrichmentProviderType",
                table: "KnowledgeDocuments");
        }
    }
}
