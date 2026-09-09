using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace CallPilot.Server.Infrastructure.Data.Migrations
{
    /// <inheritdoc />
    public partial class AddSlackIntegrationAndMeetingBuyerCompany : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<Guid>(
                name: "MatchedChunkId",
                table: "Recommendations",
                type: "uuid",
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "BuyerCompany",
                table: "Meetings",
                type: "character varying(300)",
                maxLength: 300,
                nullable: true);

            migrationBuilder.CreateTable(
                name: "SlackIntegrations",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uuid", nullable: false),
                    UserId = table.Column<Guid>(type: "uuid", nullable: false),
                    EncryptedBotToken = table.Column<string>(type: "character varying(1000)", maxLength: 1000, nullable: false),
                    TeamId = table.Column<string>(type: "character varying(64)", maxLength: 64, nullable: false),
                    TeamName = table.Column<string>(type: "character varying(300)", maxLength: 300, nullable: false),
                    BotUserId = table.Column<string>(type: "character varying(64)", maxLength: 64, nullable: false),
                    DefaultChannelId = table.Column<string>(type: "character varying(64)", maxLength: 64, nullable: true),
                    IsActive = table.Column<bool>(type: "boolean", nullable: false),
                    InstalledAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: false),
                    NotifyBattleCards = table.Column<bool>(type: "boolean", nullable: false),
                    NotifyLiveSignals = table.Column<bool>(type: "boolean", nullable: false),
                    NotifySummary = table.Column<bool>(type: "boolean", nullable: false),
                    NotifyActionItems = table.Column<bool>(type: "boolean", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_SlackIntegrations", x => x.Id);
                    table.ForeignKey(
                        name: "FK_SlackIntegrations_Users_UserId",
                        column: x => x.UserId,
                        principalTable: "Users",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateIndex(
                name: "IX_Meetings_BuyerCompany",
                table: "Meetings",
                column: "BuyerCompany");

            migrationBuilder.CreateIndex(
                name: "IX_SlackIntegrations_UserId",
                table: "SlackIntegrations",
                column: "UserId",
                unique: true);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropTable(
                name: "SlackIntegrations");

            migrationBuilder.DropIndex(
                name: "IX_Meetings_BuyerCompany",
                table: "Meetings");

            migrationBuilder.DropColumn(
                name: "MatchedChunkId",
                table: "Recommendations");

            migrationBuilder.DropColumn(
                name: "BuyerCompany",
                table: "Meetings");
        }
    }
}
