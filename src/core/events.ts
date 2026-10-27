import type { DecodedLog } from "./decodeLog.js";

export type EventSeverity = "info" | "warning" | "critical";

export type DetectorName =
  | "rapid_deceleration"
  | "brake_activity"
  | "abs_activation"
  | "gear_change"
  | "signal_dropout"
  | "traffic_burst";

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
  type: DetectorName;
  severity: EventSeverity;
  startTime: number;
  endTime: number;
  title: string;
  summary: string;
  detectionRule?: string;
  confidence?: number;
  evidence: EventEvidence[];
  limitations: string[];
}

export interface UnsupportedDetector {
  detector: DetectorName;
  reason: string;
}

export interface EventDetectionResult {
  events: VehicleEvent[];
  unsupported: UnsupportedDetector[];
  warnings: string[];
}

export interface DetectorConfig {
  enabled?: Partial<Record<DetectorName, boolean>>;
  signals?: {
    speed?: string | string[];
    brakePressure?: string | string[];
    brakeSwitch?: string | string[];
    abs?: string | string[];
    gear?: string | string[];
  };
  deceleration?: {
    minSpeedDropKmh?: number;
    minDecelerationMps2?: number;
    maxDurationSec?: number;
    mergeGapSec?: number;
    criticalDecelerationMps2?: number;
  };
  brake?: {
    pressureThreshold?: number;
    minDurationSec?: number;
    switchActiveValues?: Array<number | string>;
  };
  abs?: {
    activeValues?: Array<number | string>;
    maxGapFactor?: number;
  };
  gear?: {
    minChangeIntervalSec?: number;
  };
  dropout?: {
    /** Expected message interval in seconds, keyed by message id or message name. */
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

interface SeriesPoint {
  t: number;
  value: number;
  raw: number;
  label: string | undefined;
}

interface SignalSeries {
  id: number;
  messageName: string;
  signalName: string;
  unit: string;
  hasLabels: boolean;
  points: SeriesPoint[];
}

interface DetectorContext {
  log: DecodedLog;
  series: SignalSeries[];
  config: DetectorConfig;
  nextId(type: DetectorName): string;
}

interface DetectorOutcome {
  events: VehicleEvent[];
  unsupported?: UnsupportedDetector;
}

interface DetectorDefinition {
  name: DetectorName;
  detect(context: DetectorContext): DetectorOutcome;
}

const SPEED_ALIASES = [
  "Speed_kmh",
  "VehicleSpeed",
  "VehicleSpeed_kmh",
  "VehSpeed",
  "Vehicle Speed",
  "Speed",
];
const BRAKE_PRESSURE_ALIASES = [
  "BrakePressure_pct",
  "BrakePressure",
  "BrakePress",
  "BrakePressure_bar",
];
const BRAKE_SWITCH_ALIASES = [
  "BrakeSwitch",
  "BrakeState",
  "BrakePedal",
  "BrakeActive",
  "Brake",
];
const ABS_ALIASES = ["ABS_Active", "ABSActive", "ABS"];
const GEAR_ALIASES = ["GearPosition", "Gear", "GearState", "SelectedGear"];

const ACTIVE_LABELS = new Set([
  "active",
  "on",
  "yes",
  "true",
  "enabled",
  "engaged",
  "applied",
  "pressed",
]);
const INACTIVE_LABELS = new Set([
  "inactive",
  "off",
  "no",
  "false",
  "disabled",
  "disengaged",
  "released",
]);

function normalizeName(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "");
}

function normalizeUnit(unit: string): string {
  return unit.trim().toLowerCase();
}

function hexId(id: number): string {
  return `0x${id.toString(16).toUpperCase()}`;
}

function formatValue(value: number): string {
  if (!Number.isFinite(value)) return String(value);
  return String(Math.round(value * 100) / 100);
}

function median(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 1) return sorted[middle]!;
  return (sorted[middle - 1]! + sorted[middle]!) / 2;
}

function buildSignalSeries(log: DecodedLog): SignalSeries[] {
  const byKey = new Map<string, SignalSeries>();

  for (const sample of log.samples) {
    for (const [signalName, decoded] of Object.entries(sample.signals)) {
      const key = `${sample.messageName}\u0000${signalName}`;
      let series = byKey.get(key);
      if (!series) {
        series = {
          id: sample.id,
          messageName: sample.messageName,
          signalName,
          unit: decoded.unit,
          hasLabels: false,
          points: [],
        };
        byKey.set(key, series);
      }

      if (decoded.label !== undefined) series.hasLabels = true;
      series.points.push({
        t: sample.t,
        value: decoded.value,
        raw: decoded.raw,
        label: decoded.label,
      });
    }
  }

  const series = [...byKey.values()];
  for (const entry of series) {
    entry.points.sort((a, b) => a.t - b.t);
  }
  return series;
}

function matchesSignal(series: SignalSeries, wanted: string): boolean {
  const normalized = normalizeName(wanted);
  return (
    normalizeName(series.signalName) === normalized ||
    normalizeName(`${series.messageName}.${series.signalName}`) === normalized ||
    normalizeName(`${series.messageName}_${series.signalName}`) === normalized
  );
}

function seriesScore(
  series: SignalSeries,
  preferUnit: string | undefined,
  preferLabels: boolean,
): number {
  let score = series.points.length;
  if (preferLabels && series.hasLabels) score += 1_000_000;
  if (preferUnit && normalizeUnit(series.unit) === preferUnit) score += 1_000;
  return score;
}

function chooseSeries(
  candidates: SignalSeries[],
  preferUnit?: string,
  preferLabels = false,
): SignalSeries | undefined {
  if (candidates.length === 0) return undefined;

  let best = candidates[0]!;
  let bestScore = seriesScore(
    best,
    preferUnit === undefined ? undefined : normalizeUnit(preferUnit),
    preferLabels,
  );

  for (let i = 1; i < candidates.length; i++) {
    const candidate = candidates[i]!;
    const score = seriesScore(
      candidate,
      preferUnit === undefined ? undefined : normalizeUnit(preferUnit),
      preferLabels,
    );
    if (score > bestScore) {
      best = candidate;
      bestScore = score;
    }
  }

  return best;
}

function resolveSeries(
  context: DetectorContext,
  explicit: string | string[] | undefined,
  aliases: string[],
  predicate: (series: SignalSeries) => boolean,
  preferUnit?: string,
  preferLabels = false,
): SignalSeries | undefined {
  const explicitNames =
    explicit === undefined
      ? []
      : Array.isArray(explicit)
        ? explicit
        : [explicit];

  for (const name of explicitNames) {
    const found = context.series.find((series) => matchesSignal(series, name));
    if (found) return found;
  }

  for (const alias of aliases) {
    const found = context.series.find((series) => matchesSignal(series, alias));
    if (found) return found;
  }

  return chooseSeries(
    context.series.filter(predicate),
    preferUnit,
    preferLabels,
  );
}

function resolveSpeedSeries(context: DetectorContext): SignalSeries | undefined {
  const explicit = context.config.signals?.speed;
  const explicitNames =
    explicit === undefined
      ? []
      : Array.isArray(explicit)
        ? explicit
        : [explicit];

  for (const name of explicitNames) {
    const found = context.series.find((series) => matchesSignal(series, name));
    if (found) return found;
  }

  for (const alias of SPEED_ALIASES) {
    const found = context.series.find((series) => matchesSignal(series, alias));
    if (found) return found;
  }

  const candidates = context.series.filter((series) =>
    /speed|velocity/i.test(series.signalName),
  );
  const nonWheel = candidates.filter(
    (series) =>
      !/wheel/i.test(series.signalName) && !/wheel/i.test(series.messageName),
  );
  return chooseSeries(nonWheel.length > 0 ? nonWheel : candidates, "km/h");
}

function resolveBrakePressureSeries(
  context: DetectorContext,
): SignalSeries | undefined {
  return resolveSeries(
    context,
    context.config.signals?.brakePressure,
    BRAKE_PRESSURE_ALIASES,
    (series) =>
      /brake/i.test(series.signalName) && /press/i.test(series.signalName),
  );
}

function resolveBrakeSwitchSeries(
  context: DetectorContext,
): SignalSeries | undefined {
  return resolveSeries(
    context,
    context.config.signals?.brakeSwitch,
    BRAKE_SWITCH_ALIASES,
    (series) =>
      /brake/i.test(series.signalName) &&
      /(pedal|switch|state|active|applied)/i.test(series.signalName),
  );
}

function resolveAbsSeries(context: DetectorContext): SignalSeries | undefined {
  return resolveSeries(
    context,
    context.config.signals?.abs,
    ABS_ALIASES,
    (series) => /abs/i.test(series.signalName),
  );
}

function resolveGearSeries(context: DetectorContext): SignalSeries | undefined {
  return resolveSeries(
    context,
    context.config.signals?.gear,
    GEAR_ALIASES,
    (series) => /gear/i.test(series.signalName),
    undefined,
    true,
  );
}

function pointsInRange(
  series: SignalSeries,
  start: number,
  end: number,
): SeriesPoint[] {
  return series.points.filter((point) => point.t >= start && point.t <= end);
}

function medianInterval(points: SeriesPoint[]): number {
  const intervals: number[] = [];
  for (let i = 1; i < points.length; i++) {
    intervals.push(points[i]!.t - points[i - 1]!.t);
  }
  return median(intervals);
}

function speedScaleToMps(unit: string): number | undefined {
  const normalized = normalizeUnit(unit);
  if (normalized === "km/h" || normalized === "kmh" || normalized === "kph") {
    return 1 / 3.6;
  }
  if (normalized === "m/s" || normalized === "mps") return 1;
  if (normalized === "mph") return 0.44704;
  return undefined;
}

function defaultBrakePressureThreshold(unit: string): number {
  const normalized = normalizeUnit(unit);
  if (normalized === "bar") return 5;
  if (normalized === "kpa") return 500;
  if (normalized === "psi") return 50;
  return 50;
}

function isActiveState(
  point: SeriesPoint,
  activeValues: Array<number | string>,
): boolean {
  if (point.label !== undefined) {
    const label = point.label.trim().toLowerCase();
    if (ACTIVE_LABELS.has(label)) return true;
    if (INACTIVE_LABELS.has(label)) return false;
    if (
      activeValues.some(
        (value) => typeof value === "string" && value.toLowerCase() === label,
      )
    ) {
      return true;
    }
  }

  return activeValues.some(
    (value) =>
      typeof value === "number" &&
      (point.raw === value || point.value === value),
  );
}

function detectRapidDeceleration(
  context: DetectorContext,
): DetectorOutcome {
  const series = resolveSpeedSeries(context);
  if (!series) {
    return {
      events: [],
      unsupported: {
        detector: "rapid_deceleration",
        reason:
          "No speed-like signal was found. Configure signals.speed to select one.",
      },
    };
  }

  const scale = speedScaleToMps(series.unit);
  if (scale === undefined) {
    return {
      events: [],
      unsupported: {
        detector: "rapid_deceleration",
        reason: `Speed signal "${series.signalName}" has unsupported unit "${series.unit}".`,
      },
    };
  }

  if (series.points.length < 2) return { events: [] };

  const config = context.config.deceleration;
  const minSpeedDropKmh = config?.minSpeedDropKmh ?? 10;
  const minSpeedDropMps = minSpeedDropKmh / 3.6;
  const minDeceleration = config?.minDecelerationMps2 ?? 3;
  const maxDuration = config?.maxDurationSec ?? 5;
  const mergeGap = config?.mergeGapSec ?? 0.25;
  const criticalDeceleration = config?.criticalDecelerationMps2 ?? 6;

  const points = series.points;
  const ranges: Array<{
    start: number;
    end: number;
    startValue: number;
    endValue: number;
  }> = [];

  let index = 0;
  while (index < points.length - 1) {
    const start = points[index]!;
    const startMps = start.value * scale;
    let bestEnd = -1;
    let bestDrop = 0;

    for (let next = index + 1; next < points.length; next++) {
      const end = points[next]!;
      const elapsed = end.t - start.t;
      if (elapsed <= 0) continue;
      if (elapsed > maxDuration) break;

      const dropMps = startMps - end.value * scale;
      if (dropMps < minSpeedDropMps) continue;
      if (dropMps / elapsed < minDeceleration) continue;
      if (dropMps > bestDrop) {
        bestDrop = dropMps;
        bestEnd = next;
      }
    }

    if (bestEnd === -1) {
      index++;
      continue;
    }

    const end = points[bestEnd]!;
    ranges.push({
      start: start.t,
      end: end.t,
      startValue: start.value,
      endValue: end.value,
    });
    index = bestEnd;
  }

  const merged: typeof ranges = [];
  for (const range of ranges) {
    const previous = merged[merged.length - 1];
    if (
      previous &&
      range.start - previous.end <= mergeGap &&
      range.startValue >= previous.endValue &&
      range.endValue <= previous.endValue
    ) {
      previous.end = range.end;
      previous.endValue = range.endValue;
    } else {
      merged.push({ ...range });
    }
  }

  const brakeSeries = resolveBrakePressureSeries(context);
  const absSeries = resolveAbsSeries(context);
  const brakeThreshold = brakeSeries
    ? (context.config.brake?.pressureThreshold ??
      defaultBrakePressureThreshold(brakeSeries.unit))
    : 0;
  const absActiveValues = context.config.abs?.activeValues ?? [1];

  const events = merged.map((range) => {
    const elapsed = range.end - range.start;
    const deceleration =
      ((range.startValue - range.endValue) * scale) / elapsed;

    const brakePoints = brakeSeries
      ? pointsInRange(brakeSeries, range.start, range.end)
      : [];
    const brakePeak = brakePoints.reduce<SeriesPoint | undefined>(
      (peak, point) => (peak === undefined || point.value > peak.value ? point : peak),
      undefined,
    );
    const brakeActive =
      brakePeak !== undefined && brakePeak.value >= brakeThreshold;

    const absPoints = absSeries
      ? pointsInRange(absSeries, range.start, range.end).filter((point) =>
          isActiveState(point, absActiveValues),
        )
      : [];
    const absFirst = absPoints[0];
    const absLast = absPoints[absPoints.length - 1];

    const evidence: EventEvidence[] = [
      {
        signalName: series.signalName,
        timestamp: range.start,
        value: range.startValue,
        unit: series.unit,
        description: "Speed at the start of the deceleration.",
        messageId: series.id,
      },
      {
        signalName: series.signalName,
        timestamp: range.end,
        value: range.endValue,
        unit: series.unit,
        description: "Speed at the end of the deceleration.",
        messageId: series.id,
      },
      {
        signalName: `${series.signalName} (derived)`,
        timestamp: range.end,
        value: deceleration,
        unit: "m/s²",
        description: "Average deceleration over the interval.",
        messageId: series.id,
      },
      {
        signalName: "elapsed time (derived)",
        timestamp: range.end,
        value: elapsed,
        unit: "s",
        description: "Elapsed time between the start and end speed samples.",
        messageId: series.id,
      },
    ];

    if (brakeActive && brakePeak && brakeSeries) {
      evidence.push({
        signalName: brakeSeries.signalName,
        timestamp: brakePeak.t,
        value: brakePeak.value,
        unit: brakeSeries.unit,
        description: "Peak brake pressure during the deceleration.",
        messageId: brakeSeries.id,
      });
    }

    if (absFirst && absSeries) {
      evidence.push({
        signalName: absSeries.signalName,
        timestamp: absFirst.t,
        value: absFirst.label ?? absFirst.raw,
        unit: absSeries.unit,
        description: "First active ABS sample during the deceleration.",
        messageId: absSeries.id,
      });
    }

    const title = brakeActive ? "Possible hard braking" : "Rapid deceleration";
    let summary = `Vehicle speed (${series.signalName}) decreased from ${formatValue(range.startValue)} ${series.unit} to ${formatValue(range.endValue)} ${series.unit} over ${formatValue(elapsed)} s, an average of about ${formatValue(deceleration)} m/s².`;

    if (brakeActive && brakePeak && brakeSeries) {
      summary += ` Brake pressure peaked at ${formatValue(brakePeak.value)} ${brakeSeries.unit} during the interval.`;
    }
    if (absFirst && absLast && absSeries) {
      summary += ` ABS was reported active from t=${formatValue(absFirst.t)} s to t=${formatValue(absLast.t)} s.`;
    }

    if (brakeActive || absFirst) {
      summary +=
        " These observations are consistent with a significant braking event, but they do not by themselves prove the cause.";
    } else {
      summary +=
        " The available signals do not identify why the speed decreased.";
    }

    const limitations = [
      `Speed is taken from ${series.messageName}.${series.signalName}; other speed sources in the same vehicle may differ.`,
      "Deceleration is derived from sampled values and is sensitive to signal resolution, DBC scaling, and timestamp jitter.",
    ];
    if (!brakeActive) {
      limitations.push(
        "No corroborating brake-pressure observation was found in this interval.",
      );
    }
    limitations.push(
      "Correlation between speed, brake, and ABS signals does not establish driver intent or road conditions.",
    );

    const confidence = Math.min(
      0.95,
      0.55 + (brakeActive ? 0.25 : 0) + (absFirst ? 0.1 : 0),
    );

    return {
      id: context.nextId("rapid_deceleration"),
      type: "rapid_deceleration" as const,
      severity:
        deceleration >= criticalDeceleration
          ? ("critical" as const)
          : ("warning" as const),
      startTime: range.start,
      endTime: range.end,
      title,
      summary,
      detectionRule: `Flagged when ${series.signalName} falls by at least ${formatValue(minSpeedDropKmh)} km/h at an average of at least ${formatValue(minDeceleration)} m/s² within ${formatValue(maxDuration)} s.`,
      confidence: Math.round(confidence * 100) / 100,
      evidence,
      limitations,
    };
  });

  return { events };
}

function detectBrakeActivity(context: DetectorContext): DetectorOutcome {
  const pressureSeries = resolveBrakePressureSeries(context);
  const switchSeries = pressureSeries
    ? undefined
    : resolveBrakeSwitchSeries(context);
  const series = pressureSeries ?? switchSeries;

  if (!series) {
    return {
      events: [],
      unsupported: {
        detector: "brake_activity",
        reason:
          "No brake-pressure, pedal, or switch signal was found. Configure signals.brakePressure or signals.brakeSwitch.",
      },
    };
  }

  const minDuration = context.config.brake?.minDurationSec ?? 0.2;
  const threshold = pressureSeries
    ? (context.config.brake?.pressureThreshold ??
      defaultBrakePressureThreshold(pressureSeries.unit))
    : 0;
  const activeValues = context.config.brake?.switchActiveValues ?? [1];
  const isActive = pressureSeries
    ? (point: SeriesPoint): boolean => point.value >= threshold
    : (point: SeriesPoint): boolean => isActiveState(point, activeValues);
  const maxGap = Math.max(0.25, medianInterval(series.points) * 4);

  const runs: SeriesPoint[][] = [];
  for (const point of series.points) {
    if (!isActive(point)) continue;
    const current = runs[runs.length - 1];
    const previous = current?.[current.length - 1];
    if (current && previous && point.t - previous.t <= maxGap) {
      current.push(point);
    } else {
      runs.push([point]);
    }
  }

  const events: VehicleEvent[] = [];
  for (const run of runs) {
    const first = run[0]!;
    const last = run[run.length - 1]!;
    const duration = last.t - first.t;
    if (duration < minDuration) continue;

    const peak = run.reduce((best, point) =>
      point.value > best.value ? point : best,
    );

    const evidence: EventEvidence[] = [
      {
        signalName: series.signalName,
        timestamp: first.t,
        value: first.value,
        unit: series.unit,
        description: "First sample in the elevated interval.",
        messageId: series.id,
      },
      {
        signalName: series.signalName,
        timestamp: peak.t,
        value: peak.value,
        unit: series.unit,
        description: "Peak value in the elevated interval.",
        messageId: series.id,
      },
      {
        signalName: series.signalName,
        timestamp: last.t,
        value: last.value,
        unit: series.unit,
        description: "Last sample in the elevated interval.",
        messageId: series.id,
      },
    ];

    const summary = pressureSeries
      ? `Brake pressure (${series.signalName}) was at or above ${formatValue(threshold)} ${series.unit} from t=${formatValue(first.t)} s to t=${formatValue(last.t)} s, peaking at ${formatValue(peak.value)} ${series.unit}.`
      : `Brake signal (${series.signalName}) was reported active from t=${formatValue(first.t)} s to t=${formatValue(last.t)} s.`;

    events.push({
      id: context.nextId("brake_activity"),
      type: "brake_activity",
      severity: "warning",
      startTime: first.t,
      endTime: last.t,
      title: pressureSeries
        ? "Elevated brake pressure"
        : "Brake switch activity",
      summary,
      detectionRule: pressureSeries
        ? `Flagged when ${series.signalName} stays at or above ${formatValue(threshold)} ${series.unit} for at least ${formatValue(minDuration)} s.`
        : `Flagged when ${series.signalName} stays in a configured active state for at least ${formatValue(minDuration)} s.`,
      confidence: 0.9,
      evidence,
      limitations: [
        "Brake pressure and switch state describe the signal that was decoded; they do not establish driver intent.",
        `The threshold was ${pressureSeries ? `${formatValue(threshold)} ${series.unit}` : "configured active values"} and can be adjusted in the detector configuration.`,
        "Sampling gaps can make the exact start or release time uncertain.",
      ],
    });
  }

  return { events };
}

function detectAbsActivation(context: DetectorContext): DetectorOutcome {
  const series = resolveAbsSeries(context);
  if (!series) {
    return {
      events: [],
      unsupported: {
        detector: "abs_activation",
        reason:
          "No ABS-like signal was found. Configure signals.abs to select one.",
      },
    };
  }

  const activeValues = context.config.abs?.activeValues ?? [1];
  const maxGapFactor = context.config.abs?.maxGapFactor ?? 3;
  const maxGap = Math.max(0.5, medianInterval(series.points) * maxGapFactor);

  const runs: Array<{
    start: SeriesPoint;
    end: SeriesPoint;
    endObserved: boolean;
  }> = [];
  let start: SeriesPoint | undefined;
  let lastActive: SeriesPoint | undefined;

  for (const point of series.points) {
    const active = isActiveState(point, activeValues);
    if (active) {
      if (start && lastActive && point.t - lastActive.t > maxGap) {
        runs.push({ start, end: lastActive, endObserved: false });
        start = point;
      } else if (!start) {
        start = point;
      }
      lastActive = point;
    } else if (start && lastActive) {
      const gap = point.t - lastActive.t > maxGap;
      runs.push({
        start,
        end: gap ? lastActive : point,
        endObserved: !gap,
      });
      start = undefined;
      lastActive = undefined;
    }
  }

  if (start && lastActive) {
    runs.push({ start, end: lastActive, endObserved: false });
  }

  const events = runs.map((run) => {
    const duration = run.end.t - run.start.t;
    const evidence: EventEvidence[] = [
      {
        signalName: series.signalName,
        timestamp: run.start.t,
        value: run.start.label ?? run.start.raw,
        unit: series.unit,
        description: "First sample with ABS reported active.",
        messageId: series.id,
      },
      {
        signalName: series.signalName,
        timestamp: run.end.t,
        value: run.end.label ?? run.end.raw,
        unit: series.unit,
        description: run.endObserved
          ? "First sample after ABS returned inactive."
          : "Last sample with ABS reported active.",
        messageId: series.id,
      },
      {
        signalName: "ABS activation duration (derived)",
        timestamp: run.end.t,
        value: duration,
        unit: "s",
        description: "Reported ABS-active duration.",
        messageId: series.id,
      },
    ];

    let summary = `ABS (${series.signalName}) was reported active from t=${formatValue(run.start.t)} s to t=${formatValue(run.end.t)} s, a reported duration of ${formatValue(duration)} s.`;
    if (!run.endObserved) {
      summary +=
        " Deactivation was not observed; the end is the last active sample, so the true duration may be longer.";
    }

    const limitations = [
      "ABS activation is a reported signal state; it does not measure wheel slip directly.",
      "Sampling gaps can hide short activation or deactivation transitions.",
    ];
    if (!run.endObserved) {
      limitations.push(
        "The end of this activation was not observed in the log.",
      );
    }

    return {
      id: context.nextId("abs_activation"),
      type: "abs_activation" as const,
      severity: "warning" as const,
      startTime: run.start.t,
      endTime: run.end.t,
      title: "ABS activation",
      summary,
      detectionRule: `Flagged on a change into an ABS-active value (${activeValues.map((value) => String(value)).join(", ")}) or label, with gaps above ${formatValue(maxGap)} s treated as missing samples.`,
      confidence: 0.9,
      evidence,
      limitations,
    };
  });

  return { events };
}

function detectGearChanges(context: DetectorContext): DetectorOutcome {
  const series = resolveGearSeries(context);
  if (!series) {
    return {
      events: [],
      unsupported: {
        detector: "gear_change",
        reason:
          "No gear-like signal was found. Configure signals.gear to select one.",
      },
    };
  }

  const minInterval = context.config.gear?.minChangeIntervalSec ?? 0;
  const events: VehicleEvent[] = [];
  let lastChangeTime = -Infinity;

  for (let i = 1; i < series.points.length; i++) {
    const previous = series.points[i - 1]!;
    const current = series.points[i]!;
    const previousState = previous.label ?? String(previous.raw);
    const currentState = current.label ?? String(current.raw);
    if (previousState === currentState) continue;
    if (current.t - lastChangeTime < minInterval) continue;

    lastChangeTime = current.t;
    const previousDisplay =
      previous.label === undefined
        ? previousState
        : `${previous.label} (raw ${previous.raw})`;
    const currentDisplay =
      current.label === undefined
        ? currentState
        : `${current.label} (raw ${current.raw})`;

    events.push({
      id: context.nextId("gear_change"),
      type: "gear_change",
      severity: "info",
      startTime: current.t,
      endTime: current.t,
      title: "Gear change",
      summary: `Gear changed from ${previousDisplay} to ${currentDisplay} at t=${formatValue(current.t)} s.`,
      detectionRule: `Flagged when ${series.messageName}.${series.signalName} changes state, with at least ${formatValue(minInterval)} s between reported changes.`,
      confidence: 0.9,
      evidence: [
        {
          signalName: series.signalName,
          timestamp: previous.t,
          value: previous.label ?? previous.raw,
          unit: series.unit,
          description: "Previous gear state.",
          messageId: series.id,
        },
        {
          signalName: series.signalName,
          timestamp: current.t,
          value: current.label ?? current.raw,
          unit: series.unit,
          description: "New gear state.",
          messageId: series.id,
        },
      ],
      limitations: [
        "Gear labels come from the DBC value table when available; otherwise the raw decoded value is used.",
        "A signal change indicates what was reported, not necessarily a completed mechanical shift.",
      ],
    });
  }

  return { events };
}

function expectedIntervalFor(
  expected: Record<string, number> | undefined,
  id: number,
  messageName: string,
): number | undefined {
  if (!expected) return undefined;

  const hex = hexId(id);
  for (const [key, value] of Object.entries(expected)) {
    if (
      key === String(id) ||
      key.toLowerCase() === messageName.toLowerCase() ||
      key.toUpperCase() === hex.toUpperCase()
    ) {
      return value;
    }
  }
  return undefined;
}

function detectSignalDropout(context: DetectorContext): DetectorOutcome {
  const byMessage = new Map<
    number,
    { messageName: string; times: number[] }
  >();

  for (const sample of context.log.samples) {
    let entry = byMessage.get(sample.id);
    if (!entry) {
      entry = { messageName: sample.messageName, times: [] };
      byMessage.set(sample.id, entry);
    }
    entry.times.push(sample.t);
  }

  if (byMessage.size === 0) {
    return {
      events: [],
      unsupported: {
        detector: "signal_dropout",
        reason: "No decoded messages were available to establish timing.",
      },
    };
  }

  const config = context.config.dropout;
  const gapFactor = config?.gapFactor ?? 3;
  const minGap = config?.minGapSec ?? 0.5;
  const minBaselineSamples = config?.minBaselineSamples ?? 5;
  const events: VehicleEvent[] = [];

  for (const [id, entry] of byMessage) {
    const times = [...entry.times].sort((a, b) => a - b);
    if (times.length < 2) continue;

    const intervals: number[] = [];
    for (let i = 1; i < times.length; i++) {
      intervals.push(times[i]! - times[i - 1]!);
    }

    const configured = expectedIntervalFor(
      config?.expectedIntervalsSec,
      id,
      entry.messageName,
    );
    if (configured === undefined && times.length < minBaselineSamples) {
      continue;
    }

    const expected = configured ?? median(intervals);
    if (!Number.isFinite(expected) || expected <= 0) continue;

    const gapThreshold = Math.max(minGap, expected * gapFactor);

    for (let i = 1; i < times.length; i++) {
      const previous = times[i - 1]!;
      const next = times[i]!;
      const gap = next - previous;
      if (gap <= gapThreshold) continue;

      const source =
        configured === undefined
          ? "inferred from the observed median interval"
          : "configured";
      const title = "Possible telemetry dropout";
      const summary = `No ${entry.messageName} (ID ${hexId(id)}) frames were observed for ${formatValue(gap)} s between t=${formatValue(previous)} s and t=${formatValue(next)} s. The expected interval was ${formatValue(expected)} s (${source}); the gap threshold was ${formatValue(gapThreshold)} s. This is consistent with missing telemetry, but it may also reflect an event-driven message or a logging gap.`;

      events.push({
        id: context.nextId("signal_dropout"),
        type: "signal_dropout",
        severity: "warning",
        startTime: previous,
        endTime: next,
        title,
        summary,
        detectionRule: `Flagged when the gap exceeds max(${formatValue(minGap)} s, ${formatValue(gapFactor)} × the expected ${formatValue(expected)} s interval); baseline source: ${source}.`,
        confidence: configured === undefined ? 0.65 : 0.85,
        evidence: [
          {
            signalName: entry.messageName,
            timestamp: previous,
            value: gap,
            unit: "s",
            description: `No frames arrived for ${formatValue(gap)} s after this sample; the next frame was at t=${formatValue(next)} s.`,
            messageId: id,
          },
        ],
        limitations: [
          configured === undefined
            ? "The baseline interval is inferred from this log, not from a declared transmit rate; event-driven messages can be quiet without a fault."
            : "The expected interval is configured by the caller and may not match the vehicle's actual transmit behavior.",
          "A gap can also be caused by logging, transport, or filtering rather than a sensor failure.",
        ],
      });
    }
  }

  return { events };
}

function detectTrafficBursts(context: DetectorContext): DetectorOutcome {
  const frames = context.log.frames;
  if (frames.length === 0) {
    return {
      events: [],
      unsupported: {
        detector: "traffic_burst",
        reason: "No raw frames were available for traffic analysis.",
      },
    };
  }

  const windowSec = context.config.traffic?.windowSec ?? 1;
  const minBaselineWindows = context.config.traffic?.minBaselineWindows ?? 5;
  const rateRatio = context.config.traffic?.rateRatioThreshold ?? 3;
  const minFramesPerWindow = context.config.traffic?.minFramesPerWindow ?? 10;
  const bucketCount = Math.max(
    1,
    Math.ceil(context.log.durationSec / windowSec),
  );

  if (bucketCount < minBaselineWindows) return { events: [] };

  const groups = new Map<
    string,
    { id: number; channel: string; counts: number[] }
  >();

  for (const frame of frames) {
    const key = `${frame.channel}\u0000${frame.id}`;
    let group = groups.get(key);
    if (!group) {
      group = {
        id: frame.id,
        channel: frame.channel,
        counts: new Array<number>(bucketCount).fill(0),
      };
      groups.set(key, group);
    }

    const relative = frame.timestamp - context.log.startTimestamp;
    const bucket = Math.min(
      bucketCount - 1,
      Math.max(0, Math.floor(relative / windowSec)),
    );
    group.counts[bucket] = (group.counts[bucket] ?? 0) + 1;
  }

  const events: VehicleEvent[] = [];

  for (const group of groups.values()) {
    const baselineCount = median(group.counts);
    const threshold = Math.max(
      minFramesPerWindow,
      Math.ceil(baselineCount * rateRatio),
    );

    let bucket = 0;
    while (bucket < group.counts.length) {
      if ((group.counts[bucket] ?? 0) < threshold) {
        bucket++;
        continue;
      }

      let endBucket = bucket;
      let frameCount = group.counts[bucket] ?? 0;
      while (
        endBucket + 1 < group.counts.length &&
        (group.counts[endBucket + 1] ?? 0) >= threshold
      ) {
        endBucket++;
        frameCount += group.counts[endBucket] ?? 0;
      }

      const startTime = bucket * windowSec;
      const endTime = (endBucket + 1) * windowSec;
      const span = endTime - startTime;
      const observedFrequency = frameCount / span;
      const baselineFrequency = baselineCount / windowSec;

      events.push({
        id: context.nextId("traffic_burst"),
        type: "traffic_burst",
        severity: "info",
        startTime,
        endTime,
        title: "Unusual CAN traffic burst",
        summary: `Message ${hexId(group.id)} on ${group.channel} sent ${frameCount} frames in ${formatValue(span)} s (about ${formatValue(observedFrequency)} Hz) against an observed baseline of about ${formatValue(baselineFrequency)} Hz. The detection threshold was ${rateRatio}× baseline and at least ${minFramesPerWindow} frames per ${formatValue(windowSec)} s window. This may reflect a burst of activity, retransmissions, or a logging artifact; it does not indicate malicious behavior.`,
        detectionRule: `Flagged when a ${formatValue(windowSec)} s window contains at least max(${minFramesPerWindow}, ceil(${rateRatio} × baseline)) frames, over at least ${formatValue(minBaselineWindows)} windows.`,
        confidence: 0.7,
        evidence: [
          {
            signalName: "CAN traffic",
            timestamp: startTime,
            value: observedFrequency,
            unit: "Hz",
            description: `Observed frame rate for ID ${hexId(group.id)} on ${group.channel}.`,
            messageId: group.id,
            channel: group.channel,
          },
          {
            signalName: "CAN traffic",
            timestamp: startTime,
            value: baselineFrequency,
            unit: "Hz",
            description: "Baseline frame rate inferred from the median window count.",
            messageId: group.id,
            channel: group.channel,
          },
        ],
        limitations: [
          "The baseline is inferred from this log and may not represent normal vehicle behavior.",
          "Retransmissions, diagnostic traffic, logging artifacts, and legitimate event bursts can all produce high frame rates.",
          "A frequency burst alone does not indicate malicious or faulty activity.",
        ],
      });

      bucket = endBucket + 1;
    }
  }

  return { events };
}

const DETECTORS: DetectorDefinition[] = [
  { name: "rapid_deceleration", detect: detectRapidDeceleration },
  { name: "brake_activity", detect: detectBrakeActivity },
  { name: "abs_activation", detect: detectAbsActivation },
  { name: "gear_change", detect: detectGearChanges },
  { name: "signal_dropout", detect: detectSignalDropout },
  { name: "traffic_burst", detect: detectTrafficBursts },
];

export function detectEvents(
  log: DecodedLog,
  config: DetectorConfig = {},
): EventDetectionResult {
  const counters = new Map<DetectorName, number>();
  const context: DetectorContext = {
    log,
    series: buildSignalSeries(log),
    config,
    nextId(type: DetectorName): string {
      const next = (counters.get(type) ?? 0) + 1;
      counters.set(type, next);
      return `${type}-${next}`;
    },
  };

  const events: VehicleEvent[] = [];
  const unsupported: UnsupportedDetector[] = [];
  const warnings: string[] = [];

  for (const detector of DETECTORS) {
    if (config.enabled?.[detector.name] === false) continue;

    try {
      const outcome = detector.detect(context);
      events.push(...outcome.events);
      if (outcome.unsupported) unsupported.push(outcome.unsupported);
    } catch (error) {
      warnings.push(
        `Detector "${detector.name}" failed: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  events.sort(
    (a, b) =>
      a.startTime - b.startTime ||
      a.endTime - b.endTime ||
      a.id.localeCompare(b.id),
  );

  return { events, unsupported, warnings };
}