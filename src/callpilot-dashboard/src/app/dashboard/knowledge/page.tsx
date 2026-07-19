'use client';

import { useEffect, useState, useRef } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/lib/auth';
import {
  apiUploadKnowledge,
  apiGetKnowledgeDocuments,
  apiDeleteKnowledgeDocument,
  apiGetKnowledgeDocument,
  apiGetDocumentStatus,
  apiGetDocumentRawOutput,
  KnowledgeDocument,
  KnowledgeDocumentDetail,
  DocumentStatus,
  DocumentRawOutput,
} from '@/lib/api';
import ProcessingStepper from '@/components/ProcessingStepper';

const TERMINAL_PROCESSING = new Set(['Indexed', 'No extractable text found']);
const FAILURE_PREFIX = 'Error:';
const POLL_INTERVAL_MS = 1500;

function isLlmTerminal(s: string | null | undefined): boolean {
  return s === 'enriched' || s === 'enrichment_failed';
}

function isDocTerminal(doc: KnowledgeDocument | DocumentStatus): boolean {
  const processing = (doc as any).processingStatus;
  const enrichment = (doc as any).enrichmentStatus;
  const mainDone = TERMINAL_PROCESSING.has(processing) || processing?.startsWith?.(FAILURE_PREFIX);
  return Boolean(mainDone) && (isLlmTerminal(enrichment) || enrichment == null);
}

export default function KnowledgePage() {
  const { user, isLoading } = useAuth();
  const router = useRouter();
  const [docs, setDocs] = useState<KnowledgeDocument[]>([]);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [viewDoc, setViewDoc] = useState<KnowledgeDocumentDetail | null>(null);
  const [viewLoading, setViewLoading] = useState(false);
  const [activeTab, setActiveTab] = useState<'chunks' | 'entities' | 'raw' | 'pages' | 'errors'>('chunks');
  // Raw AI-engine output (Docling + LLM) for the "Raw" tab.  Fetched
  // once when the modal opens for a structured-mode document.
  const [viewRaw, setViewRaw] = useState<DocumentRawOutput | null>(null);
  const [viewRawLoading, setViewRawLoading] = useState(false);
  const [mode, setMode] = useState<'fast' | 'structured'>('structured');
  const [liveStatuses, setLiveStatuses] = useState<Record<string, DocumentStatus>>({});
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!isLoading && !user) { router.push('/login'); return; }
    loadDocs();
  }, [user, isLoading]);

  // Poll the lightweight status endpoint for any doc that's not in a
  // terminal state.  We track only the docs that are still in flight so
  // the poll loop stops itself once everything settles.
  useEffect(() => {
    if (docs.length === 0) return;
    const inFlight = docs.filter(d => !isDocTerminal(d));
    if (inFlight.length === 0) return;

    let cancelled = false;
    const tick = async () => {
      const results = await Promise.all(
        inFlight.map(async d => {
          const s = await apiGetDocumentStatus(d.id);
          if (!s) return null;
          return [d.id, s] as [string, DocumentStatus];
        })
      );
      if (cancelled) return;
      const updates: Record<string, DocumentStatus> = {};
      results.forEach(r => {
        if (!r) return;
        const [id, s] = r;
        updates[id] = s;
      });
      setLiveStatuses(prev => ({ ...prev, ...updates }));
    };
    tick();
    const interval = setInterval(tick, POLL_INTERVAL_MS);
    return () => { cancelled = true; clearInterval(interval); };
  }, [docs]);

  const loadDocs = async () => {
    try { setDocs(await apiGetKnowledgeDocuments()); } catch { /* empty */ }
  };

  const handleUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploading(true);
    setError(null);
    try {
      const result = await apiUploadKnowledge(file, mode);
      // Pre-seed live status with the upload response so the stepper has
      // something to render before the first poll lands.  Stages are
      // empty here — the first /status poll backfills them.  mode is
      // echoed from the request so the stepper knows whether to show
      // the LLM enrichment row.
      setLiveStatuses(prev => ({
        ...prev,
        [result.id]: {
          id: result.id,
          mode: result.mode === 'structured' ? 'structured' : 'fast',
          processingStatus: result.processingStatus,
          enrichmentStatus: result.enrichmentStatus,
          chunkCount: result.chunkCount,
          entityCount: 0,
          lastUpdatedAt: result.createdAt,
          stages: [],
          lastError: null,
          enrichmentProgress: null,
        },
      }));
      setDocs(prev => [result, ...prev]);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Upload failed');
    } finally {
      setUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  const handleView = async (id: string) => {
    setViewLoading(true);
    setViewRaw(null);
    setActiveTab('chunks');
    try {
      const detail = await apiGetKnowledgeDocument(id);
      setViewDoc(detail);
    } catch { /* ignore */ }
    finally { setViewLoading(false); }
    // Fetch raw output lazily (only when the Raw tab is opened) so
    // opening a doc doesn't pay the cost up front.  The Raw tab will
    // trigger this on first click.
    void loadRaw(id);
  };

  const loadRaw = async (id: string) => {
    setViewRawLoading(true);
    try {
      const raw = await apiGetDocumentRawOutput(id);
      setViewRaw(raw);
    } catch { /* leave null */ }
    finally { setViewRawLoading(false); }
  };

  const handleDelete = async (id: string) => {
    try {
      await apiDeleteKnowledgeDocument(id);
      setDocs(prev => prev.filter(d => d.id !== id));
      setLiveStatuses(prev => {
        const { [id]: _, ...rest } = prev;
        return rest;
      });
    } catch { /* ignore */ }
  };

  const formatBytes = (bytes: number) => {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  };

  // Pick the freshest view of each doc — live polled status overrides the
  // initial list row once we have one.
  const docsForRender = docs.map(d => {
    const live = liveStatuses[d.id];
    if (!live) return d;
    return {
      ...d,
      processingStatus: live.processingStatus,
      enrichmentStatus: live.enrichmentStatus,
      chunkCount: live.chunkCount,
    } as KnowledgeDocument;
  });

  if (isLoading) {
    return <div className="flex items-center justify-center min-h-screen">Loading...</div>;
  }

  return (
    <div className="min-h-screen bg-gray-50">
      <header className="bg-white border-b border-gray-200">
        <div className="max-w-5xl mx-auto px-4 py-4 flex items-center justify-between">
          <div className="flex items-center gap-4">
            <button onClick={() => router.push('/dashboard')} className="text-gray-500 hover:text-gray-700">
              ← Back
            </button>
            <h1 className="text-lg font-semibold text-gray-900">Knowledge Base</h1>
          </div>
        </div>
      </header>

      <main className="max-w-5xl mx-auto px-4 py-8">
        <div className="flex items-center justify-between mb-8 gap-4 flex-wrap">
          <div>
            <h2 className="text-2xl font-bold text-gray-900">Documents</h2>
            <p className="text-gray-500 mt-1">
              Upload product docs, battle cards, objection guides — AI detects your entities from them
            </p>
          </div>
          <div className="flex items-center gap-3">
            <div className="flex rounded-lg border border-gray-300 overflow-hidden text-sm">
              <button
                type="button"
                onClick={() => setMode('fast')}
                className={`px-3 py-2 ${mode === 'fast' ? 'bg-blue-600 text-white' : 'bg-white text-gray-600 hover:bg-gray-50'}`}
                title="In-process extraction. Sub-second, no LLM pass."
              >
                Fast
              </button>
              <button
                type="button"
                onClick={() => setMode('structured')}
                className={`px-3 py-2 border-l border-gray-300 ${mode === 'structured' ? 'bg-blue-600 text-white' : 'bg-white text-gray-600 hover:bg-gray-50'}`}
                title="Docling layout extraction + async LLM enrichment. Slower but richer."
              >
                Structured + LLM
              </button>
            </div>
            <label className={`px-6 py-3 rounded-lg font-medium text-white cursor-pointer transition-colors ${
              uploading ? 'bg-gray-400' : 'bg-blue-600 hover:bg-blue-700'
            }`}>
              {uploading ? 'Uploading...' : 'Upload Document'}
              <input
                ref={fileInputRef}
                type="file"
                className="hidden"
                accept=".pdf,.docx,.md,.txt"
                onChange={handleUpload}
                disabled={uploading}
              />
            </label>
          </div>
        </div>

        {error && (
          <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded-lg text-sm text-red-700">{error}</div>
        )}

        {docsForRender.length === 0 ? (
          <div className="bg-white rounded-xl border border-gray-200 p-12 text-center">
            <p className="text-gray-500 text-lg">No documents uploaded</p>
            <p className="text-gray-400 mt-2">Upload PDFs, DOCX, or Markdown files to build your knowledge base</p>
          </div>
        ) : (
          <div className="space-y-3">
            {docsForRender.map(doc => {
              const live = liveStatuses[doc.id];
              const showStepper = !!live && !isDocTerminal({ ...doc, ...live });
              return (
                <div key={doc.id} className="bg-white rounded-xl border border-gray-200 p-4">
                  <div className="flex items-center justify-between gap-4">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <p className="font-medium text-gray-900 truncate">{doc.fileName}</p>
                        <StatusPill value={doc.processingStatus} kind="processing" />
                        <StatusPill value={doc.enrichmentStatus} kind="enrichment" mode={doc.mode} />
                      </div>
                      <p className="text-sm text-gray-500 mt-1">
                        {formatBytes(doc.fileSizeBytes)} · {doc.chunkCount} chunks ·
                        {' '}{live ? `${live.entityCount} entities · ` : ''}
                        {new Date(doc.createdAt).toLocaleDateString()}
                        {doc.mode && <> · <span className="text-gray-400">{doc.mode}</span></>}
                      </p>
                    </div>
                    <div className="flex items-center gap-2 ml-4 shrink-0">
                      <button onClick={() => handleView(doc.id)} className="text-sm text-blue-600 hover:text-blue-800">
                        View
                      </button>
                      <button onClick={() => handleDelete(doc.id)} className="text-sm text-red-500 hover:text-red-700">
                        Delete
                      </button>
                    </div>
                  </div>
                  {showStepper && live && (
                    <ProcessingStepper status={live} mode={doc.mode ?? 'structured'} />
                  )}
                </div>
              );
            })}
          </div>
        )}
      </main>

      {/* ── View Document Modal ── */}
      {viewDoc && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4" onClick={() => setViewDoc(null)}>
          <div className="bg-white rounded-xl border border-gray-200 w-full max-w-3xl max-h-[80vh] flex flex-col" onClick={e => e.stopPropagation()}>
            <div className="p-4 border-b border-gray-100 flex items-center justify-between shrink-0">
              <div>
                <h3 className="font-semibold text-gray-900">{viewDoc.fileName}</h3>
                <p className="text-xs text-gray-400 mt-0.5">
                  {formatBytes(viewDoc.fileSizeBytes)} · {viewDoc.chunks.length} chunks · {viewDoc.entities.length} entities
                  {viewDoc.mode && <> · <span className="text-gray-500">{viewDoc.mode}</span></>}
                </p>
              </div>
              <button onClick={() => setViewDoc(null)} className="text-gray-400 hover:text-gray-600 text-xl">&times;</button>
            </div>

            <div className="flex gap-0 border-b border-gray-100 shrink-0">
              <button
                onClick={() => setActiveTab('chunks')}
                className={`px-4 py-2 text-sm font-medium ${activeTab === 'chunks' ? 'text-blue-600 border-b-2 border-blue-600' : 'text-gray-500'}`}
              >
                Chunks ({viewDoc.chunks.length})
              </button>
              <button
                onClick={() => setActiveTab('entities')}
                className={`px-4 py-2 text-sm font-medium ${activeTab === 'entities' ? 'text-blue-600 border-b-2 border-blue-600' : 'text-gray-500'}`}
              >
                Entities ({viewDoc.entities.length})
              </button>
              {viewDoc.mode === 'structured' && (
                <button
                  onClick={() => { setActiveTab('raw'); if (!viewRaw && !viewRawLoading) void loadRaw(viewDoc.id); }}
                  className={`px-4 py-2 text-sm font-medium ${activeTab === 'raw' ? 'text-blue-600 border-b-2 border-blue-600' : 'text-gray-500'}`}
                >
                  Raw
                </button>
              )}
              {viewDoc.mode === 'structured' && (
                <button
                  onClick={() => setActiveTab('pages')}
                  className={`px-4 py-2 text-sm font-medium ${activeTab === 'pages' ? 'text-blue-600 border-b-2 border-blue-600' : 'text-gray-500'}`}
                >
                  Pages {liveStatuses[viewDoc.id]?.enrichmentProgress
                    ? `(${liveStatuses[viewDoc.id]!.enrichmentProgress!.completed}/${liveStatuses[viewDoc.id]!.enrichmentProgress!.total})`
                    : ''}
                </button>
              )}
              <button
                onClick={() => setActiveTab('errors')}
                className={`px-4 py-2 text-sm font-medium ${activeTab === 'errors' ? 'text-blue-600 border-b-2 border-blue-600' : 'text-gray-500'}`}
              >
                Errors
              </button>
            </div>

            <div className="overflow-y-auto p-4 flex-1">
              {activeTab === 'chunks' ? (
                viewDoc.chunks.length === 0 ? (
                  <p className="text-gray-400 text-center py-8">No chunks yet — document may still be processing</p>
                ) : (
                  <div className="space-y-4">
                    {viewDoc.chunks.map(chunk => (
                      <div key={chunk.id} className="bg-gray-50 rounded-lg p-4">
                        <div className="flex items-center justify-between mb-1 flex-wrap gap-2">
                          <div className="flex items-center gap-2 flex-wrap">
                            <span className="text-xs font-medium text-gray-400">Chunk {chunk.chunkIndex + 1}</span>
                            {chunk.source && (
                              <span className={`text-[10px] px-1.5 py-0.5 rounded-full font-medium uppercase tracking-wide ${
                                chunk.source === 'enriched' ? 'bg-amber-100 text-amber-800' :
                                chunk.source === 'structured' ? 'bg-blue-100 text-blue-700' :
                                'bg-gray-100 text-gray-600'
                              }`}>
                                {chunk.source}
                              </span>
                            )}
                            {chunk.chunkType && chunk.chunkType !== 'paragraph' && (
                              <span className="text-[10px] px-1.5 py-0.5 rounded bg-purple-100 text-purple-700">
                                {chunk.chunkType}
                              </span>
                            )}
                            {chunk.pageHint > 0 && (
                              <span className="text-[10px] px-1.5 py-0.5 rounded bg-gray-200 text-gray-700">
                                page {chunk.pageHint}
                              </span>
                            )}
                            {chunk.sectionHeading && (
                              <span className="text-[10px] text-gray-500 italic">
                                {chunk.sectionHeading}
                              </span>
                            )}
                          </div>
                          <span className="text-xs text-gray-400">{chunk.tokenCount} tokens</span>
                        </div>
                        <p className="text-sm text-gray-700 leading-relaxed whitespace-pre-wrap">{chunk.text}</p>
                      </div>
                    ))}
                  </div>
                )
              ) : activeTab === 'entities' ? (
                viewDoc.entities.length === 0 ? (
                  <p className="text-gray-400 text-center py-8">No entities extracted yet</p>
                ) : (
                  <div className="space-y-2">
                    {viewDoc.entities.map(entity => (
                      <div key={entity.id} className="flex items-center justify-between bg-gray-50 rounded-lg p-3">
                        <div className="flex items-center gap-3">
                          <span className="text-sm font-medium text-gray-800">{entity.entityText || '(unnamed)'}</span>
                          <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${
                            entity.entityType === 'competitor' ? 'bg-red-100 text-red-700' :
                            entity.entityType === 'product' ? 'bg-blue-100 text-blue-700' :
                            entity.entityType === 'pricing' ? 'bg-green-100 text-green-700' :
                            entity.entityType === 'feature' ? 'bg-purple-100 text-purple-700' :
                            'bg-gray-100 text-gray-600'
                          }`}>
                            {entity.entityType}
                          </span>
                        </div>
                        <span className="text-xs text-gray-400">{(entity.confidence * 100).toFixed(0)}%</span>
                      </div>
                    ))}
                  </div>
                )
              ) : activeTab === 'raw' ? (
                <RawTabView
                  raw={viewRaw}
                  loading={viewRawLoading}
                  mode={viewDoc.mode ?? 'fast'}
                />
              ) : activeTab === 'pages' ? (
                <PagesTabView
                  live={liveStatuses[viewDoc.id] ?? null}
                />
              ) : (
                <ErrorsTabView
                  live={liveStatuses[viewDoc.id] ?? null}
                  stageDetailFromChunks={viewDoc.chunks.length}
                />
              )}
            </div>
          </div>
        </div>
      )}

      {/* ── View loading overlay ── */}
      {viewLoading && (
        <div className="fixed inset-0 bg-black/20 flex items-center justify-center z-50">
          <div className="bg-white rounded-lg px-6 py-4 text-sm text-gray-600">Loading...</div>
        </div>
      )}
    </div>
  );
}

function StatusPill({
  value,
  kind,
  mode,
}: {
  value: string | null;
  kind: 'processing' | 'enrichment';
  mode?: 'fast' | 'structured';
}) {
  if (kind === 'enrichment') {
    // Fast-mode docs are intentionally not enriched — show a neutral
    // "Skipped" pill so the user knows it's not a bug.
    if (mode === 'fast' || value == null) {
      return (
        <span className="text-xs px-2 py-0.5 rounded-full font-medium bg-gray-100 text-gray-500" title="LLM enrichment only runs in Structured mode">
          Skipped
        </span>
      );
    }
    const tone =
      value === 'enriched' ? 'bg-green-100 text-green-700' :
      value === 'enriching' ? 'bg-blue-100 text-blue-700' :
      value === 'enrichment_failed' ? 'bg-red-100 text-red-700' :
      'bg-gray-100 text-gray-600';
    return <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${tone}`}>{value}</span>;
  }

  // Processing pill.
  if (!value) return <span className="text-xs px-2 py-0.5 rounded-full font-medium bg-gray-100 text-gray-500">—</span>;
  const tone =
    value === 'Indexed' ? 'bg-green-100 text-green-700' :
    value.startsWith('Error') ? 'bg-red-100 text-red-700' :
    value === 'No extractable text found' ? 'bg-gray-100 text-gray-600' :
    'bg-yellow-100 text-yellow-700';
  return <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${tone}`}>{value}</span>;
}

// ── Raw tab ──────────────────────────────────────────────────────────
// Renders the captured Docling metadata + LLM enrichment response so
// the user can see exactly what the AI engine produced.  Pretty-print
// in <pre> with a dark background — matches the existing log/raw
// toggle pattern in ProductDetailsCard without introducing new deps.

function RawTabView({
  raw,
  loading,
  mode,
}: {
  raw: DocumentRawOutput | null;
  loading: boolean;
  mode: string;
}) {
  if (mode !== 'structured') {
    return (
      <p className="text-gray-400 text-center py-8 text-sm">
        Raw AI-engine output is only captured for structured-mode documents (Docling + LLM enrichment).
      </p>
    );
  }
  if (loading && !raw) {
    return <p className="text-gray-400 text-center py-8 text-sm">Loading raw output…</p>;
  }
  if (!raw || !raw.rawOutput) {
    return (
      <p className="text-gray-400 text-center py-8 text-sm">
        No raw output yet — the AI engine has not finished processing this document.
      </p>
    );
  }

  const out = raw.rawOutput;
  const docling = out.docling;
  const enrich = out.enrichment;

  return (
    <div className="space-y-5">
      {docling && (
        <section>
          <h4 className="text-sm font-semibold text-gray-800 mb-2">Docling</h4>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 mb-2">
            <Stat label="pages" value={docling.page_count} />
            <Stat label="convert" value={`${(docling.convert_ms / 1000).toFixed(1)}s`} />
            <Stat label="chunk" value={`${docling.chunk_ms}ms`} />
            <Stat
              label="model load"
              value={docling.model_load_ms != null ? `${(docling.model_load_ms / 1000).toFixed(1)}s` : '—'}
            />
          </div>
          {docling.warnings.length > 0 && (
            <div className="text-xs bg-yellow-50 border border-yellow-200 text-yellow-800 rounded p-2">
              {docling.warnings.join(' · ')}
            </div>
          )}
        </section>
      )}

      {enrich && (
        <section>
          <h4 className="text-sm font-semibold text-gray-800 mb-2">LLM enrichment</h4>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 mb-3">
            <Stat label="pages" value={enrich.page_count} />
            <Stat label="products" value={enrich.products_total} />
            <Stat label="failures" value={enrich.failure_count} tone={enrich.failure_count > 0 ? 'red' : 'green'} />
            <Stat label="duration" value={`${(enrich.enrichment_ms / 1000).toFixed(1)}s`} />
          </div>
          {enrich.model && (
            <div className="text-xs text-gray-500 mb-2">model: <span className="font-mono">{enrich.model}</span></div>
          )}
          <div className="space-y-2">
            {enrich.pages.map(p => (
              <div key={p.page} className="border border-gray-200 rounded-lg p-3">
                <div className="flex items-center gap-2 mb-1 flex-wrap">
                  <span className="text-xs font-medium text-gray-600">Page {p.page}</span>
                  <span className="text-xs px-1.5 py-0.5 rounded bg-gray-100 text-gray-600">{p.page_type}</span>
                  {p.outcome && <OutcomeBadge outcome={p.outcome} />}
                  {p.products.length > 0 && (
                    <span className="text-xs text-gray-500">· {p.products.length} product(s)</span>
                  )}
                </div>
                {p.products.length > 0 && (
                  <details className="text-xs">
                    <summary className="cursor-pointer text-blue-600 hover:text-blue-800 mb-1">
                      Show first product ({p.products[0].name})
                    </summary>
                    <pre className="text-[11px] bg-gray-900 text-gray-100 p-2 rounded overflow-x-auto whitespace-pre-wrap break-words mt-1">
                      {p.products[0].chunk_text}
                    </pre>
                  </details>
                )}
                {p.outcome?.error && (
                  <div className="text-xs text-red-700 bg-red-50 border border-red-200 rounded p-2 mt-1 break-words">
                    {p.outcome.error}
                  </div>
                )}
              </div>
            ))}
          </div>
        </section>
      )}

      {!docling && !enrich && (
        <p className="text-gray-400 text-center py-8 text-sm">
          The AI engine has not returned any output for this document.
        </p>
      )}
    </div>
  );
}

function Stat({ label, value, tone }: { label: string; value: string | number; tone?: 'green' | 'red' }) {
  const toneClass = tone === 'red' ? 'text-red-700' : tone === 'green' ? 'text-green-700' : 'text-gray-900';
  return (
    <div className="bg-gray-50 rounded p-2">
      <div className="text-[10px] uppercase tracking-wide text-gray-500">{label}</div>
      <div className={`text-sm font-medium ${toneClass}`}>{value}</div>
    </div>
  );
}

function OutcomeBadge({ outcome }: { outcome: { status: string; model: string | null; duration_ms: number; error: string | null } }) {
  const tone =
    outcome.status === 'ok' ? 'bg-green-100 text-green-800' :
    outcome.status === 'no_products' ? 'bg-gray-100 text-gray-600' :
    'bg-red-100 text-red-800';
  return (
    <span className={`text-[10px] px-1.5 py-0.5 rounded font-medium ${tone}`} title={outcome.error ?? ''}>
      {outcome.status} · {outcome.duration_ms}ms
    </span>
  );
}

// ── Errors tab ──────────────────────────────────────────────────────
// Iterates the per-stage log for failed stages and shows the full
// error message.  Empty state (no failures) is the common case —
// shown as a quiet "all clear" panel.

function ErrorsTabView({
  live,
  stageDetailFromChunks,
}: {
  live: DocumentStatus | null;
  stageDetailFromChunks: number;
}) {
  if (!live) {
    return (
      <p className="text-gray-400 text-center py-8 text-sm">
        No live status available — this document finished processing before the new pipeline was deployed.
      </p>
    );
  }
  const failed = live.stages.filter(s => s.status === 'failed' || s.error);
  if (failed.length === 0) {
    return (
      <div className="bg-green-50 border border-green-200 text-green-800 rounded-lg p-4 text-sm">
        <div className="font-medium mb-1">No errors</div>
        <div className="text-xs text-green-700">
          All {live.stages.length} pipeline stages completed without failure
          {stageDetailFromChunks > 0 && <> · {stageDetailFromChunks} chunks persisted</>}.
        </div>
      </div>
    );
  }
  return (
    <div className="space-y-3">
      {live.lastError && (
        <div className="bg-red-50 border border-red-200 rounded-lg p-3">
          <div className="text-xs text-red-900 font-medium mb-1">Most recent failure</div>
          <pre className="text-xs text-red-800 whitespace-pre-wrap break-words font-mono">
            {JSON.stringify(live.lastError, null, 2)}
          </pre>
        </div>
      )}
      {failed.map(s => (
        <div key={s.key} className="bg-red-50 border border-red-200 rounded-lg p-3">
          <div className="flex items-center gap-2 mb-1 flex-wrap">
            <span className="text-sm font-medium text-red-900">{s.label}</span>
            <span className="text-[10px] px-1.5 py-0.5 rounded bg-red-200 text-red-900 font-medium">
              {s.status}
            </span>
            {s.startedAt && (
              <span className="text-[10px] text-red-700 font-mono">
                {new Date(s.startedAt).toLocaleTimeString()}
              </span>
            )}
          </div>
          {s.error && (
            <pre className="text-xs text-red-800 whitespace-pre-wrap break-words font-mono">
              {JSON.stringify(s.error, null, 2)}
            </pre>
          )}
        </div>
      ))}
    </div>
  );
}

// ── Pages tab ─────────────────────────────────────────────────────────
// Shows the live per-page enrichment status.  Reads from the
// EnrichmentProgress jsonb column the .NET handler updates after
// every page completes — refreshes every 1.5s via the parent's
// status poll loop.  Empty state covers documents that finished
// before the streaming pipeline was deployed.

function PagesTabView({ live }: { live: DocumentStatus | null }) {
  if (!live?.enrichmentProgress) {
    return (
      <p className="text-gray-400 text-center py-8 text-sm">
        No page-level progress yet — enrichment has not started, or this document finished before per-page tracking was added.
      </p>
    );
  }
  const p = live.enrichmentProgress;
  const notDone = p.pages.filter(x => x.status === 'pending').length;
  return (
    <div>
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 mb-4">
        <Stat label="total" value={p.total} />
        <Stat label="enriched" value={p.completed} tone="green" />
        <Stat label="failed" value={p.failed} tone={p.failed > 0 ? 'red' : 'green'} />
        <Stat label="in flight" value={p.inFlight} />
      </div>
      {p.total > 0 && (
        <div className="mb-3 h-2 bg-gray-100 rounded-full overflow-hidden" title={`${p.completed}/${p.total} pages enriched`}>
          <div
            className="h-full bg-green-500 transition-all duration-300"
            style={{ width: `${Math.round((p.completed / p.total) * 100)}%` }}
          />
        </div>
      )}
      {notDone > 0 && p.failed === 0 && (
        <div className="text-xs text-blue-600 mb-2 animate-pulse">
          {notDone} page{notDone === 1 ? '' : 's'} still in flight — this list updates as each one returns.
        </div>
      )}
      <div className="space-y-1.5">
        {p.pages.map(page => (
          <div key={page.page} className="flex items-center gap-2 text-sm bg-gray-50 rounded p-2">
            <span className="text-xs font-mono text-gray-500 w-10 shrink-0">p{page.page}</span>
            <OutcomePill status={page.status} />
            {page.retryCount > 0 && (
              <span
                className="text-[10px] px-1.5 py-0.5 rounded bg-amber-100 text-amber-800 font-medium"
                title={`Groq rate-limited this page; the engine retried after the suggested wait`}
              >
                ↻ retried ×{page.retryCount}
              </span>
            )}
            {page.model && <span className="text-[10px] text-gray-400 font-mono truncate">{page.model}</span>}
            {page.durationMs > 0 && <span className="text-[10px] text-gray-400 ml-auto shrink-0">{page.durationMs}ms</span>}
            {page.error && (
              <span className="text-[10px] text-red-700 break-words whitespace-pre-wrap ml-2">
                {page.error}
              </span>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

function OutcomePill({ status }: { status: string }) {
  const tone =
    status === 'ok' ? 'bg-green-100 text-green-800' :
    status === 'no_products' ? 'bg-gray-100 text-gray-600' :
    status === 'pending' ? 'bg-gray-100 text-gray-400' :
    'bg-red-100 text-red-800';
  return (
    <span className={`text-[10px] px-1.5 py-0.5 rounded font-medium ${tone}`}>
      {status}
    </span>
  );
}
