'use client';

// Stub for the deleted SummaryPanel component. The meeting-details page
// imports it but no longer renders it (CallPilot shows the Intelligence
// Panel on the home page instead). Kept as a placeholder so existing
// imports compile.

import React from 'react';

interface Props {
  meeting: any;
  summaryData?: any;
  onUpdate?: () => void;
  [key: string]: any;
}

const SummaryPanel: React.FC<Props> = (_props) => {
  return null;
};

export { SummaryPanel };
export default SummaryPanel;
