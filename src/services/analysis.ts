import { parseCandump, type CandumpLimits } from "../core/candump.js";
import { parseDbc, type Dbc } from "../core/dbc.js";
import {
  decodeLog,
  type DecodedLog,
  type DecodedLogStatistics,
} from "../core/decodeLog.js";
import {
  detectEvents,
  type DetectorConfig,
  type UnsupportedDetector,
  type VehicleEvent,
} from "../core/events.js";
import { buildTimeline, type Timeline, type TimelineConfig } from "../core/timeline.js";

export const ANALYSIS_RESULT_VERSION = 1;

export interface AnalysisLimits {
  maxLogBytes: number;
  maxDbcBytes: number;
  candump: Partial<CandumpLimits>;
}

export const DEFAULT_ANALYSIS_LIMITS: AnalysisLimits = {
  maxLogBytes: 32 * 1024 * 1024,
  maxDbcBytes: 4 * 1024 * 1024,
  candump: {},
};

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
  valueTable?: Record<number, string>;
  sampleCount: number;
}

export interface UnknownIdStatistics {
  id: number;
  idHex: string;
  count: number;
}

export interface DecodedSignalPoint {
  t: number;
  value: number;
  raw: number;
  label?: string;
}

export interface DecodedSignalSeries {
  messageId: number;
  messageName: string;
  signalName: string;
  unit: string;
  length: number;
  totalPoints: number;
  truncated: boolean;
  points: DecodedSignalPoint[];
}

/** Upper bound per signal to keep API responses and charts bounded. */
export const MAX_SERIES_POINTS = 5000;

export interface AnalysisRequest {
  logText: string;
  dbcText?: string;
  detectorConfig?: DetectorConfig;
  timelineConfig?: TimelineConfig;
  limits?: Partial<AnalysisLimits>;
}

export interface AnalysisResult {
  version: number;
  statistics: DecodedLogStatistics & {
    logDurationSec: number;
    messageCount: number;
    signalCount: number;
    parseWarningCount: number;
    totalWarningCount: number;
  };
  signals: SignalMetadata[];
  series: DecodedSignalSeries[];
  unknownIds: UnknownIdStatistics[];
  events: VehicleEvent[];
  timeline: Timeline;
  warnings: string[];
  unsupported: UnsupportedDetector[];
}

export class AnalysisError extends Error {
  readonly code: string;
  readonly details: string[];

  constructor(code: string, message: string, details: string[] = []) {
    super(message);
    this.name = "AnalysisError";
    this.code = code;
    this.details = details;
  }
}

function byteLength(text: string): number {
  return Buffer.byteLength(text, "utf8");
}

function collectSignals(
  dbc: Dbc,
  sampleCounts: Map<string, number>,
): SignalMetadata[] {
  const metadata: SignalMetadata[] = [];

  for (const message of dbc.messages.values()) {
    for (const signal of message.signals) {
      const key = `${message.name}\u0000${signal.name}`;
      const entry: SignalMetadata = {
        messageId: message.id,
        messageName: message.name,
        dlc: message.dlc,
        signalName: signal.name,
        unit: signal.unit,
        factor: signal.factor,
        offset: signal.offset,
        min: signal.min,
        max: signal.max,
        signed: signal.signed,
        littleEndian: signal.littleEndian,
        startBit: signal.startBit,
        length: signal.length,
        sampleCount: sampleCounts.get(key) ?? 0,
      };
      if (signal.valueTable) entry.valueTable = signal.valueTable;
      metadata.push(entry);
    }
  }

  return metadata;
}

function messageSampleCounts(log: DecodedLog): Map<string, number> {
  const counts = new Map<string, number>();
  for (const sample of log.samples) {
    for (const signalName of Object.keys(sample.signals)) {
      const key = `${sample.messageName}\u0000${signalName}`;
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }
  }
  return counts;
}

function collectSeries(
  log: DecodedLog,
  signals: SignalMetadata[],
): DecodedSignalSeries[] {
  const lengths = new Map<string, number>();
  for (const signal of signals) {
    lengths.set(`${signal.messageName}\u0000${signal.signalName}`, signal.length);
  }

  const byKey = new Map<string, DecodedSignalSeries>();

  for (const sample of log.samples) {
    for (const [signalName, decoded] of Object.entries(sample.signals)) {
      const key = `${sample.messageName}\u0000${signalName}`;
      let series = byKey.get(key);
      if (!series) {
        series = {
          messageId: sample.id,
          messageName: sample.messageName,
          signalName,
          unit: decoded.unit,
          length: lengths.get(key) ?? 0,
          totalPoints: 0,
          truncated: false,
          points: [],
        };
        byKey.set(key, series);
      }

      series.points.push({
        t: sample.t,
        value: decoded.value,
        raw: decoded.raw,
        ...(decoded.label === undefined ? {} : { label: decoded.label }),
      });
    }
  }

  const result = [...byKey.values()];
  for (const series of result) {
    series.points.sort((a, b) => a.t - b.t);
    series.totalPoints = series.points.length;
    if (series.points.length > MAX_SERIES_POINTS) {
      series.points = series.points.slice(0, MAX_SERIES_POINTS);
      series.truncated = true;
    }
  }

  return result.sort(
    (a, b) =>
      a.messageId - b.messageId || a.signalName.localeCompare(b.signalName),
  );
}

export function analyze(input: AnalysisRequest): AnalysisResult {
  const limits: AnalysisLimits = {
    ...DEFAULT_ANALYSIS_LIMITS,
    ...input.limits,
    candump: {
      ...DEFAULT_ANALYSIS_LIMITS.candump,
      ...input.limits?.candump,
    },
  };

  if (typeof input.logText !== "string" || input.logText.trim() === "") {
    throw new AnalysisError(
      "empty_log",
      "The CAN log is empty. Provide a candump log with at least one frame.",
    );
  }

  if (byteLength(input.logText) > limits.maxLogBytes) {
    throw new AnalysisError(
      "log_too_large",
      `The CAN log exceeds the maximum size of ${limits.maxLogBytes} bytes.`,
    );
  }

  if (input.dbcText !== undefined) {
    if (input.dbcText.trim() === "") {
      throw new AnalysisError(
        "empty_dbc",
        "The DBC file was provided but is empty.",
      );
    }
    if (byteLength(input.dbcText) > limits.maxDbcBytes) {
      throw new AnalysisError(
        "dbc_too_large",
        `The DBC file exceeds the maximum size of ${limits.maxDbcBytes} bytes.`,
      );
    }
  }

  let dbc: Dbc;
  try {
    dbc = parseDbc(input.dbcText ?? "");
  } catch (error) {
    throw new AnalysisError(
      "invalid_dbc",
      "The DBC file could not be parsed.",
      [error instanceof Error ? error.message : String(error)],
    );
  }

  const parsed = parseCandump(input.logText, limits.candump);

  if (parsed.frames.length === 0) {
    throw new AnalysisError(
      "no_frames",
      "No valid CAN frames were found in the log.",
      parsed.warnings.slice(0, 10),
    );
  }

  const log = decodeLog(dbc, parsed.frames);
  const detection = detectEvents(log, input.detectorConfig ?? {});
  const timeline = buildTimeline(detection.events, input.timelineConfig ?? {});

  const warnings = [...parsed.warnings, ...log.warnings, ...detection.warnings];
  if (input.dbcText === undefined) {
    warnings.unshift(
      "No DBC file was supplied; CAN frames were counted but no signals were decoded and most detectors were unavailable.",
    );
  }
  const unknownIds: UnknownIdStatistics[] = [...log.unknownIds.entries()]
    .map(([id, count]) => ({
      id,
      idHex: `0x${id.toString(16).toUpperCase()}`,
      count,
    }))
    .sort((a, b) => b.count - a.count || a.id - b.id);

  const signals = collectSignals(dbc, messageSampleCounts(log));
  const series = collectSeries(log, signals);

  return {
    version: ANALYSIS_RESULT_VERSION,
    statistics: {
      ...log.statistics,
      logDurationSec: log.durationSec,
      messageCount: dbc.messages.size,
      signalCount: signals.length,
      parseWarningCount: parsed.warnings.length,
      totalWarningCount: warnings.length,
    },
    signals,
    series,
    unknownIds,
    events: detection.events,
    timeline,
    warnings,
    unsupported: detection.unsupported,
  };
}
