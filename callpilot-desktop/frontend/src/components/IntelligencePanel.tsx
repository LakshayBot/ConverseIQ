'use client';

import React, { useState } from 'react';
import { ChevronDown, ChevronRight, AlertTriangle, MessageCircle, ThumbsUp, Package, DollarSign, HelpCircle } from 'lucide-react';
import type { IntelligenceCard } from '@/lib/callpilotApi';

interface Props {
  cards: IntelligenceCard[];
  connected: boolean;
  error: string | null;
}

const TYPE_META: Record<IntelligenceCard['type'], { icon: React.ReactNode; label: string }> = {
  competitor_detected: { icon: <AlertTriangle className="w-4 h-4" />, label: 'Competitor' },
  objection:           { icon: <MessageCircle className="w-4 h-4" />, label: 'Objection' },
  buying_signal:       { icon: <ThumbsUp className="w-4 h-4" />, label: 'Buying signal' },
  product_match:       { icon: <Package className="w-4 h-4" />, label: 'Product match' },
  pricing_discussion:  { icon: <DollarSign className="w-4 h-4" />, label: 'Pricing' },
  technical_question:  { icon: <HelpCircle className="w-4 h-4" />, label: 'Technical' },
};

const SEVERITY_BORDER: Record<IntelligenceCard['severity'], string> = {
  high: 'border-l-red-500',
  medium: 'border-l-yellow-500',
  low: 'border-l-blue-500',
};

export const IntelligencePanel: React.FC<Props> = ({ cards, connected, error }) => {
  if (error) {
    return (
      <div className="rounded-md border border-dashed border-gray-300 bg-white/60 p-4 text-sm text-gray-500">
        <div className="font-medium text-gray-700">Intelligence stream offline</div>
        <div className="mt-1 text-xs">{error}. Cards will appear here once the CallPilot AI engine exposes the endpoint.</div>
      </div>
    );
  }

  if (!cards.length) {
    return (
      <div className="rounded-md border border-dashed border-gray-300 bg-white/60 p-4 text-sm text-gray-500">
        <div className="font-medium text-gray-700">Waiting for intelligence…</div>
        <div className="mt-1 text-xs">
          {connected
            ? 'Connected to CallPilot. Competitors, objections, and product matches will surface here.'
            : 'Connecting to CallPilot AI engine…'}
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-2">
      {cards.map((card, i) => (
        <IntelligenceCardItem key={`${card.type}-${i}-${card.title}`} card={card} />
      ))}
    </div>
  );
};

const IntelligenceCardItem: React.FC<{ card: IntelligenceCard }> = ({ card }) => {
  const [open, setOpen] = useState(false);
  const meta = TYPE_META[card.type] ?? { icon: <MessageCircle className="w-4 h-4" />, label: card.type };
  const hasChunks = card.chunks && card.chunks.length > 0;

  return (
    <div
      className={`bg-white rounded-md border border-gray-200 border-l-4 ${SEVERITY_BORDER[card.severity]} shadow-sm overflow-hidden`}
    >
      <div className="p-3">
        <div className="flex items-center gap-2 text-xs uppercase tracking-wide text-gray-500">
          <span className="text-gray-700">{meta.icon}</span>
          <span>{meta.label}</span>
          <span className="ml-auto text-[10px] font-semibold uppercase text-gray-400">{card.severity}</span>
        </div>
        <div className="mt-1 text-sm font-semibold text-gray-900">{card.title}</div>
        {card.body && <div className="mt-1 text-sm text-gray-700 whitespace-pre-wrap">{card.body}</div>}
        {hasChunks && (
          <button
            type="button"
            onClick={() => setOpen((o) => !o)}
            className="mt-2 inline-flex items-center gap-1 text-xs text-blue-600 hover:underline"
          >
            {open ? <ChevronDown className="w-3 h-3" /> : <ChevronRight className="w-3 h-3" />}
            View sources ({card.chunks.length})
          </button>
        )}
        {open && hasChunks && (
          <ul className="mt-2 space-y-2">
            {card.chunks.map((chunk, i) => (
              <li key={i} className="text-xs text-gray-600 border-l-2 border-gray-200 pl-2">
                {chunk}
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
};
