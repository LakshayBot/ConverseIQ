using System.Text.Json;

namespace CallPilot.Server.Infrastructure.Integrations;

/// <summary>
/// Slack Block Kit builders for each notification type. All methods return a
/// plain object[] (serializable blocks array) and enforce Slack's limits:
/// max 50 blocks per message, max 3000 chars per text field. No raw JSON or
/// code blocks ever reach a message.
/// </summary>
public static class SlackMessageBuilder
{
    private const int MaxBlocks = 50;
    private const int MaxTextLength = 3000;

    // ── Battle card (keyword + contextual) ─────────────────────────────────

    public static object[] BuildBattleCardMessage(BattleCardNotification n)
    {
        var blocks = new List<object>
        {
            Header($"{(n.TriggerType == "contextual" ? "🎯 Context match" : "🎯 Battle card")} · {n.Product}"),
        };

        if (!string.IsNullOrWhiteSpace(n.TalkingPoint))
        {
            blocks.Add(Section($"*Talking point*\n>{Truncate(n.TalkingPoint)}"));
        }

        if (n.TriggerType == "contextual" && !string.IsNullOrWhiteSpace(n.TriggerSpan))
        {
            blocks.Add(Section($"*Buyer said*\n\"{Truncate(n.TriggerSpan, 600)}\""));
        }

        var triggerLabel = n.TriggerType == "contextual" ? "contextual match" : "keyword";
        blocks.Add(Fields("Priority", n.Priority ?? "—",
            "Confidence", $"{Math.Round(n.Confidence * 100)}%",
            "Trigger", triggerLabel));

        blocks.Add(MeetingContext(n.MeetingId, n.References));
        return Finalize(blocks);
    }

    // ── Live signal (objection / competitor mention) ───────────────────────

    public static object[] BuildLiveSignalMessage(LiveSignalNotification n)
    {
        var blocks = new List<object>
        {
            Header($"⚡ {n.EventType} detected"),
        };

        if (!string.IsNullOrWhiteSpace(n.EntityName))
        {
            blocks.Add(Section($"*{Truncate(n.EntityName, 200)}*"));
        }
        if (!string.IsNullOrWhiteSpace(n.SupportingTranscript))
        {
            blocks.Add(Section(Quote(Truncate(n.SupportingTranscript, 600))));
        }

        blocks.Add(MeetingContext(n.MeetingId, null));
        return Finalize(blocks);
    }

    // ── Post-call summary ──────────────────────────────────────────────────

    public static object[] BuildSummaryMessage(SummaryNotification n)
    {
        var data = ParseSummaryData(n.SummaryJson);
        var blocks = new List<object>
        {
            Header($"📋 Call summary · {n.BuyerCompany ?? "Deal"}"),
        };

        if (!string.IsNullOrWhiteSpace(data?.Summary))
        {
            blocks.Add(Section(Truncate(data.Summary)));
        }

        if (data?.KeyPoints is { Count: > 0 })
        {
            blocks.Add(BulletedSection("Key points", data.KeyPoints, 5));
        }
        if (data?.Decisions is { Count: > 0 })
        {
            blocks.Add(BulletedSection("Decisions", data.Decisions, 5));
        }
        if (data?.ActionItems is { Count: > 0 })
        {
            blocks.Add(ActionItemsSection(data.ActionItems, 8));
        }

        blocks.Add(MeetingContext(n.MeetingId, null));
        return Finalize(blocks);
    }

    // ── Action items ───────────────────────────────────────────────────────

    public static object[] BuildActionItemsMessage(ActionItemsNotification n)
    {
        var blocks = new List<object>
        {
            Header($"✅ Action items · {n.BuyerCompany ?? "Deal"}"),
        };

        if (n.ActionItems.Count > 0)
        {
            blocks.Add(ActionItemsSection(n.ActionItems, 10));
        }
        else
        {
            blocks.Add(Section("No actionable items found in this meeting."));
        }

        blocks.Add(MeetingContext(n.MeetingId, null));
        return Finalize(blocks);
    }

    // ── Shared helpers ─────────────────────────────────────────────────────

    /// <summary>Action item bullet rows, shared by summary + action items.</summary>
    public static string ActionItemBullet(ActionItemDto a) =>
        $"• [{(a.Priority ?? "low").ToUpperInvariant()}] {Truncate(a.Title ?? "", 300)} → {a.Assignee ?? "unassigned"}";

    private static object ActionItemsSection(List<ActionItemDto> items, int max) =>
        Section(Bulleted("Action items",
            items.Take(max).Select(ActionItemBullet), out var more, max)
            + (more > 0 ? $"\n… and {more} more" : ""));

    private static string Bulleted(string title, IEnumerable<string> items, out int remaining, int max)
    {
        var list = items.ToList();
        remaining = Math.Max(0, list.Count - max);
        var lines = list.Take(max).Select(i => $"• {i}");
        return $"*{title}*\n{string.Join("\n", lines)}";
    }

    private static object BulletedSection(string title, List<string> items, int max) =>
        Section(Bulleted(title, items, out var more, max)
            + (more > 0 ? $"\n… and {more} more" : ""));

    private static object MeetingContext(Guid meetingId, List<string>? references)
    {
        var link = $"<https://calls.reppify.live/{meetingId}|Open in Reppify>";
        var text = $"Meeting · {link}";
        if (references is { Count: > 0 })
        {
            text += " · Sources: " + string.Join(", ", references.Take(3).Select(r => Truncate(r, 60)));
        }
        return new { type = "context", elements = new[] { new { type = "mrkdwn", text } } };
    }

    private static object Header(string text) =>
        new { type = "header", text = new { type = "plain_text", text = Truncate(text, 150) } };

    private static object Section(string text) =>
        new { type = "section", text = new { type = "mrkdwn", text = Truncate(text) } };

    /// <summary>Two-column mrkdwn fields block (label/value pairs).</summary>
    private static object Fields(params string[] labelValuePairs)
    {
        var fields = new List<object>();
        for (var i = 0; i + 1 < labelValuePairs.Length; i += 2)
        {
            fields.Add(new
            {
                type = "mrkdwn",
                text = $"*{labelValuePairs[i]}*\n{Truncate(labelValuePairs[i + 1], 200)}",
            });
        }
        return new { type = "section", fields = fields.ToArray() };
    }

    private static string Quote(string text) => "> " + text.Replace("\n", "\n> ");

    private static string Truncate(string? text, int max = MaxTextLength)
    {
        var s = text ?? string.Empty;
        return s.Length <= max ? s : s[..(max - 1)] + "…";
    }

    /// <summary>Slack caps messages at 50 blocks — trim and add a counter.</summary>
    private static object[] Finalize(List<object> blocks)
    {
        if (blocks.Count <= MaxBlocks) return blocks.ToArray();
        var trimmed = blocks.Take(MaxBlocks - 1).ToList();
        trimmed.Add(new { type = "context", elements = new[] { new { type = "mrkdwn", text = $"… and {blocks.Count - trimmed.Count} more blocks" } } });
        return trimmed.ToArray();
    }

    /// <summary>
    /// Parses the Meeting.SummaryJson blob's `data` field into a typed DTO.
    /// Tolerates the legacy string[] actionItems shape (skips those entries).
    /// </summary>
    public static SummaryData? ParseSummaryData(string? summaryJson)
    {
        if (string.IsNullOrWhiteSpace(summaryJson)) return null;
        try
        {
            using var doc = JsonDocument.Parse(summaryJson);
            if (!doc.RootElement.TryGetProperty("data", out var data) ||
                data.ValueKind != JsonValueKind.Object)
            {
                return null;
            }

            var sd = new SummaryData();
            if (data.TryGetProperty("summary", out var summary) && summary.ValueKind == JsonValueKind.String)
            {
                sd.Summary = summary.GetString();
            }
            sd.KeyPoints = ReadStringList(data, "keyPoints");
            sd.Decisions = ReadStringList(data, "decisions");

            if (data.TryGetProperty("actionItems", out var items) && items.ValueKind == JsonValueKind.Array)
            {
                foreach (var item in items.EnumerateArray())
                {
                    if (item.ValueKind != JsonValueKind.Object) continue; // legacy string entry
                    var dto = new ActionItemDto(
                        item.TryGetProperty("title", out var t) ? t.GetString() ?? "" : "",
                        item.TryGetProperty("assignee", out var a) ? a.GetString() ?? "unassigned" : "unassigned",
                        item.TryGetProperty("priority", out var p) ? p.GetString() ?? "low" : "low",
                        item.TryGetProperty("source", out var s) ? s.GetString() ?? "action_item" : "action_item");
                    if (dto.Title.Length > 0) sd.ActionItems.Add(dto);
                }
            }
            return sd;
        }
        catch (JsonException)
        {
            return null;
        }
    }

    private static List<string> ReadStringList(JsonElement parent, string property)
    {
        var list = new List<string>();
        if (parent.TryGetProperty(property, out var arr) && arr.ValueKind == JsonValueKind.Array)
        {
            foreach (var item in arr.EnumerateArray())
            {
                if (item.ValueKind == JsonValueKind.String && item.GetString() is { Length: > 0 } s)
                {
                    list.Add(s);
                }
            }
        }
        return list;
    }
}

/// <summary>Typed view of the summary blob's data field (schema mirrors the
/// desktop LocalSummary payload).</summary>
public sealed class SummaryData
{
    public string? Summary { get; set; }
    public List<string> KeyPoints { get; set; } = [];
    public List<string> Decisions { get; set; } = [];
    public List<ActionItemDto> ActionItems { get; set; } = [];
}
