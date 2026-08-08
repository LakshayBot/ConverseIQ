'use client';

// IntelligenceSelectionContext - the single selection state shared by the
// Intelligence rail and the transcript.
//
// The rail and the transcript are one connected system: selecting a
// product card in the rail highlights + locates its transcript
// occurrences, and clicking a highlighted mention in the transcript
// selects that product in the rail.
//
// The shared identity is the ENTITY NAME (e.g. "Sprint 210") - both the
// rail's display identity and the transcript's match target.
//
//   select(id, source)     user-initiated (rail card, transcript mention,
//                          arrow keys) - locks against automatic overrides
//   selectAuto(id)         policy-driven (default latest product, new
//                          detection during a live call) - never overrides
//                          a manual selection
//   lastSource             'rail' triggers the transcript scroll; 'auto'
//                          never scrolls; 'transcript' is already in view

import React, { createContext, useContext, useMemo, useRef, useState } from 'react';

export type SelectionSource = 'auto' | 'rail' | 'transcript';

interface IntelligenceSelectionContextValue {
  selectedId: string | null;
  lastSource: SelectionSource;
  select: (id: string, source: 'rail' | 'transcript') => void;
  selectAuto: (id: string) => void;
  manualRef: React.MutableRefObject<boolean>;
}

const IntelligenceSelectionContext = createContext<IntelligenceSelectionContextValue | null>(null);

export function IntelligenceSelectionProvider({ children }: { children: React.ReactNode }) {
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [lastSource, setLastSource] = useState<SelectionSource>('auto');
  const manualRef = useRef(false);

  const value = useMemo<IntelligenceSelectionContextValue>(
    () => ({
      selectedId,
      lastSource,
      manualRef,
      select: (id, source) => {
        manualRef.current = true;
        setLastSource(source);
        setSelectedId(id);
      },
      selectAuto: (id) => {
        setLastSource('auto');
        setSelectedId(id);
      },
    }),
    [selectedId, lastSource],
  );

  return (
    <IntelligenceSelectionContext.Provider value={value}>
      {children}
    </IntelligenceSelectionContext.Provider>
  );
}

const NOOP_CONTEXT: IntelligenceSelectionContextValue = {
  selectedId: null,
  lastSource: 'auto',
  manualRef: { current: false },
  select: () => {},
  selectAuto: () => {},
};

export function useIntelligenceSelection(): IntelligenceSelectionContextValue {
  return useContext(IntelligenceSelectionContext) ?? NOOP_CONTEXT;
}
