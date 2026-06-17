// SSE event + block-model types. Mirrors the AI service event taxonomy (apps/ai).

export interface CitationInfo {
  eid: string;
  source_kind: "chunk" | "row";
  source_id: string;
  document_id: string;
  page: number | null;
  bbox: number[] | null;
  polygon: number[][] | null;
  breadcrumb: string | null;
  used?: boolean;
}

export type AgentEvent =
  | { type: "run_started"; run_id: string; model: string; seq: number }
  | { type: "thinking_delta"; text: string; seq: number }
  | { type: "text_delta"; text: string; seq: number }
  | { type: "tool_started"; call_id: string; tool: string; label: string; seq: number }
  | { type: "tool_result"; call_id: string; tool: string; summary: string; duration_ms: number; seq: number }
  | { type: "evidence_added"; eid: string; seq: number; [k: string]: unknown }
  | { type: "clarification_required"; call_id: string; question: string; options: string[]; seq: number }
  | { type: "citation_map"; map: Record<string, CitationInfo>; seq: number }
  | { type: "confidence"; level: string; reason: string; seq: number }
  | { type: "run_completed"; usage: unknown; duration_ms: number; steps: number; seq: number }
  | { type: "error"; message: string; recoverable: boolean; seq: number };

export type Block =
  | { kind: "thinking"; text: string }
  | { kind: "tool"; callId: string; tool: string; label: string; summary?: string; durationMs?: number; done: boolean }
  | { kind: "text"; text: string }
  | { kind: "clarification"; callId: string; question: string; options: string[] };

export interface AssistantMessage {
  blocks: Block[];
  citations: Record<string, CitationInfo>;
  confidence?: { level: string; reason: string };
  steps?: number;
  running: boolean;
}

export interface Turn {
  user: string;
  assistant: AssistantMessage;
}
