// Stub for the deleted summary type definitions.

export interface SummaryResponse {
  status: string;
  summary: any;
  raw_summary?: string;
  usage?: {
    prompt_tokens: number;
    completion_tokens: number;
    total_tokens: number;
  };
}

export interface ProcessRequest {
  meetingId: string;
  modelConfig?: any;
  customPrompt?: string;
  templateId?: string;
  [key: string]: any;
}
