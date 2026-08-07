"use client"

import { Switch } from "./ui/switch"
import { FlaskConical, AlertCircle } from "lucide-react"
import { useConfig } from "@/contexts/ConfigContext"
import {
  BetaFeatureKey,
  BETA_FEATURE_NAMES,
  BETA_FEATURE_DESCRIPTIONS
} from "@/types/betaFeatures"

export function BetaSettings() {
  const { betaFeatures, toggleBetaFeature } = useConfig();

  // Define feature order for display (allows custom ordering)
  const featureOrder: BetaFeatureKey[] = ['importAndRetranscribe'];

  return (
    <div className="space-y-6">
      {/* Yellow Warning Banner */}
      <div className="flex items-start gap-3 p-4 bg-[var(--opaline-warning-soft)] border border-[var(--opaline-warning-border)] rounded-xl">
        <AlertCircle className="h-5 w-5 text-warning flex-shrink-0 mt-0.5" />
        <div className="text-sm text-warning">
          <p className="font-medium">Beta Features</p>
          <p className="mt-1">
            These features are still being tested. You may encounter issues, and we appreciate your feedback.
          </p>
        </div>
      </div>

      {/* Dynamic Feature Toggles - Automatically renders all features */}
      {featureOrder.map((featureKey) => (
        <div
          key={featureKey}
          className="panel p-6"
        >
          <div className="flex items-center justify-between">
            <div className="flex-1">
              <div className="flex items-center gap-2 mb-2">
                <FlaskConical className="h-5 w-5 text-[var(--opaline-on-surface-variant)]" />
                <h3 className="text-headline-md text-[var(--opaline-on-surface)]">
                  {BETA_FEATURE_NAMES[featureKey]}
                </h3>
                <span className="chip chip-warning">
                  BETA
                </span>
              </div>
              <p className="text-body-sm text-[var(--opaline-on-surface-variant)]">
                {BETA_FEATURE_DESCRIPTIONS[featureKey]}
              </p>
            </div>

            <div className="ml-6">
              <Switch
                checked={betaFeatures[featureKey]}
                onCheckedChange={(checked) => toggleBetaFeature(featureKey, checked)}
              />
            </div>
          </div>
        </div>
      ))}

      {/* Info Box */}
      <div className="p-4 bg-[var(--opaline-info-soft)] border border-[var(--opaline-info-border)] rounded-xl">
        <p className="text-sm text-[var(--opaline-info)]">
          <strong>Note:</strong> When disabled, beta features will be hidden. Your existing meetings remain unaffected.
        </p>
      </div>
    </div>
  );
}
