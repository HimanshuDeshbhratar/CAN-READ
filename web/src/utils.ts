import type { Severity } from "./types";

export function formatNumber(value: number): string {
  return new Intl.NumberFormat("en-US").format(value);
}

export function formatTime(value: number): string {
  return `${value.toFixed(2)} s`;
}

export function formatRange(start: number, end: number): string {
  return `${formatTime(start)} – ${formatTime(end)}`;
}

export function formatDuration(seconds: number): string {
  if (seconds < 60) return `${seconds.toFixed(2)} s`;
  const minutes = Math.floor(seconds / 60);
  const rest = seconds - minutes * 60;
  return `${minutes} min ${rest.toFixed(1)} s`;
}

export function severityRank(severity: Severity): number {
  if (severity === "critical") return 3;
  if (severity === "warning") return 2;
  return 1;
}

export function confidenceLabel(confidence: number | undefined): string | null {
  if (confidence === undefined || confidence <= 0) return null;
  return `${Math.round(confidence * 100)}%`;
}

export function eventTypeLabel(type: string): string {
  switch (type) {
    case "rapid_deceleration":
      return "Rapid deceleration";
    case "brake_activity":
      return "Brake activity";
    case "abs_activation":
      return "ABS activation";
    case "gear_change":
      return "Gear change";
    case "signal_dropout":
      return "Telemetry gap";
    case "traffic_burst":
      return "Traffic burst";
    default:
      return type.replace(/_/g, " ");
  }
}

export function defaultDetectionRule(type: string): string {
  switch (type) {
    case "rapid_deceleration":
      return "Flags a speed drop of at least 10 km/h at an average of at least 3 m/s² within 5 s.";
    case "brake_activity":
      return "Flags brake pressure above the unit-aware threshold for at least 0.2 s, or an active brake switch.";
    case "abs_activation":
      return "Flags a transition into a configured ABS-active value or label.";
    case "gear_change":
      return "Flags a state change in a gear-named signal, using DBC labels when available.";
    case "signal_dropout":
      return "Flags a gap beyond 3× the observed or configured message interval, with a 0.5 s floor.";
    case "traffic_burst":
      return "Flags a 1 s window with at least 10 frames and at least 3× the observed baseline.";
    default:
      return "Rule metadata is not available for this event type.";
  }
}

export function formatEvidenceValue(value: number | string): string {
  if (typeof value === "string") return value;
  if (Number.isInteger(value)) return String(value);
  return String(Math.round(value * 100) / 100);
}

export function seriesKey(series: {
  messageId: number;
  signalName: string;
}): string {
  return `${series.messageId}:${series.signalName}`;
}
