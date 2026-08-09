'use client';

// ProductDetailDrawer - the interactive product-management surface for the
// Knowledge Bank. Clicking a product chip opens this right-side drawer, which
// shows the live product intelligence from the backend, its enrichment status
// (Pending / Processing / Ready / Failed), where it was discovered, and the
// actions (Start enrichment / Reprocess / Retry / Delete).
//
// All data comes from the API (the product profile via useProductIntelligence,
// which polls while the product is still being enriched). Nothing is hard-coded
// or faked - Pending/Processing/Failed states reflect the real backend status.

import { useState } from 'react';
import { motion, AnimatePresence, useReducedMotion } from 'framer-motion';
import {
  X,
  RefreshCw,
  Trash2,
  LoaderIcon,
  FileText,
  ChevronDown,
  MapPin,
} from 'lucide-react';
import { toast } from 'sonner';
import { useProductIntelligence } from '@/hooks/useProductIntelligence';
import { enrichDocumentProduct, deleteDocumentProduct } from '@/lib/callpilotApi';
import { productStatusMeta, productStatusDotClass, isProductTerminal } from '@/lib/productStatus';
import { Section, Bullets, Chips, SpecRows, SourcesList } from '@/components/ProductIntelligenceCard';
import { cn } from '@/lib/utils';
import { EASE_OUT } from '@/lib/motion';

export interface DrawerProduct {
  name: string;
  canonical: string;
  displayName?: string;
  enrichmentStatus?: string;
  lastEnrichedAt?: string | null;
  sourcePage?: number | null;
  sourceChunk?: number | null;
}

interface Props {
  open: boolean;
  onClose: () => void;
  /** The document that discovered this product (for doc-scoped delete). */
  documentId: string;
  /** The document's file name, shown as the discovery source. */
  sourceDocument: string;
  product: DrawerProduct | null;
  /** Called after a successful delete so the parent can update its list. */
  onDeleted: (canonical: string) => void;
}

function timeAgo(iso: string | null | undefined): string {
  if (!iso) return '';
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return '';
  const s = Math.max(0, Math.floor((Date.now() - then) / 1000));
  if (s < 60) return 'just now';
  const m = Math.floor(s / 60);
  if (m < 60) return `${m} minute${m === 1 ? '' : 's'} ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h} hour${h === 1 ? '' : 's'} ago`;
  const d = Math.floor(h / 24);
  return `${d} day${d === 1 ? '' : 's'} ago`;
}

const StatusBadge: React.FC<{ status: string; spinning?: boolean }> = ({ status, spinning }) => {
  const meta = productStatusMeta(status);
  return (
    <span className="inline-flex items-center gap-1.5 rounded-full border border-[var(--opaline-outline-variant)] bg-[var(--opaline-surface-container-low)] px-2 py-0.5 text-[11px] font-medium text-[var(--opaline-on-surface)]">
      {spinning ? (
        <LoaderIcon className="h-2.5 w-2.5 animate-spin text-[var(--opaline-info)]" aria-hidden />
      ) : (
        <span aria-hidden className={cn('h-1.5 w-1.5 rounded-full', productStatusDotClass(meta.tone))} />
      )}
      {meta.label}
    </span>
  );
};

const Discovery: React.FC<{
  sourceDocument: string;
  sourcePage?: number | null;
  sourceChunk?: number | null;
}> = ({ sourceDocument, sourcePage, sourceChunk }) => (
  <Section title="Source">
    <div className="flex items-start gap-2 rounded-md bg-[var(--opaline-surface-container-low)] px-2.5 py-2">
      <FileText className="mt-0.5 h-3.5 w-3.5 shrink-0 text-[var(--opaline-outline)]" strokeWidth={1.75} aria-hidden />
      <div className="min-w-0">
        <p className="truncate text-xs font-medium text-[var(--opaline-on-surface)]">{sourceDocument}</p>
        <p className="mt-0.5 flex items-center gap-1 text-[11px] text-[var(--opaline-on-surface-variant)]">
          Extracted from uploaded document
          {sourcePage != null && (
            <span className="inline-flex items-center gap-0.5">
              <span className="mx-0.5" aria-hidden>·</span>
              <MapPin className="h-2.5 w-2.5" aria-hidden />
              Page {sourcePage}
              {sourceChunk != null && <> · chunk {sourceChunk}</>}
            </span>
          )}
        </p>
      </div>
    </div>
  </Section>
);

const RawIntelligence: React.FC<{ value: unknown }> = ({ value }) => {
  const [open, setOpen] = useState(false);
  const reduceMotion = useReducedMotion();
  if (value == null) return null;
  return (
    <div className="mt-4 border-t border-[var(--opaline-outline-variant)] pt-2.5">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        className="inline-flex items-center gap-1 font-mono text-[11px] text-[var(--opaline-outline)] transition-colors hover:text-[var(--opaline-on-surface-variant)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--opaline-primary)]"
      >
        <span className={cn('transition-transform duration-fast ease-out', open && 'rotate-180')}>
          <ChevronDown className="h-3 w-3" aria-hidden />
        </span>
        Raw intelligence
      </button>
      <AnimatePresence initial={false}>
        {open && (
          <motion.pre
            initial={reduceMotion ? false : { height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={reduceMotion ? undefined : { height: 0, opacity: 0 }}
            transition={{ duration: 0.2, ease: EASE_OUT }}
            className="overflow-hidden font-mono text-[11px] leading-relaxed text-[var(--opaline-on-surface-variant)]"
          >
            <code className="mt-1.5 block whitespace-pre-wrap rounded-md bg-[var(--opaline-surface-container-low)] px-2.5 py-2">
              {JSON.stringify(value, null, 2)}
            </code>
          </motion.pre>
        )}
      </AnimatePresence>
    </div>
  );
};

export const ProductDetailDrawer: React.FC<Props> = ({
  open,
  onClose,
  documentId,
  sourceDocument,
  product,
  onDeleted,
}) => {
  const reduceMotion = useReducedMotion();
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [actionBusy, setActionBusy] = useState(false);

  const lookupName = product?.displayName ?? product?.name ?? '';
  const { state, retry } = useProductIntelligence(
    open && !!product ? lookupName : null,
    open && product ? () => enrichDocumentProduct(documentId, product.canonical) : undefined,
  );

  const currentProfile =
    state.status === 'ready' || state.status === 'enriching' || state.status === 'failed'
      ? state.profile
      : null;
  const status =
    state.status === 'ready'
      ? currentProfile?.enrichmentStatus ?? 'Completed'
      : state.status === 'failed'
        ? 'Failed'
        : currentProfile?.enrichmentStatus ?? product?.enrichmentStatus ?? 'Pending';
  const meta = productStatusMeta(status);

  const handleAction = async () => {
    setActionBusy(true);
    try {
      await retry();
    } finally {
      setActionBusy(false);
    }
  };

  const handleDelete = async () => {
    if (!product) return;
    setDeleting(true);
    try {
      await deleteDocumentProduct(documentId, product.canonical);
      onDeleted(product.canonical);
      toast.success(`${product.displayName ?? product.name} removed from product intelligence`);
      setConfirmingDelete(false);
    } catch (e) {
      toast.error('Could not delete the product. Please try again.');
    } finally {
      setDeleting(false);
    }
  };

  const profile = state.status === 'ready' ? state.profile : null;
  const busy = state.status === 'loading';

  return (
    <AnimatePresence>
      {open && product && (
        <div className="fixed inset-0 z-50">
          <motion.button
            type="button"
            aria-label="Close product intelligence"
            initial={reduceMotion ? false : { opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={reduceMotion ? undefined : { opacity: 0 }}
            transition={{ duration: 0.18, ease: EASE_OUT }}
            onClick={onClose}
            className="absolute inset-0 h-full w-full cursor-default bg-black/30"
          />
          <motion.aside
            role="dialog"
            aria-modal="true"
            aria-label={`${product.displayName ?? product.name} product intelligence`}
            initial={reduceMotion ? false : { x: 40, opacity: 0 }}
            animate={{ x: 0, opacity: 1 }}
            exit={reduceMotion ? undefined : { x: 40, opacity: 0 }}
            transition={{ duration: 0.22, ease: EASE_OUT }}
            className="absolute right-0 top-0 flex h-full w-full max-w-[440px] flex-col border-l border-[var(--opaline-outline-variant)] bg-[var(--opaline-surface-container-lowest)] shadow-xl"
          >
            {/* Header */}
            <header className="flex items-start justify-between gap-3 border-b border-[var(--opaline-outline-variant)] px-5 py-4">
              <div className="min-w-0">
                <p className="text-overline text-[var(--opaline-on-surface-variant)]">Product intelligence</p>
                <div className="mt-1 flex flex-wrap items-center gap-2">
                  <h3 className="font-display text-headline-md break-words text-[var(--opaline-on-surface)]">
                    {product.displayName ?? product.name}
                  </h3>
                  <StatusBadge status={status} spinning={status === 'Enriching'} />
                </div>
              </div>
              <button
                type="button"
                onClick={onClose}
                aria-label="Close"
                className="shrink-0 rounded-md p-1.5 text-[var(--opaline-on-surface-variant)] transition-colors hover:bg-[var(--opaline-surface-container-low)] hover:text-[var(--opaline-on-surface)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--opaline-primary)]"
              >
                <X className="h-4 w-4" aria-hidden />
              </button>
            </header>

            {/* Body */}
            <div className="custom-scrollbar min-h-0 flex-1 overflow-y-auto px-5 py-4">
              {busy ? (
                <div className="flex flex-col gap-3">
                  <div className="animate-shimmer space-y-2 rounded-md border border-[var(--opaline-outline-variant)] p-3">
                    <div className="h-2.5 w-3/4 rounded bg-[var(--opaline-surface-container-low)]" />
                    <div className="h-2.5 w-full rounded bg-[var(--opaline-surface-container-low)]" />
                    <div className="h-2.5 w-5/6 rounded bg-[var(--opaline-surface-container-low)]" />
                  </div>
                </div>
              ) : (
                <div className="flex flex-col gap-1">
                  <Discovery
                    sourceDocument={sourceDocument}
                    sourcePage={product.sourcePage}
                    sourceChunk={product.sourceChunk}
                  />

                  {status === 'Enriching' && (
                    <Section title="Status">
                      <div className="flex items-center gap-2 text-[13px] text-[var(--opaline-on-surface-variant)]">
                        <LoaderIcon className="h-3.5 w-3.5 animate-spin text-[var(--opaline-info)]" aria-hidden />
                        Researching product information…
                      </div>
                    </Section>
                  )}

                  {status === 'Pending' && (
                    <Section title="Status">
                      <p className="text-[13px] leading-relaxed text-[var(--opaline-on-surface-variant)]">
                        {meta.description}
                      </p>
                    </Section>
                  )}

                  {status === 'Failed' && (
                    <Section title="Status">
                      <div className="space-y-1.5">
                        <p className="text-[13px] font-medium text-[var(--opaline-on-surface)]">Enrichment failed</p>
                        <p className="text-[13px] leading-relaxed text-[var(--opaline-on-surface-variant)]">
                          {meta.description}
                        </p>
                      </div>
                    </Section>
                  )}

                  {profile && (
                    <>
                      {profile.description && (
                        <Section title="Overview">
                          <p className="text-[13px] leading-[1.55] text-[var(--opaline-on-surface-variant)]">
                            {profile.description}
                          </p>
                        </Section>
                      )}
                      {profile.whatItDoes && (
                        <Section title="What it is">
                          <p className="text-[13px] leading-[1.55] text-[var(--opaline-on-surface-variant)]">
                            {profile.whatItDoes}
                          </p>
                        </Section>
                      )}
                      {profile.keySpecifications.length > 0 && (
                        <Section title="Key specifications">
                          <SpecRows items={profile.keySpecifications} />
                        </Section>
                      )}
                      {profile.keyFeatures.length > 0 && (
                        <Section title="Capabilities">
                          <Bullets items={profile.keyFeatures} />
                        </Section>
                      )}
                      {profile.useCases.length > 0 && (
                        <Section title="Use cases">
                          <Bullets items={profile.useCases} />
                        </Section>
                      )}
                      {profile.standoutPoints.length > 0 && (
                        <Section title="Standout points">
                          <Bullets items={profile.standoutPoints} />
                        </Section>
                      )}
                      {profile.targetIndustries.length > 0 && (
                        <Section title="Target industries">
                          <Chips items={profile.targetIndustries} />
                        </Section>
                      )}
                      {profile.variants.length > 0 && (
                        <Section title="Variants">
                          <Chips items={profile.variants} />
                        </Section>
                      )}
                      {profile.limitations.length > 0 && (
                        <Section title="Limitations">
                          <Bullets items={profile.limitations} />
                        </Section>
                      )}

                      {state.status === 'ready' && state.sources.length > 0 && (
                        <div className="pt-2.5">
                          <SourcesList sources={state.sources} />
                        </div>
                      )}

                      <RawIntelligence value={profile} />
                    </>
                  )}

                  {!profile && !isProductTerminal(status) && status !== 'Failed' && status !== 'Pending' && (
                    <p className="pt-2 text-caption text-[var(--opaline-on-surface-variant)]">
                      Enrichment is queued for the background worker.
                    </p>
                  )}
                </div>
              )}
            </div>

            {/* Footer */}
            <footer className="border-t border-[var(--opaline-outline-variant)] px-5 py-3.5">
              {confirmingDelete ? (
                <div className="space-y-2.5">
                  <div>
                    <p className="text-[13px] font-medium text-[var(--opaline-on-surface)]">
                      Delete {product.displayName ?? product.name}?
                    </p>
                    <p className="mt-0.5 text-xs leading-relaxed text-[var(--opaline-on-surface-variant)]">
                      Remove this product from the knowledge base? This removes its stored product intelligence
                      and enrichment data. The source document is not affected.
                    </p>
                  </div>
                  <div className="flex justify-end gap-2">
                    <button
                      type="button"
                      onClick={() => setConfirmingDelete(false)}
                      disabled={deleting}
                      className="rounded-lg px-3 py-1.5 text-xs font-medium text-[var(--opaline-on-surface-variant)] transition-colors hover:bg-[var(--opaline-surface-container-low)] disabled:opacity-50"
                    >
                      Cancel
                    </button>
                    <button
                      type="button"
                      onClick={handleDelete}
                      disabled={deleting}
                      className="inline-flex items-center gap-1.5 rounded-lg bg-[var(--opaline-danger)] px-3 py-1.5 text-xs font-medium text-[var(--opaline-on-danger)] transition-colors hover:opacity-90 disabled:opacity-50"
                    >
                      {deleting && <LoaderIcon className="h-3 w-3 animate-spin" />}
                      Delete
                    </button>
                  </div>
                </div>
              ) : (
                <div className="flex items-center justify-between gap-3">
                  <p className="min-w-0 text-[11px] text-[var(--opaline-on-surface-variant)]">
                    {profile?.lastEnrichedAt || product.lastEnrichedAt
                      ? <>Last enriched: {timeAgo(profile?.lastEnrichedAt ?? product.lastEnrichedAt)}</>
                      : meta.description}
                  </p>
                  <div className="flex shrink-0 items-center gap-2">
                    {status !== 'Enriching' && (
                      <button
                        type="button"
                        onClick={handleAction}
                        disabled={busy || actionBusy}
                        className="inline-flex items-center gap-1.5 rounded-lg bg-[var(--opaline-primary)] px-3 py-1.5 text-xs font-medium text-[var(--opaline-on-primary)] transition-colors hover:bg-[var(--opaline-primary-hover)] disabled:cursor-not-allowed disabled:opacity-50"
                      >
                        {actionBusy && <LoaderIcon className="h-3 w-3 animate-spin" />}
                        <RefreshCw className="h-3 w-3" aria-hidden />
                        {status === 'Pending' ? 'Start enrichment' : status === 'Failed' ? 'Retry' : 'Reprocess'}
                      </button>
                    )}
                    <button
                      type="button"
                      onClick={() => setConfirmingDelete(true)}
                      disabled={deleting}
                      aria-label="Delete product"
                      title="Delete product"
                      className="rounded-lg p-1.5 text-[var(--opaline-on-surface-variant)] transition-colors hover:bg-[var(--opaline-error-container)] hover:text-[var(--opaline-on-error-container)] disabled:opacity-50"
                    >
                      <Trash2 className="h-3.5 w-3.5" aria-hidden />
                    </button>
                  </div>
                </div>
              )}
            </footer>
          </motion.aside>
        </div>
      )}
    </AnimatePresence>
  );
};
