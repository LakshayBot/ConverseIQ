'use client';

// useProductIntelligence - loads a product's cached intelligence profile.
//
// Drives the ProductIntelligenceCard states:
//   loading   → first fetch in flight
//   enriching → server row exists but research is still running (poll until
//               it lands, up to ~60s, then stop - re-selecting refetches)
//   ready     → Completed / NeedsReview profile + its sources
//   failed    → enrichment failed or fetch error (fallback + retry surface)
//
// Research itself happens server-side (Tavily + LLM in the AI engine,
// persisted in PostgreSQL) - the UI never triggers web requests directly
// and never repeats enrichment for a cached product.

import { useCallback, useEffect, useState } from 'react';
import {
  enrichProduct,
  getProductIntelligence,
  getProductSources,
  type ProductIntelligenceProfile,
  type ProductSourceInfo,
} from '@/lib/callpilotApi';

export type ProductIntelState =
  | { status: 'idle' }
  | { status: 'loading'; profile: null }
  | { status: 'enriching'; profile: ProductIntelligenceProfile | null }
  | { status: 'ready'; profile: ProductIntelligenceProfile; sources: ProductSourceInfo[] }
  | { status: 'failed'; profile: ProductIntelligenceProfile | null; error?: string };

const POLL_INTERVAL_MS = 4000;
const MAX_POLLS = 15;

export function useProductIntelligence(
  productName: string | null,
  onEnrich?: () => Promise<void>,
): {
  state: ProductIntelState;
  retry: () => void;
} {
  const [state, setState] = useState<ProductIntelState>({ status: 'idle' });
  const [pollCount, setPollCount] = useState(0);
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    if (!productName) {
      setState({ status: 'idle' });
      return;
    }

    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    setState({ status: 'loading', profile: null });
    setPollCount(0);

    (async () => {
      try {
        const dto = await getProductIntelligence(productName);
        if (cancelled) return;

        const status = dto?.enrichmentStatus ?? 'Failed';
        if (dto && (status === 'Completed' || status === 'NeedsReview')) {
          let sources: ProductSourceInfo[] = [];
          try {
            sources = await getProductSources(productName);
          } catch {
            sources = [];
          }
          if (!cancelled) setState({ status: 'ready', profile: dto, sources });
        } else if (dto && status === 'Failed') {
          if (!cancelled) setState({ status: 'failed', profile: dto, error: dto.lastError ?? undefined });
        } else if (dto) {
          // Pending / Enriching - show the research-in-progress state and
          // poll until the server finishes. Stop after a bounded number of
          // attempts so we never hammer the API.
          if (!cancelled) setState({ status: 'enriching', profile: dto });
          if (pollCount < MAX_POLLS) {
            timer = setTimeout(() => setPollCount((c) => c + 1), POLL_INTERVAL_MS);
          }
        } else {
          if (!cancelled) setState({ status: 'failed', profile: null, error: 'No product intelligence available' });
        }
      } catch (e) {
        if (!cancelled) setState({ status: 'failed', profile: null, error: String(e) });
      }
    })();

    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, [productName, pollCount, reloadKey]);

  const retry = useCallback(() => {
    if (!productName) return;
    // Ask the server for a fresh research run, then reload the profile. The
    // caller can supply a document-scoped enrich action (drawer) or fall back
    // to the global one (rail card).
    (onEnrich ? onEnrich() : enrichProduct(productName))
      .catch(() => {})
      .finally(() => {
        setPollCount(0);
        setReloadKey((k) => k + 1);
      });
  }, [productName, onEnrich]);

  return { state, retry };
}
