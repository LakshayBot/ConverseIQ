using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace CallPilot.Server.Infrastructure.Data.Migrations
{
    /// <inheritdoc />
    public partial class AddConversationEvents : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.CreateTable(
                name: "ConversationEvents",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uuid", nullable: false),
                    MeetingId = table.Column<Guid>(type: "uuid", nullable: false),
                    EventType = table.Column<string>(type: "character varying(100)", maxLength: 100, nullable: false),
                    EntityName = table.Column<string>(type: "character varying(200)", maxLength: 200, nullable: true),
                    Confidence = table.Column<double>(type: "double precision", nullable: false),
                    SupportingTranscript = table.Column<string>(type: "character varying(1000)", maxLength: 1000, nullable: false),
                    DetectedAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_ConversationEvents", x => x.Id);
                });

            migrationBuilder.CreateIndex(
                name: "IX_ConversationEvents_MeetingId",
                table: "ConversationEvents",
                column: "MeetingId");

            migrationBuilder.CreateIndex(
                name: "IX_ConversationEvents_MeetingId_EventType",
                table: "ConversationEvents",
                columns: new[] { "MeetingId", "EventType" });
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropTable(
                name: "ConversationEvents");
        }
    }
}
