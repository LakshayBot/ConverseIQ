'use client';

// Stub for the deleted AnalyticsProvider (PostHog). CallPilot removed
// third-party analytics during adaptation. The provider is kept as a
// pass-through so existing layout/imports still type-check.

import React from 'react';

interface Props {
  children: React.ReactNode;
}

const AnalyticsProvider: React.FC<Props> = ({ children }) => <>{children}</>;

export default AnalyticsProvider;
