'use client';

import { useEffect, useState, useRef } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/lib/auth';
import {
  apiUploadKnowledge,
  apiGetKnowledgeDocuments,
  apiDeleteKnowledgeDocument,
  apiGetKnowledgeDocument,
  KnowledgeDocument,
  KnowledgeDocumentDetail,
} from '@/lib/api';

export default function KnowledgePage() {
  const { user, isLoading } = useAuth();
  const router = useRouter();
  const [docs, setDocs] = useState<KnowledgeDocument[]>([]);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [viewDoc, setViewDoc] = useState<KnowledgeDocumentDetail | null>(null);
  const [viewLoading, setViewLoading] = useState(false);
  const [activeTab, setActiveTab] = useState<'chunks' | 'entities'>('chunks');
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!isLoading && !user) { router.push('/login'); return; }
    loadDocs();
  }, [user, isLoading]);

  const loadDocs = async () => {
    try { setDocs(await apiGetKnowledgeDocuments()); } catch { /* empty */ }
  };

  const handleUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploading(true);
    setError(null);
    try {
      const result = await apiUploadKnowledge(file);
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
    try {
      const detail = await apiGetKnowledgeDocument(id);
      setViewDoc(detail);
    } catch { /* ignore */ }
    finally { setViewLoading(false); }
  };

  const handleDelete = async (id: string) => {
    try {
      await apiDeleteKnowledgeDocument(id);
      setDocs(prev => prev.filter(d => d.id !== id));
    } catch { /* ignore */ }
  };

  const formatBytes = (bytes: number) => {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  };

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
        <div className="flex items-center justify-between mb-8">
          <div>
            <h2 className="text-2xl font-bold text-gray-900">Documents</h2>
            <p className="text-gray-500 mt-1">Upload product docs, battle cards, objection guides — AI detects your entities from them</p>
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

        {error && (
          <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded-lg text-sm text-red-700">{error}</div>
        )}

        {docs.length === 0 ? (
          <div className="bg-white rounded-xl border border-gray-200 p-12 text-center">
            <p className="text-gray-500 text-lg">No documents uploaded</p>
            <p className="text-gray-400 mt-2">Upload PDFs, DOCX, or Markdown files to build your knowledge base</p>
          </div>
        ) : (
          <div className="space-y-3">
            {docs.map(doc => (
              <div key={doc.id} className="bg-white rounded-xl border border-gray-200 p-4 flex items-center justify-between">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-3">
                    <p className="font-medium text-gray-900 truncate">{doc.fileName}</p>
                    <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${
                      doc.processingStatus === 'Indexed' ? 'bg-green-100 text-green-700' :
                      doc.processingStatus?.startsWith('Error') ? 'bg-red-100 text-red-700' :
                      'bg-yellow-100 text-yellow-700'
                    }`}>
                      {doc.processingStatus}
                    </span>
                  </div>
                  <p className="text-sm text-gray-500 mt-1">
                    {formatBytes(doc.fileSizeBytes)} · {doc.chunkCount} chunks · {new Date(doc.createdAt).toLocaleDateString()}
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
            ))}
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
            </div>

            <div className="overflow-y-auto p-4 flex-1">
              {activeTab === 'chunks' ? (
                viewDoc.chunks.length === 0 ? (
                  <p className="text-gray-400 text-center py-8">No chunks yet — document may still be processing</p>
                ) : (
                  <div className="space-y-4">
                    {viewDoc.chunks.map(chunk => (
                      <div key={chunk.id} className="bg-gray-50 rounded-lg p-4">
                        <div className="flex items-center justify-between mb-1">
                          <span className="text-xs font-medium text-gray-400">Chunk {chunk.chunkIndex + 1}</span>
                          <span className="text-xs text-gray-400">{chunk.tokenCount} tokens</span>
                        </div>
                        <p className="text-sm text-gray-700 leading-relaxed whitespace-pre-wrap">{chunk.text}</p>
                      </div>
                    ))}
                  </div>
                )
              ) : (
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
