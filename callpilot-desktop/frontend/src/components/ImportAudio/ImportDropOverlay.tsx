import React from 'react';
import { Upload } from 'lucide-react';
import { getAudioFormatsDisplayList } from '@/constants/audioFormats';

interface ImportDropOverlayProps {
  visible: boolean;
}

export function ImportDropOverlay({ visible }: ImportDropOverlayProps) {
  if (!visible) return null;

  return (
    <div
      className="fixed inset-0 z-50 bg-[var(--opaline-overlay)] backdrop-blur-sm
                 flex items-center justify-center pointer-events-none
                 transition-opacity duration-200"
    >
      <div className="border-2 border-dashed border-[var(--opaline-info-border)] rounded-xl
                      p-12 text-center bg-[var(--opaline-surface-container-lowest)] shadow-xl
                      transform scale-100 transition-transform">
        <Upload className="h-16 w-16 text-[var(--opaline-info)] mx-auto mb-4" />
        <p className="text-xl font-medium text-[var(--opaline-on-surface)]">Drop audio file to import</p>
        <p className="text-sm text-[var(--opaline-on-surface-variant)] mt-2">{getAudioFormatsDisplayList()}</p>
      </div>
    </div>
  );
}
