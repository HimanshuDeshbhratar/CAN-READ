import type { AnalysisResult } from "../services/analysis.js";
import { ANALYSIS_RESULT_VERSION } from "../services/analysis.js";
import type { TimelineConfig } from "../core/timeline.js";

export interface ValidationIssue {
  path: string;
  message: string;
}

export type ValidationResult<T> =
  | { ok: true; value: T }
  | { ok: false; issues: ValidationIssue[] };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

const UNSAFE_KEYS = new Set(["__proto__", "prototype", "constructor"]);

function hasUnsafeKeys(value: unknown, depth = 0): boolean {
  if (depth > 8) return false;
  if (Array.isArray(value)) {
    return value.some((item) => hasUnsafeKeys(item, depth + 1));
  }
  if (!isRecord(value)) return false;

  for (const key of Object.keys(value)) {
    if (UNSAFE_KEYS.has(key)) return true;
    if (hasUnsafeKeys(value[key], depth + 1)) return true;
  }
  return false;
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function isStringOfLength(value: unknown, maxLength: number): value is string {
  return typeof value === "string" && value.length <= maxLength;
}

function isStringArray(value: unknown): value is string[] {
  return (
    Array.isArray(value) &&
    value.every((item) => isStringOfLength(item, 5000))
  );
}

const SEVERITIES = new Set(["info", "warning", "critical"]);

function isSignalMetadata(value: unknown): boolean {
  if (!isRecord(value)) return false;
  if (!isStringOfLength(value["messageName"], 512)) return false;
  if (!isStringOfLength(value["signalName"], 512)) return false;
  if (!isStringOfLength(value["unit"], 128)) return false;
  if (!isFiniteNumber(value["messageId"])) return false;
  if (!isFiniteNumber(value["dlc"])) return false;
  if (!isFiniteNumber(value["factor"])) return false;
  if (!isFiniteNumber(value["offset"])) return false;
  if (!isFiniteNumber(value["min"])) return false;
  if (!isFiniteNumber(value["max"])) return false;
  if (!isFiniteNumber(value["startBit"])) return false;
  if (!isFiniteNumber(value["length"])) return false;
  if (!isFiniteNumber(value["sampleCount"])) return false;
  if (typeof value["signed"] !== "boolean") return false;
  if (typeof value["littleEndian"] !== "boolean") return false;
  return true;
}

function isEvidence(value: unknown): boolean {
  if (!isRecord(value)) return false;
  if (!isStringOfLength(value["signalName"], 512)) return false;
  if (!isFiniteNumber(value["timestamp"])) return false;
  const evidenceValue = value["value"];
  if (typeof evidenceValue !== "number" && typeof evidenceValue !== "string") {
    return false;
  }
  if (typeof evidenceValue === "number" && !Number.isFinite(evidenceValue)) {
    return false;
  }
  if (!isStringOfLength(value["description"], 5000)) return false;
  if (value["unit"] !== undefined && !isStringOfLength(value["unit"], 128)) {
    return false;
  }
  return true;
}

function isEvent(value: unknown): boolean {
  if (!isRecord(value)) return false;
  if (!isStringOfLength(value["id"], 512)) return false;
  if (!isStringOfLength(value["type"], 128)) return false;
  if (!isStringOfLength(value["title"], 5000)) return false;
  if (!isStringOfLength(value["summary"], 5000)) return false;
  if (
    typeof value["severity"] !== "string" ||
    !SEVERITIES.has(value["severity"])
  ) {
    return false;
  }
  if (!isFiniteNumber(value["startTime"])) return false;
  if (!isFiniteNumber(value["endTime"])) return false;
  if (
    value["confidence"] !== undefined &&
    (!isFiniteNumber(value["confidence"]) ||
      value["confidence"] < 0 ||
      value["confidence"] > 1)
  ) {
    return false;
  }
  if (!Array.isArray(value["evidence"])) return false;
  if (value["evidence"].length > 100) return false;
  if (!value["evidence"].every(isEvidence)) return false;
  if (!isStringArray(value["limitations"])) return false;
  return true;
}

function isTimelineEntry(value: unknown): boolean {
  if (!isRecord(value)) return false;
  if (!isStringOfLength(value["id"], 512)) return false;
  if (!isStringOfLength(value["theme"], 128)) return false;
  if (!isStringOfLength(value["title"], 5000)) return false;
  if (!isStringOfLength(value["summary"], 5000)) return false;
  if (
    typeof value["severity"] !== "string" ||
    !SEVERITIES.has(value["severity"])
  ) {
    return false;
  }
  if (!isFiniteNumber(value["startTime"])) return false;
  if (!isFiniteNumber(value["endTime"])) return false;
  if (!isStringArray(value["observedFacts"])) return false;
  if (!isStringArray(value["interpretations"])) return false;
  if (!isStringArray(value["eventIds"])) return false;
  if (!isStringArray(value["limitations"])) return false;
  if (!Array.isArray(value["events"])) return false;
  if (!value["events"].every(isEvent)) return false;
  return true;
}

function isTimeline(value: unknown): boolean {
  if (!isRecord(value)) return false;
  if (!isFiniteNumber(value["startTime"])) return false;
  if (!isFiniteNumber(value["endTime"])) return false;
  if (!isFiniteNumber(value["durationSec"])) return false;
  if (!isStringOfLength(value["summary"], 5000)) return false;
  if (!Array.isArray(value["entries"])) return false;
  return value["entries"].every(isTimelineEntry);
}

/**
 * Structural validation for an analysis object supplied by a client.
 * Only shape and finiteness are checked; the narration prompt still treats
 * every string inside it as untrusted data.
 */
export function validateAnalysisResult(
  value: unknown,
): ValidationResult<AnalysisResult> {
  const issues: ValidationIssue[] = [];

  if (!isRecord(value)) {
    return {
      ok: false,
      issues: [{ path: "", message: "analysis must be a JSON object." }],
    };
  }

  if (value["version"] !== ANALYSIS_RESULT_VERSION) {
    issues.push({
      path: "version",
      message: `version must be ${ANALYSIS_RESULT_VERSION}.`,
    });
  }

  const statistics = value["statistics"];
  if (!isRecord(statistics)) {
    issues.push({ path: "statistics", message: "statistics must be an object." });
  } else {
    for (const key of [
      "totalFrames",
      "decodedFrames",
      "skippedFrames",
      "unknownFrames",
      "logDurationSec",
      "messageCount",
      "signalCount",
    ]) {
      if (!isFiniteNumber(statistics[key])) {
        issues.push({
          path: `statistics.${key}`,
          message: "must be a finite number.",
        });
      }
    }
  }

if (!Array.isArray(value["signals"])) {
    issues.push({ path: "signals", message: "signals must be an array." });
  } else if (value["signals"].length > 5000) {
    issues.push({ path: "signals", message: "at most 5000 signals are accepted." });
  } else if (!value["signals"].every(isSignalMetadata)) {
    issues.push({
      path: "signals",
      message: "each signal needs a message, name, unit, scaling, and sample count.",
    });
  }

  if (!Array.isArray(value["unknownIds"])) {
    issues.push({
      path: "unknownIds",
      message: "unknownIds must be an array.",
    });
  } else {
    for (const entry of value["unknownIds"]) {
      if (!isRecord(entry) || !isFiniteNumber(entry["id"]) || !isFiniteNumber(entry["count"])) {
        issues.push({
          path: "unknownIds",
          message: "each entry needs a numeric id and count.",
        });
        break;
      }
    }
  }

if (!Array.isArray(value["events"])) {
    issues.push({ path: "events", message: "events must be an array." });
  } else if (value["events"].length > 2000) {
    issues.push({ path: "events", message: "at most 2000 events are accepted." });
  } else if (!value["events"].every(isEvent)) {
    issues.push({
      path: "events",
      message: "each event needs id, type, title, summary, timestamps, evidence, and limitations.",
    });
  }

if (!isTimeline(value["timeline"])) {
    issues.push({
      path: "timeline",
      message: "timeline must contain entries with ids, timestamps, and event ids.",
    });
  } else if (
    Array.isArray((value["timeline"] as Record<string, unknown>)["entries"]) &&
    ((value["timeline"] as Record<string, unknown>)["entries"] as unknown[]).length > 2000
  ) {
    issues.push({
      path: "timeline.entries",
      message: "at most 2000 timeline entries are accepted.",
    });
  }

  if (!isStringArray(value["warnings"])) {
    issues.push({ path: "warnings", message: "warnings must be an array of strings." });
  } else if (value["warnings"].length > 1000) {
    issues.push({ path: "warnings", message: "at most 1000 warnings are accepted." });
  }

  if (!Array.isArray(value["unsupported"])) {
    issues.push({
      path: "unsupported",
      message: "unsupported must be an array.",
    });
  }

  if (issues.length > 0) return { ok: false, issues };
  return { ok: true, value: value as unknown as AnalysisResult };
}

export interface DetectorConfigLike {
  enabled?: Record<string, boolean>;
  signals?: Record<string, string | string[]>;
  deceleration?: Record<string, number>;
  brake?: Record<string, number | Array<number | string>>;
  abs?: Record<string, number | Array<number | string>>;
  gear?: Record<string, number>;
  dropout?: {
    expectedIntervalsSec?: Record<string, number>;
    gapFactor?: number;
    minGapSec?: number;
    minBaselineSamples?: number;
  };
  traffic?: {
    windowSec?: number;
    minBaselineWindows?: number;
    rateRatioThreshold?: number;
    minFramesPerWindow?: number;
  };
}

/**
 * Validates the optional analysis configuration supplied by a client.
 * Unknown keys are ignored rather than trusted.
 */
export function validateDetectorConfig(
  value: unknown,
): ValidationResult<DetectorConfigLike | undefined> {
  if (value === undefined || value === null) {
    return { ok: true, value: undefined };
  }

if (!isRecord(value)) {
    return {
      ok: false,
      issues: [{ path: "config", message: "config must be an object." }],
    };
  }

  if (hasUnsafeKeys(value)) {
    return {
      ok: false,
      issues: [
        {
          path: "config",
          message: "config contains a forbidden object key.",
        },
      ],
    };
  }

  const issues: ValidationIssue[] = [];
  const config: DetectorConfigLike = {};

  const enabled = value["enabled"];
  if (enabled !== undefined) {
    if (!isRecord(enabled)) {
      issues.push({ path: "config.enabled", message: "must be an object." });
    } else {
      config.enabled = {};
      for (const [key, flag] of Object.entries(enabled)) {
        if (typeof flag !== "boolean") {
          issues.push({
            path: `config.enabled.${key}`,
            message: "must be a boolean.",
          });
          continue;
        }
        config.enabled[key] = flag;
      }
    }
  }

  const signals = value["signals"];
  if (signals !== undefined) {
    if (!isRecord(signals)) {
      issues.push({ path: "config.signals", message: "must be an object." });
    } else {
      config.signals = {};
      for (const [key, selection] of Object.entries(signals)) {
        if (typeof selection === "string") {
          config.signals[key] = selection;
        } else if (
          Array.isArray(selection) &&
          selection.every((item) => typeof item === "string")
        ) {
          config.signals[key] = selection as string[];
        } else {
          issues.push({
            path: `config.signals.${key}`,
            message: "must be a string or an array of strings.",
          });
        }
      }
    }
  }

  const numericGroups = ["deceleration", "gear"] as const;
  for (const group of numericGroups) {
    const raw = value[group];
    if (raw === undefined) continue;
    if (!isRecord(raw)) {
      issues.push({ path: `config.${group}`, message: "must be an object." });
      continue;
    }
    const target: Record<string, number> = {};
    for (const [key, numeric] of Object.entries(raw)) {
      if (!isFiniteNumber(numeric)) {
        issues.push({
          path: `config.${group}.${key}`,
          message: "must be a finite number.",
        });
        continue;
      }
      target[key] = numeric;
    }
    config[group] = target;
  }

  const brake = value["brake"];
  if (brake !== undefined) {
    if (!isRecord(brake)) {
      issues.push({ path: "config.brake", message: "must be an object." });
    } else {
      const target: Record<string, number | Array<number | string>> = {};
      for (const [key, entry] of Object.entries(brake)) {
        if (isFiniteNumber(entry)) {
          target[key] = entry;
        } else if (
          Array.isArray(entry) &&
          entry.every(
            (item) => typeof item === "string" || isFiniteNumber(item),
          )
        ) {
          target[key] = entry as Array<number | string>;
        } else {
          issues.push({
            path: `config.brake.${key}`,
            message: "must be a number or an array of numbers/strings.",
          });
        }
      }
      config.brake = target;
    }
  }

  const abs = value["abs"];
  if (abs !== undefined) {
    if (!isRecord(abs)) {
      issues.push({ path: "config.abs", message: "must be an object." });
    } else {
      const target: Record<string, number | Array<number | string>> = {};
      for (const [key, entry] of Object.entries(abs)) {
        if (isFiniteNumber(entry)) {
          target[key] = entry;
        } else if (
          Array.isArray(entry) &&
          entry.every(
            (item) => typeof item === "string" || isFiniteNumber(item),
          )
        ) {
          target[key] = entry as Array<number | string>;
        } else {
          issues.push({
            path: `config.abs.${key}`,
            message: "must be a number or an array of numbers/strings.",
          });
        }
      }
      config.abs = target;
    }
  }

  const dropout = value["dropout"];
  if (dropout !== undefined) {
    if (!isRecord(dropout)) {
      issues.push({ path: "config.dropout", message: "must be an object." });
    } else {
      const target: NonNullable<DetectorConfigLike["dropout"]> = {};
      const expected = dropout["expectedIntervalsSec"];
      if (expected !== undefined) {
        if (!isRecord(expected)) {
          issues.push({
            path: "config.dropout.expectedIntervalsSec",
            message: "must be an object of numeric intervals.",
          });
        } else {
          target.expectedIntervalsSec = {};
          for (const [key, interval] of Object.entries(expected)) {
            if (!isFiniteNumber(interval)) {
              issues.push({
                path: `config.dropout.expectedIntervalsSec.${key}`,
                message: "must be a finite number.",
              });
              continue;
            }
            target.expectedIntervalsSec[key] = interval;
          }
        }
      }
      for (const key of ["gapFactor", "minGapSec", "minBaselineSamples"] as const) {
        const numeric = dropout[key];
        if (numeric === undefined) continue;
        if (!isFiniteNumber(numeric)) {
          issues.push({
            path: `config.dropout.${key}`,
            message: "must be a finite number.",
          });
          continue;
        }
        target[key] = numeric;
      }
      config.dropout = target;
    }
  }

  const traffic = value["traffic"];
  if (traffic !== undefined) {
    if (!isRecord(traffic)) {
      issues.push({ path: "config.traffic", message: "must be an object." });
    } else {
      const target: NonNullable<DetectorConfigLike["traffic"]> = {};
      for (const key of [
        "windowSec",
        "minBaselineWindows",
        "rateRatioThreshold",
        "minFramesPerWindow",
      ] as const) {
        const numeric = traffic[key];
        if (numeric === undefined) continue;
        if (!isFiniteNumber(numeric)) {
          issues.push({
            path: `config.traffic.${key}`,
            message: "must be a finite number.",
          });
          continue;
        }
        target[key] = numeric;
      }
config.traffic = target;
    }
  }

  const numericCheck = (
    group: Record<string, number | Array<number | string>> | undefined,
    key: string,
    path: string,
    predicate: (value: number) => boolean,
    message: string,
  ): void => {
    const value = group?.[key];
    if (typeof value === "number" && !predicate(value)) {
      issues.push({ path, message });
    }
  };

  numericCheck(
    config.deceleration,
    "maxDurationSec",
    "config.deceleration.maxDurationSec",
    (value) => value > 0,
    "must be greater than 0.",
  );
  numericCheck(
    config.deceleration,
    "minSpeedDropKmh",
    "config.deceleration.minSpeedDropKmh",
    (value) => value >= 0,
    "must be non-negative.",
  );
  numericCheck(
    config.deceleration,
    "minDecelerationMps2",
    "config.deceleration.minDecelerationMps2",
    (value) => value >= 0,
    "must be non-negative.",
  );
  numericCheck(
    config.brake,
    "pressureThreshold",
    "config.brake.pressureThreshold",
    (value) => value >= 0,
    "must be non-negative.",
  );
  numericCheck(
    config.brake,
    "minDurationSec",
    "config.brake.minDurationSec",
    (value) => value >= 0,
    "must be non-negative.",
  );
  numericCheck(
    config.abs,
    "maxGapFactor",
    "config.abs.maxGapFactor",
    (value) => value > 0,
    "must be greater than 0.",
  );
  numericCheck(
    config.gear,
    "minChangeIntervalSec",
    "config.gear.minChangeIntervalSec",
    (value) => value >= 0,
    "must be non-negative.",
  );

  if (config.dropout?.gapFactor !== undefined && config.dropout.gapFactor <= 0) {
    issues.push({
      path: "config.dropout.gapFactor",
      message: "must be greater than 0.",
    });
  }
  if (config.dropout?.minGapSec !== undefined && config.dropout.minGapSec < 0) {
    issues.push({
      path: "config.dropout.minGapSec",
      message: "must be non-negative.",
    });
  }
  if (
    config.dropout?.minBaselineSamples !== undefined &&
    (!Number.isInteger(config.dropout.minBaselineSamples) ||
      config.dropout.minBaselineSamples < 2)
  ) {
    issues.push({
      path: "config.dropout.minBaselineSamples",
      message: "must be an integer of at least 2.",
    });
  }
  if (
    config.traffic?.windowSec !== undefined &&
    config.traffic.windowSec <= 0
  ) {
    issues.push({
      path: "config.traffic.windowSec",
      message: "must be greater than 0.",
    });
  }
  if (
    config.traffic?.rateRatioThreshold !== undefined &&
    config.traffic.rateRatioThreshold <= 0
  ) {
    issues.push({
      path: "config.traffic.rateRatioThreshold",
      message: "must be greater than 0.",
    });
  }
  if (
    config.traffic?.minFramesPerWindow !== undefined &&
    config.traffic.minFramesPerWindow < 1
  ) {
    issues.push({
      path: "config.traffic.minFramesPerWindow",
      message: "must be at least 1.",
    });
  }
  if (
    config.traffic?.minBaselineWindows !== undefined &&
    config.traffic.minBaselineWindows < 1
  ) {
    issues.push({
      path: "config.traffic.minBaselineWindows",
      message: "must be at least 1.",
    });
  }

  if (issues.length > 0) return { ok: false, issues };
  return { ok: true, value: config };
}

export function validateTimelineConfig(
  value: unknown,
): ValidationResult<TimelineConfig | undefined> {
  if (value === undefined || value === null) {
    return { ok: true, value: undefined };
  }

  if (!isRecord(value)) {
    return {
      ok: false,
      issues: [{ path: "timeline", message: "timeline config must be an object." }],
    };
  }

  const issues: ValidationIssue[] = [];
  const config: TimelineConfig = {};

  const windowSec = value["windowSec"];
  if (windowSec !== undefined) {
    if (!isFiniteNumber(windowSec) || windowSec < 0) {
      issues.push({
        path: "timeline.windowSec",
        message: "must be a finite non-negative number.",
      });
    } else {
      config.windowSec = windowSec;
    }
  }

  const maxFactsPerEntry = value["maxFactsPerEntry"];
  if (maxFactsPerEntry !== undefined) {
    if (
      !isFiniteNumber(maxFactsPerEntry) ||
      !Number.isInteger(maxFactsPerEntry) ||
      maxFactsPerEntry < 1
    ) {
      issues.push({
        path: "timeline.maxFactsPerEntry",
        message: "must be a positive integer.",
      });
    } else {
      config.maxFactsPerEntry = maxFactsPerEntry;
    }
  }



  if (issues.length > 0) return { ok: false, issues };
  return { ok: true, value: config };
}
