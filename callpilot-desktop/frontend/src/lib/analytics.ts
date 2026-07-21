// Stub for Meetily's PostHog analytics — removed during CallPilot adaptation.
// Exists only so existing import statements keep type-checking. No-ops.

const noop: (...args: any[]) => void = () => {};
const noopAsync = async (_?: any): Promise<any> => undefined;

const Analytics: any = {
  trackPageView: noop,
  trackEvent: noop,
  track: noop,
  identify: noop,
  trackMeetingStarted: noop,
  trackMeetingEnded: noop,
  trackRecordingStarted: noop,
  trackRecordingStopped: noop,
  trackSettingsChanged: noop,
  trackFeatureUsed: noop,
  trackSearchPerformed: noop,
  trackCustomPromptUsed: noop,
  trackModelChanged: noop,
  trackDailyActiveUser: noop,
  trackUserFirstLaunch: noop,
  startSession: noopAsync,
  endSession: noopAsync,
  init: noopAsync,
  disable: noopAsync,
  isEnabled: () => false,
};

// All call sites do `Analytics.track(...).catch(err => ...)`. Returning a
// resolved promise keeps the original control flow intact without TS complaints.
Analytics.track = (..._args: any[]) => Promise.resolve(undefined);
Analytics.trackEvent = (..._args: any[]) => Promise.resolve(undefined);

export default Analytics;
