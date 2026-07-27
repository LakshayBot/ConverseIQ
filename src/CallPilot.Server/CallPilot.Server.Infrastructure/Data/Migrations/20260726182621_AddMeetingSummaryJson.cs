using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace CallPilot.Server.Infrastructure.Data.Migrations
{
    /// <inheritdoc />
    public partial class AddMeetingSummaryJson : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<string>(
                name: "SummaryJson",
                table: "Meetings",
                type: "text",
                nullable: true);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropColumn(
                name: "SummaryJson",
                table: "Meetings");
        }
    }
}
