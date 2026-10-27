export type Severity = "info" | "warning" | "critical";

export interface EventEvidence {
  signalName: string;
  timestamp: number;
  value: number | string;
  unit?: string;
  description: string;
  messageId?: number;
  channel?: string;
}

export interface VehicleEvent {
  id: string;
  type: string;
  severity: Severity;
  startTime: number;
  endTime: number;
  title: string;
  summary: string;
  detectionRule?: string;
  confidence?: number;
  evidence: EventEvidence[];
  limitations: string[];
}

export interface SignalPoint {
  t: number;
  value: number;
  raw: number;
  label?: string;
}

export interface SignalSeries {
  messageId: number;
  messageName: string;
  signalName: string;
  unit: string;
  length: number;
  totalPoints: number;
  truncated: boolean;
  points: SignalPoint[];
}

export interface SignalMetadata {
  messageId: number;
  messageName: string;
  dlc: number;
  signalName: string;
  unit: string;
  factor: number;
  offset: number;
  min: number;
  max: number;
  signed: boolean;
  littleEndian: boolean;
  startBit: number;
  length: number;
  valueTable?: Record<string, string>;
  sampleCount: number;
}

export interface TimelineEntry {
  id: string;
  theme: string;
  title: string;
  startTime: number;
  endTime: number;
  severity: Severity;
  observedFacts: string[];
  interpretations: string[];
  eventIds: string[];
  events: VehicleEvent[];
  confidence?: number;
  limitations: string[];
  summary: string;
}

export interface AnalysisStatistics {
  totalFrames: number;
  decodedFrames: number;
  skippedFrames: number;
  unknownFrames: number;
  decodedMessageCount: number;
  warningCount: number;
  logDurationSec: number;
  messageCount: number;
  signalCount: number;
  parseWarningCount: number;
  totalWarningCount: number;
}

export interface UnknownIdStatistics {
  id: number;
  idHex: string;
  count: number;
}

export interface UnsupportedDetector {
  detector: string;
  reason: string;
}

export interface Timeline {
  startTime: number;
  endTime: number;
  durationSec: number;
  entries: TimelineEntry[];
  summary: string;
  statistics: {
    totalEvents: number;
    groupedEvents: number;
    episodeCount: number;
  };
}

export interface AnalysisResult {
  version: number;
  statistics: AnalysisStatistics;
  signals: SignalMetadata[];
  series: SignalSeries[];
  unknownIds: UnknownIdStatistics[];
  events: VehicleEvent[];
  timeline: Timeline;
  warnings: string[];
  unsupported: UnsupportedDetector[];
}

export interface AnalysisResponse extends AnalysisResult {
  analysisId?: string;
  source?: string;
}

export interface NarrationEntry {
  time: number;
  text: string;
}

export interface NarrationReport {
  overallSummary: string;
  narrative: NarrationEntry[];
  importantFindings: string[];
  dataQualityCaveats: string[];
  openQuestions: string[];
}

export interface NarrationResponse {
  mode: "llm" | "fallback";
  provider: string;
  report: NarrationReport;
  warnings: string[];
}

export type NarrationState =
  | { status: "idle" }
  | { status: "loading" }
  | { status: "ready"; data: NarrationResponse }
  | { status: "error"; message: string };

export interface HealthResponse {
  status: string;
  narration: {
    provider: string;
    configured: boolean;
  };
}
