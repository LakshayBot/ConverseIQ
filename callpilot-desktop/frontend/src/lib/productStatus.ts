'use client';

// Product enrichment status - the single shared representation used by the
// Knowledge Bank product chips, the product detail drawer, and anywhere a
// product lifecycle is shown. Backend values map 1:1 to the
// ProductIntelligence.EnrichmentState strings; only the DISPLAY differs
// (Enriching → "Processing").

export type ProductEnrichmentStatus =
  | 'Pending'
  | 'Enriching'
  | 'Completed'
  | 'Failed'
  | 'NeedsReview';

export type ProductStatusTone = 'neutral' | 'info' | 'success' | 'danger' | 'warning';

export interface ProductStatusMeta {
  label: string;
  tone: ProductStatusTone;
  /** Short, user-facing explanation for the detail drawer. */
  description: string;
}

export const PRODUCT_STATUS_META: Record<ProductEnrichmentStatus, ProductStatusMeta> = {
  Pending: {
    label: 'Pending',
    tone: 'neutral',
    description: 'Extracted from the document. Enrichment has not started yet.',
  },
  Enriching: {
    label: 'Processing',
    tone: 'info',
    description: 'Researching product information from external sources…',
  },
  Completed: {
    label: 'Ready',
    tone: 'success',
    description: 'Product intelligence has been gathered and is ready to use.',
  },
  Failed: {
    label: 'Failed',
    tone: 'danger',
    description:
      'The product was successfully extracted from the document, but external enrichment could not be completed.',
  },
  NeedsReview: {
    label: 'Partial',
    tone: 'warning',
    description: 'Some information was gathered, but enrichment is incomplete.',
  },
};

export function productStatusMeta(status?: string | null): ProductStatusMeta {
  return PRODUCT_STATUS_META[(status as ProductEnrichmentStatus) ?? 'Pending'] ?? PRODUCT_STATUS_META.Pending;
}

/** True when the product has settled and the UI should stop polling it. */
export function isProductTerminal(status?: string | null): boolean {
  return status === 'Completed' || status === 'Failed' || status === 'NeedsReview';
}

/** Maps a status tone to the chip classes used by the compact KB chips. */
export function productStatusChipClass(tone: ProductStatusTone): string {
  switch (tone) {
    case 'success': return 'chip-success';
    case 'info': return 'chip-info';
    case 'danger': return 'chip-danger';
    case 'warning': return 'chip-warning';
    default: return 'chip-neutral';
  }
}

/** Maps a status tone to the status-dot background class. */
export function productStatusDotClass(tone: ProductStatusTone): string {
  switch (tone) {
    case 'success': return 'bg-[var(--opaline-success)]';
    case 'info': return 'bg-[var(--opaline-info)]';
    case 'danger': return 'bg-[var(--opaline-danger)]';
    case 'warning': return 'bg-[var(--opaline-warning)]';
    default: return 'bg-[var(--opaline-outline)]';
  }
}
