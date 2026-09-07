using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace CallPilot.Server.Infrastructure.Data.Migrations
{
    /// <inheritdoc />
    public partial class AddRecommendationTriggerFields : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<string>(
                name: "TriggerSpan",
                table: "Recommendations",
                type: "text",
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "TriggerType",
                table: "Recommendations",
                type: "character varying(20)",
                maxLength: 20,
                nullable: false,
                defaultValue: "keyword");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropColumn(
                name: "TriggerSpan",
                table: "Recommendations");

            migrationBuilder.DropColumn(
                name: "TriggerType",
                table: "Recommendations");
        }
    }
}
