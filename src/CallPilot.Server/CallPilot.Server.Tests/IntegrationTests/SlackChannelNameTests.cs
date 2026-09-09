using CallPilot.Server.Infrastructure.Integrations;
using Xunit;

namespace CallPilot.Server.Tests.IntegrationTests;

/// <summary>
/// Slack channel naming rules: #deal-{product}-{buyer-company}, lowercase
/// hyphenated, ≤80 chars, no special characters, "-general" fallback.
/// </summary>
public class SlackChannelNameTests
{
    [Fact]
    public void From_ProductAndCompany_BuildsDealChannel()
    {
        Assert.Equal("deal-prodigy-tata-power", SlackChannelName.From("Prodigy", "Tata Power"));
    }

    [Fact]
    public void From_NoCompany_FallsBackToGeneral()
    {
        Assert.Equal("deal-prodigy-general", SlackChannelName.From("Prodigy", null));
        Assert.Equal("deal-prodigy-general", SlackChannelName.From("Prodigy", "   "));
    }

    [Fact]
    public void From_SpecialCharacters_AreSlugged()
    {
        var name = SlackChannelName.From("Landis+Gyr 650", "Tata Power & Sons Ltd.");

        // Slack rules: lowercase, letters/digits/hyphens only, ≤ 80 chars,
        // no leading/trailing hyphens, no doubled hyphens.
        Assert.True(name.Length <= 80, $"too long: {name.Length}");
        Assert.Equal(name.ToLowerInvariant(), name);
        Assert.DoesNotContain(" ", name);
        Assert.DoesNotContain("+", name);
        Assert.DoesNotContain("&", name);
        Assert.DoesNotContain(".", name);
        Assert.DoesNotContain("--", name);
        Assert.StartsWith("deal-landis-gyr-650-", name);
        Assert.False(name.StartsWith('-'));
        Assert.False(name.EndsWith('-'));
    }

    [Fact]
    public void From_VeryLongNames_TruncatesTo80Chars()
    {
        var name = SlackChannelName.From(
            "Prodigy Ultra Precision High-End Transmission Metering Platform",
            "Tata Power Distribution And Transmission Company Limited Delhi Region");
        Assert.True(name.Length <= 80, $"too long: {name.Length}");
        Assert.False(name.EndsWith('-'));
    }
}
