namespace CallPilot.Server.Domain.Products;

/// <summary>
/// The validated, LLM-extracted product profile produced by the AI engine's
/// product research pipeline. Only fields actually supported by the gathered
/// sources are populated - empty means "unknown", never a hallucination.
/// </summary>
public record ProductEnrichmentResult(
    string DisplayName,
    string? Manufacturer,
    string? Category,
    string? Description,
    string? WhatItDoes,
    List<string> UseCases,
    List<string> TargetIndustries,
    List<string> KeyFeatures,
    List<string> KeySpecifications,
    List<string> StandoutPoints,
    List<string> Variants,
    List<string> Limitations,
    double ConfidenceScore,
    List<ProductSourceDraft> Sources,
    bool NeedsReview = false,
    string? SearchQuery = null);

/// <summary>Source descriptor from the engine, not yet persisted.</summary>
public record ProductSourceDraft(
    string Title,
    string Url,
    string? Domain,
    string SourceType,
    string? Snippet,
    double RelevanceScore);
