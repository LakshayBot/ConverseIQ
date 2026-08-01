// Stub for Meetily's PostHog analytics - removed during CallPilot adaptation.
// Exists only so existing import statements keep type-checking. No-ops.

const noop: (...args: any[]) => void = () => {};
const noopAsync = async (_?: any): Promise<any> => undefined;
const noopPromise: (...args: any[]) => Promise<any> = (..._args: any[]) =>
  Promise.resolve(undefined);

const AnalyticsImpl: any = {
  trackPageView: noop,
  trackEvent: noopPromise,
  track: noopPromise,
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
  trackButtonClick: noop,
  trackTranscriptionSuccess: noop,
  trackTranscriptionError: noop,
  startSession: noopAsync,
  endSession: noopAsync,
  init: noopAsync,
  disable: noopAsync,
  isEnabled: () => false,
};

// Wrap in a Proxy so any method missing from the stub returns a no-op instead
// of crashing the call site. PostHog had ~30 methods and drift was easy to miss.
const Analytics: any = new Proxy(AnalyticsImpl, {
  get(target, prop: string) {
    if (prop in target) return target[prop];
    // Unknown method - return a no-op (sync) or a resolved Promise (async).
    return (..._args: any[]) => undefined;
  },
});

export default Analytics;
