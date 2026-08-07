import { ModelConfig } from "@/components/ModelSettingsModal";
import { PreferenceSettings } from "@/components/PreferenceSettings";
import { DeviceSelection } from "@/components/DeviceSelection";
import { LanguageSelection } from "@/components/LanguageSelection";
import { TranscriptSettings } from "@/components/TranscriptSettings";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { X } from "lucide-react";
import { toast } from "sonner";
import { useConfig } from "@/contexts/ConfigContext";
import { useRecordingState } from "@/contexts/RecordingStateContext";

type modalType = "modelSettings" | "deviceSettings" | "languageSettings" | "modelSelector" | "errorAlert" | "chunkDropWarning";

/**
 * SettingsModals Component
 *
 * All settings modals consolidated into a single component.
 * Uses ConfigContext and RecordingStateContext internally - no prop drilling needed!
 */

interface SettingsModalsProps {
  modals: {
    modelSettings: boolean;
    deviceSettings: boolean;
    languageSettings: boolean;
    modelSelector: boolean;
    errorAlert: boolean;
    chunkDropWarning: boolean;
  };
  messages: {
    errorAlert: string;
    chunkDropWarning: string;
    modelSelector: string;
  };
  onClose: (name: modalType) => void;
}

export function SettingsModals({
  modals,
  messages,
  onClose,
}: SettingsModalsProps) {
  // Contexts
  const {
    modelConfig,
    setModelConfig,
    models,
    modelOptions,
    error,
    selectedDevices,
    setSelectedDevices,
    selectedLanguage,
    setSelectedLanguage,
    transcriptModelConfig,
    setTranscriptModelConfig,
    showConfidenceIndicator,
    toggleConfidenceIndicator,
  } = useConfig();

  const { isRecording } = useRecordingState();

  return <>
    {/* Legacy Settings Modal */}
    {modals.modelSettings && (
      <div className="fixed inset-0 bg-[var(--opaline-overlay)] flex items-center justify-center z-50 p-4">
        <div className="bg-[var(--opaline-surface-container-lowest)] rounded-xl border border-[var(--opaline-outline-variant)] shadow-xl max-w-4xl w-full max-h-[90vh] overflow-hidden flex flex-col">
          {/* Header */}
          <div className="flex justify-between items-center p-6 border-b border-[var(--opaline-outline-variant)]">
            <h3 className="text-xl font-semibold text-[var(--opaline-on-surface)]">Preferences</h3>
            <button
              onClick={() => onClose("modelSettings")
              }
              className="text-[var(--opaline-outline)] hover:text-[var(--opaline-on-surface-variant)] hover:bg-[var(--opaline-surface-container-low)] rounded-md p-1 transition-colors focus-ring"
            >
              <X className="h-5 w-5" />
            </button>
          </div>

          {/* Content - Scrollable */}
          <div className="flex-1 overflow-y-auto p-6 space-y-8">
            {/* General Preferences Section */}
            <PreferenceSettings />

            {/* Divider */}
            <div className="border-t border-[var(--opaline-outline-variant)] pt-8">
              <h4 className="text-lg font-semibold text-[var(--opaline-on-surface)] mb-4">AI Model Configuration</h4>
              <div className="space-y-4">
                <div>
                  <label className="block text-sm font-medium text-[var(--opaline-on-surface-variant)] mb-1">
                    Summarization Model
                  </label>
                  <div className="flex space-x-2">
                    <select
                      className="px-3 py-2 text-sm bg-[var(--opaline-surface-container-lowest)] border border-[var(--opaline-outline-variant)] rounded-md shadow-sm focus:outline-none focus:ring-1 focus:ring-[var(--opaline-primary)] focus:border-primary"
                      value={modelConfig.provider}
                      onChange={(e) => {
                        const provider = e.target.value as ModelConfig['provider'];
                        setModelConfig({
                          ...modelConfig,
                          provider,
                          model: modelOptions[provider][0]
                        });
                      }}
                    >
                      <option value="builtin-ai">Built-in AI</option>
                      <option value="claude">Claude</option>
                      <option value="groq">Groq</option>
                      <option value="ollama">Ollama</option>
                      <option value="openrouter">OpenRouter</option>
                      <option value="openai">OpenAI</option>
                    </select>

                    <select
                      className="flex-1 px-3 py-2 text-sm bg-[var(--opaline-surface-container-lowest)] border border-[var(--opaline-outline-variant)] rounded-md shadow-sm focus:outline-none focus:ring-1 focus:ring-[var(--opaline-primary)] focus:border-primary"
                      value={modelConfig.model}
                      onChange={(e) => setModelConfig((prev: ModelConfig) => ({ ...prev, model: e.target.value }))}
                    >
                      {modelOptions[modelConfig.provider].map((model: string) => (
                        <option key={model} value={model}>
                          {model}
                        </option>
                      ))}
                    </select>
                  </div>
                </div>
                {modelConfig.provider === 'ollama' && (
                  <div>
                    <h4 className="text-lg font-bold mb-4">Available Ollama Models</h4>
                    {error && (
                      <div className="bg-[var(--opaline-danger-soft)] border border-[var(--opaline-danger-border)] text-danger px-4 py-3 rounded-md mb-4">
                        {error}
                      </div>
                    )}
                    <div className="grid gap-4 max-h-[400px] overflow-y-auto pr-2">
                      {models.map((model) => (
                        <div
                          key={model.id}
                          className={`bg-[var(--opaline-surface-container-lowest)] p-4 rounded-lg border border-[var(--opaline-outline-variant)] shadow-sm cursor-pointer transition-colors ${modelConfig.model === model.name ? 'ring-2 ring-[var(--opaline-primary)] bg-[var(--opaline-info-soft)]' : 'hover:bg-[var(--opaline-surface-container-low)]'
                            }`}
                          onClick={() => setModelConfig((prev: ModelConfig) => ({ ...prev, model: model.name }))}
                        >
                          <h3 className="font-bold">{model.name}</h3>
                          <p className="text-[var(--opaline-on-surface-variant)]">Size: {model.size}</p>
                          <p className="text-[var(--opaline-on-surface-variant)]">Modified: {model.modified}</p>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            </div>
          </div>

          {/* Footer */}
          <div className="border-t border-[var(--opaline-outline-variant)] p-6 flex justify-end">
            <button
              onClick={() => onClose('modelSettings')}
              className="px-4 py-2 text-sm font-medium text-primary-foreground bg-primary rounded-md hover:bg-[var(--opaline-primary-hover)] focus-ring"
            >
              Done
            </button>
          </div>
        </div>
      </div>
    )}

    {/* Device Settings Modal */}
    {modals.deviceSettings && (
      <div className="fixed inset-0 bg-[var(--opaline-overlay)] flex items-center justify-center z-50">
        <div className="bg-[var(--opaline-surface-container-lowest)] rounded-xl border border-[var(--opaline-outline-variant)] p-6 max-w-md w-full mx-4 shadow-xl">
          <div className="flex justify-between items-center mb-4">
            <h3 className="text-lg font-semibold text-[var(--opaline-on-surface)]">Audio Device Settings</h3>
            <button
              onClick={() => onClose('deviceSettings')}
              className="text-[var(--opaline-outline)] hover:text-[var(--opaline-on-surface-variant)] hover:bg-[var(--opaline-surface-container-low)] rounded-md p-1 transition-colors focus-ring"
            >
              <X className="h-5 w-5" />
            </button>
          </div>

          <DeviceSelection
            selectedDevices={selectedDevices}
            onDeviceChange={setSelectedDevices}
            disabled={isRecording}
          />

          <div className="mt-6 flex justify-end">
            <button
              onClick={() => {
                const micDevice = selectedDevices.micDevice || 'Default';
                const systemDevice = selectedDevices.systemDevice || 'Default';
                toast.success("Devices selected", {
                  description: `Microphone: ${micDevice}, System Audio: ${systemDevice}`
                });
                onClose('deviceSettings');
              }}
              className="px-4 py-2 text-sm font-medium text-primary-foreground bg-primary rounded-md hover:bg-[var(--opaline-primary-hover)] focus-ring"
            >
              Done
            </button>
          </div>
        </div>
      </div>
    )}

    {/* Language Settings Modal */}
    {modals.languageSettings && (
      <div className="fixed inset-0 bg-[var(--opaline-overlay)] flex items-center justify-center z-50">
        <div className="bg-[var(--opaline-surface-container-lowest)] rounded-xl border border-[var(--opaline-outline-variant)] p-6 max-w-md w-full mx-4 shadow-xl">
          <div className="flex justify-between items-center mb-4">
            <h3 className="text-lg font-semibold text-[var(--opaline-on-surface)]">Language Settings</h3>
            <button
              onClick={() => onClose('languageSettings')}
              className="text-[var(--opaline-outline)] hover:text-[var(--opaline-on-surface-variant)] hover:bg-[var(--opaline-surface-container-low)] rounded-md p-1 transition-colors focus-ring"
            >
              <X className="h-5 w-5" />
            </button>
          </div>

          <LanguageSelection
            selectedLanguage={selectedLanguage}
            onLanguageChange={setSelectedLanguage}
            disabled={isRecording}
            provider={transcriptModelConfig.provider}
          />

          <div className="mt-6 flex justify-end">
            <button
              onClick={() => onClose('languageSettings')}
              className="px-4 py-2 text-sm font-medium text-primary-foreground bg-primary rounded-md hover:bg-[var(--opaline-primary-hover)] focus-ring"
            >
              Done
            </button>
          </div>
        </div>
      </div>
    )}

    {/* Model Selection Modal */}
    {modals.modelSelector && (
      <div className="fixed inset-0 bg-[var(--opaline-overlay)] flex items-center justify-center z-50">
        <div className="bg-[var(--opaline-surface-container-lowest)] rounded-xl border border-[var(--opaline-outline-variant)] max-w-4xl w-full mx-4 shadow-xl max-h-[90vh] flex flex-col">
          {/* Fixed Header */}
          <div className="flex justify-between items-center p-6 pb-4 border-b border-[var(--opaline-outline-variant)]">
            <h3 className="text-lg font-semibold text-[var(--opaline-on-surface)]">
              {messages.modelSelector ? 'Speech Recognition Setup Required' : 'Transcription Model Settings'}
            </h3>
            <button
              onClick={() => onClose('modelSelector')}
              className="text-[var(--opaline-outline)] hover:text-[var(--opaline-on-surface-variant)] hover:bg-[var(--opaline-surface-container-low)] rounded-md p-1 transition-colors focus-ring"
            >
              <X className="h-5 w-5" />
            </button>
          </div>

          {/* Scrollable Content */}
          <div className="flex-1 overflow-y-auto p-6 pt-4">
            <TranscriptSettings
              transcriptModelConfig={transcriptModelConfig}
              setTranscriptModelConfig={setTranscriptModelConfig}
              onModelSelect={() => onClose('modelSelector')}
            />
          </div>

          {/* Fixed Footer */}
          <div className="p-6 pt-4 border-t border-[var(--opaline-outline-variant)] flex items-center justify-between">
            {/* Confidence Indicator Toggle */}
            <div className="flex items-center gap-3">
              <label className="relative inline-flex items-center cursor-pointer">
                <input
                  type="checkbox"
                  checked={showConfidenceIndicator}
                  onChange={(e) => toggleConfidenceIndicator(e.target.checked)}
                  className="sr-only peer"
                />
                <div className="w-11 h-6 bg-[var(--opaline-surface-container)] peer-focus:outline-none peer-focus:ring-2 peer-focus:ring-[var(--opaline-primary)] rounded-full peer peer-checked:after:translate-x-full rtl:peer-checked:after:-translate-x-full peer-checked:after:border-[var(--opaline-outline-variant)] after:content-[''] after:absolute after:top-[2px] after:start-[2px] after:bg-[var(--opaline-surface-container-lowest)] after:border-[var(--opaline-outline-variant)] after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-primary"></div>
              </label>
              <div>
                <p className="text-sm font-medium text-[var(--opaline-on-surface-variant)]">Show Confidence Indicators</p>
                <p className="text-xs text-[var(--opaline-outline)]">Display colored dots showing transcription confidence quality</p>
              </div>
            </div>

            <button
              onClick={() => onClose('modelSelector')}
              className="px-4 py-2 text-sm font-medium text-[var(--opaline-on-surface-variant)] bg-[var(--opaline-surface-container-low)] rounded-md hover:bg-[var(--opaline-surface-container)] focus-ring"
            >
              {messages.modelSelector ? 'Cancel' : 'Done'}
            </button>
          </div>
        </div>
      </div>
    )}

    {/* Error Alert Modal */}
    {modals.errorAlert && (
      <div className="fixed inset-0 bg-[var(--opaline-overlay)] flex items-center justify-center z-50">
        <Alert className="max-w-md mx-4 border-[var(--opaline-danger-border)] bg-[var(--opaline-surface-container-lowest)] shadow-xl">
          <AlertTitle className="text-danger">Recording Stopped</AlertTitle>
          <AlertDescription className="text-danger">
            {messages.errorAlert}
            <button
              onClick={() => onClose('errorAlert')}
              className="ml-2 text-danger hover:text-danger underline"
            >
              Dismiss
            </button>
          </AlertDescription>
        </Alert>
      </div>
    )}

    {/* Chunk Drop Warning Modal */}
    {modals.chunkDropWarning && (
      <div className="fixed inset-0 bg-[var(--opaline-overlay)] flex items-center justify-center z-50">
        <Alert className="max-w-lg mx-4 border-[var(--opaline-warning-border)] bg-[var(--opaline-surface-container-lowest)] shadow-xl">
          <AlertTitle className="text-warning">Transcription Performance Warning</AlertTitle>
          <AlertDescription className="text-warning">
            {messages.chunkDropWarning}
            <button
              onClick={() => onClose('chunkDropWarning')}
              className="ml-2 text-warning hover:text-warning underline"
            >
              Dismiss
            </button>
          </AlertDescription>
        </Alert>
      </div>
    )}
  </>
}
