'use client';

import { useEffect, useState } from 'react';
import { apiGetProductDetails, ProductDetails } from '@/lib/api';

interface Props {
  /** The most recent product entity name.  When this changes, the card re-fetches. */
  productName: string | null;
  /** Optional category label from the EventDetected payload (e.g. "product") */
  category?: string | null;
  /** Optional transcript snippet that triggered the mention */
  supportingTranscript?: string | null;
  onDismiss: () => void;
}

const TYPE_COLORS: Record<string, string> = {
  product: 'bg-blue-100 text-blue-700',
  feature: 'bg-purple-100 text-purple-700',
  integration: 'bg-amber-100 text-amber-700',
  pricing: 'bg-green-100 text-green-700',
  competitor: 'bg-red-100 text-red-700',
};

const TYPE_ICON: Record<string, string> = {
  product: '📦',
  feature: '✨',
  integration: '🔌',
  pricing: '💰',
  competitor: '🏷️',
};

function titleCase(s: string): string {
  return s
    .split(' ')
    .map(w => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ');
}

export default function ProductDetailsCard({ productName, category, supportingTranscript, onDismiss }: Props) {
  const [details, setDetails] = useState<ProductDetails | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!productName) {
      setDetails(null);
      return;
    }
    let cancelled = false;
    setLoading(true);
    setError(null);

    apiGetProductDetails(productName)
      .then(data => {
        if (cancelled) return;
        setDetails(data);
        setLoading(false);
      })
      .catch(err => {
        if (cancelled) return;
        setError(err instanceof Error ? err.message : String(err));
        setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [productName]);

  if (!productName) {
    return (
      <div className="bg-gray-50 border border-dashed border-gray-300 rounded-xl p-6 text-center">
        <div className="text-3xl mb-2">📦</div>
        <p className="text-sm text-gray-500">
          Mention a product to see its details here.
        </p>
        <p className="text-xs text-gray-400 mt-1">
          Detected mentions appear in the left panel and the card will populate automatically.
        </p>
      </div>
    );
  }

  const displayName = titleCase(productName);
  const typeKey = (category || details?.type || 'product').toLowerCase();
  const typeColor = TYPE_COLORS[typeKey] || 'bg-gray-100 text-gray-600';
  const typeIcon = TYPE_ICON[typeKey] || '📦';

  return (
    <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
      {/* Header */}
      <div className="p-4 border-b border-gray-100 bg-gradient-to-br from-blue-50 to-white">
        <div className="flex items-start justify-between gap-2">
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 mb-1">
              <span className="text-xl">{typeIcon}</span>
              <span className={`text-[10px] font-semibold uppercase tracking-wide px-1.5 py-0.5 rounded ${typeColor}`}>
                {typeKey}
              </span>
            </div>
            <h2 className="text-lg font-semibold text-gray-900 truncate">
              {displayName}
            </h2>
            {details && !details.notFound && details.confidence !== undefined && (
              <p className="text-xs text-gray-500 mt-0.5">
                Match confidence: {Math.round(details.confidence * 100)}%
              </p>
            )}
          </div>
          <button
            onClick={onDismiss}
            className="text-gray-400 hover:text-gray-600 text-sm flex-shrink-0"
            title="Dismiss"
          >
            ✕
          </button>
        </div>
      </div>

      {/* Body */}
      <div className="p-4 space-y-3">
        {loading && (
          <div className="text-sm text-gray-400 text-center py-4">
            Loading product details…
          </div>
        )}

        {error && (
          <div className="text-sm text-red-600 bg-red-50 p-2 rounded">
            Failed to load details: {error}
          </div>
        )}

        {details && details.notFound && (
          <div className="text-sm text-gray-600 bg-amber-50 border border-amber-200 p-3 rounded-lg">
            <p className="font-medium text-amber-900">No product details yet</p>
            <p className="text-xs text-amber-800 mt-1">
              This product isn't in the knowledge base. Upload the brochure in the Knowledge page to enrich the live call.
            </p>
          </div>
        )}

        {details && !details.notFound && details.description && (
          <p className="text-sm text-gray-700 leading-relaxed">
            {details.description}
          </p>
        )}

        {details && !details.notFound && details.documents.length > 0 && (
          <div>
            <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">
              Found in
            </h3>
            <div className="space-y-2">
              {details.documents.slice(0, 2).map(doc => (
                <div key={doc.id} className="bg-gray-50 rounded-lg p-3 text-sm">
                  <div className="flex items-center gap-2 mb-1">
                    <span className="font-medium text-gray-800 truncate">
                      📄 {doc.fileName}
                    </span>
                    {doc.pageHint > 0 && (
                      <span className="text-[10px] text-gray-500 bg-white px-1.5 py-0.5 rounded">
                        p. {doc.pageHint}
                      </span>
                    )}
                  </div>
                  {doc.sectionHeading && (
                    <p className="text-xs text-gray-600 italic mb-1">
                      {doc.sectionHeading}
                    </p>
                  )}
                  {doc.snippet && (
                    <p className="text-xs text-gray-600 line-clamp-3">
                      {doc.snippet}
                    </p>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}

        {supportingTranscript && (
          <details className="text-xs text-gray-500">
            <summary className="cursor-pointer hover:text-gray-700">
              Transcript context
            </summary>
            <p className="mt-2 italic p-2 bg-gray-50 rounded">
              "{supportingTranscript.length > 200
                ? supportingTranscript.slice(0, 200) + '…'
                : supportingTranscript}"
            </p>
          </details>
        )}
      </div>
    </div>
  );
}
