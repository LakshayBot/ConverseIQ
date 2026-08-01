// Types for whisper-rs integration
export interface ModelInfo {
  name: string;
  path: string;
  size_mb: number;
  accuracy: ModelAccuracy;
  speed: ProcessingSpeed;
  status: ModelStatus;
  description?: string;
}

export type ModelAccuracy = 'High' | 'Good' | 'Decent';
export type ProcessingSpeed = 'Slow' | 'Medium' | 'Fast' | 'Very Fast';

export type ModelStatus =
  | 'Available'
  | 'Missing'
  | { Downloading: number }
  | { Error: string }
  | { Corrupted: { file_size: number; expected_min_size: number } };

export interface ModelDownloadProgress {
  modelName: string;
  progress: number;
  totalBytes: number;
  downloadedBytes: number;
  speed: string;
}

export interface WhisperEngineState {
  currentModel: string | null;
  availableModels: ModelInfo[];
  isLoading: boolean;
  error: string | null;
}

// Tauri command interfaces
export interface DownloadModelRequest {
  modelName: string;
}

export interface SwitchModelRequest {
  modelName: string;
}

export interface TranscribeAudioRequest {
  audioData: number[];
  sampleRate: number;
}

// Model configuration for different use cases - CallPilot-curated list.
// We keep exactly the four models the brief calls out:
//   ggml-tiny.en      - 75 MB
//   ggml-base.en      - 142 MB (default)
//   ggml-small.en     - 466 MB
//   Parakeet TDT 0.6B - 600 MB (handled separately via lib/parakeet.ts)
//
// Sources:
//   ggml: https://huggingface.co/ggerganov/whisper.cpp/resolve/main/
//   Parakeet: https://huggingface.co/istupakov/parakeet-tdt-0.6b-v3-onnx
export const MODEL_CONFIGS: Record<string, Partial<ModelInfo>> = {
  'ggml-tiny.en': {
    description: 'Fastest Whisper model. Best for low-end hardware; lower accuracy on noisy audio.',
    size_mb: 75,
    accuracy: 'Decent',
    speed: 'Very Fast',
  },
  'ggml-base.en': {
    description: 'Recommended default - good balance of speed and accuracy for live sales calls.',
    size_mb: 142,
    accuracy: 'Good',
    speed: 'Fast',
  },
  'ggml-small.en': {
    description: 'Best CPU accuracy in the Whisper family. Use when you can spare the extra 3× compute.',
    size_mb: 466,
    accuracy: 'High',
    speed: 'Medium',
  },
};

// Default model id (matches the task brief).
export const DEFAULT_WHISPER_MODEL = 'ggml-base.en';

// Helper functions
export function getModelIcon(accuracy: ModelAccuracy): string {
  switch (accuracy) {
    case 'High': return '🔥';
    case 'Good': return '⚡';
    case 'Decent': return '🚀';
    default: return '📊';
  }
}

export function getStatusColor(status: ModelStatus): string {
  if (status === 'Available') return 'green';
  if (status === 'Missing') return 'gray';
  if (typeof status === 'object' && 'Downloading' in status) return 'blue';
  if (typeof status === 'object' && 'Error' in status) return 'red';
  return 'gray';
}

export function formatFileSize(sizeMb: number): string {
  if (sizeMb >= 1000) {
    return `${(sizeMb / 1000).toFixed(1)}GB`;
  }
  return `${sizeMb}MB`;
}

// Helper function to get model type (f16, q5_1, q5_0, q4_0)
export function getModelType(modelName: string): 'f16' | 'q5_1' | 'q5_0' | 'q4_0' {
  if (modelName.includes('-q5_1')) return 'q5_1';
  if (modelName.includes('-q5_0')) return 'q5_0';
  if (modelName.includes('-q4_0')) return 'q4_0';
  return 'f16';
}

// Helper function to get model base name (without quantization suffix)
export function getModelBaseName(modelName: string): string {
  return modelName.replace(/-q[45]_[01]$/, '');
}

// Helper function to check if model is quantized
export function isQuantizedModel(modelName: string): boolean {
  return modelName.includes('-q');
}

// Helper function to get model performance badge
export function getModelPerformanceBadge(modelName: string): { label: string; color: string } {
  const type = getModelType(modelName);
  switch (type) {
    case 'f16':
      return { label: 'Full Precision', color: 'blue' };
    case 'q5_1':
      return { label: 'Balanced+', color: 'green' };
    case 'q5_0':
      return { label: 'Balanced', color: 'green' };
    case 'q4_0':
      return { label: 'Fast', color: 'orange' };
    default:
      return { label: 'Standard', color: 'gray' };
  }
}

// Helper function to get concise tagline for model (similar to Parakeet style)
export function getModelTagline(modelName: string, speed: ProcessingSpeed, accuracy: ModelAccuracy): string {
  const isQuantized = isQuantizedModel(modelName);
  const baseName = getModelBaseName(modelName);

  // Speed prefix
  let speedText = '';
  switch (speed) {
    case 'Very Fast':
      speedText = 'Real time';
      break;
    case 'Fast':
      speedText = 'Fast processing';
      break;
    case 'Medium':
      speedText = 'Moderate speed';
      break;
    case 'Slow':
      speedText = 'Slower processing';
      break;
  }

  // Key feature based on model and accuracy
  let featureText = '';
  if (baseName === 'large-v3') {
    featureText = 'Most accurate';
  } else if (baseName === 'large-v3-turbo') {
    featureText = 'Best accuracy with speed';
  } else if (baseName === 'medium') {
    featureText = accuracy === 'High' ? 'Professional quality' : 'Balanced quality';
  } else if (baseName === 'small') {
    featureText = 'Good accuracy';
  } else if (baseName === 'base') {
    featureText = 'Balanced quality';
  } else if (baseName === 'tiny') {
    featureText = 'Fastest option';
  }

  // Add quantization note if applicable
  if (isQuantized) {
    const quantType = getModelType(modelName);
    if (quantType === 'q5_0') {
      featureText += ', optimized';
    } else if (quantType === 'q4_0') {
      featureText += ', ultra fast';
    }
  }

  return `${speedText} • ${featureText}`;
}

// Group models by their base name for better UI organization
export function groupModelsByBase(models: ModelInfo[]): Record<string, ModelInfo[]> {
  const grouped: Record<string, ModelInfo[]> = {};

  models.forEach(model => {
    const baseName = getModelBaseName(model.name);
    if (!grouped[baseName]) {
      grouped[baseName] = [];
    }
    grouped[baseName].push(model);
  });

  // Sort each group: f16 first, then q5_1, then q5_0, then q4_0
  Object.keys(grouped).forEach(baseName => {
    grouped[baseName].sort((a, b) => {
      const aType = getModelType(a.name);
      const bType = getModelType(b.name);
      const order = { 'f16': 0, 'q5_1': 1, 'q5_0': 2, 'q4_0': 3 };
      return order[aType] - order[bType];
    });
  });

  return grouped;
}

export function getRecommendedModel(systemSpecs?: { ram: number; cores: number }): string {
  if (!systemSpecs) return DEFAULT_WHISPER_MODEL;

  if (systemSpecs.ram >= 8000 && systemSpecs.cores >= 8) {
    return 'ggml-small.en'; // High-end system
  } else if (systemSpecs.ram >= 4000 && systemSpecs.cores >= 4) {
    return DEFAULT_WHISPER_MODEL; // Mid-range system
  }
  return 'ggml-tiny.en'; // Lower-spec system
}

// Tauri command wrappers for whisper-rs backend
import { invoke } from '@tauri-apps/api/core';

export class WhisperAPI {
  static async init(): Promise<void> {
    await invoke('whisper_init');
  }

  static async getAvailableModels(): Promise<ModelInfo[]> {
    return await invoke('whisper_get_available_models');
  }

  static async loadModel(modelName: string): Promise<void> {
    await invoke('whisper_load_model', { modelName });
  }

  static async getCurrentModel(): Promise<string | null> {
    return await invoke('whisper_get_current_model');
  }

  static async isModelLoaded(): Promise<boolean> {
    return await invoke('whisper_is_model_loaded');
  }

  static async transcribeAudio(audioData: number[]): Promise<string> {
    return await invoke('whisper_transcribe_audio', { audioData });
  }

  static async getModelsDirectory(): Promise<string> {
    return await invoke('whisper_get_models_directory');
  }

  static async downloadModel(modelName: string): Promise<void> {
    await invoke('whisper_download_model', { modelName });
  }

  static async cancelDownload(modelName: string): Promise<void> {
    await invoke('whisper_cancel_download', { modelName });
  }

  static async deleteCorruptedModel(modelName: string): Promise<string> {
    return await invoke('whisper_delete_corrupted_model', { modelName });
  }

  static async hasAvailableModels(): Promise<boolean> {
    return await invoke('whisper_has_available_models');
  }

  static async validateModelReady(): Promise<string> {
    return await invoke('whisper_validate_model_ready');
  }

  static async openModelsFolder(): Promise<void> {
    await invoke('open_models_folder');
  }
}
