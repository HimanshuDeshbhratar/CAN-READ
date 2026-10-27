import type { DetectorName, EventSeverity, VehicleEvent } from "./events.js";

export interface TimelineEntry {
  id: string;
  theme: TimelineTheme;
  title: string;
  startTime: number;
  endTime: number;
  severity: EventSeverity;
  observedFacts: string[];
  interpretations: string[];
  eventIds: string[];
  events: VehicleEvent[];
  confidence?: number;
  limitations: string[];
  summary: string;
}

export type TimelineTheme = "braking" | "drivetrain" | "telemetry" | "traffic";

export interface TimelineConfig {
  /** Maximum gap, in seconds, between related events that may share an episode. */
  windowSec?: number;
  /** Maximum number of observed-fact lines kept per entry. */
  maxFactsPerEntry?: number;
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

const THEMES: Record<DetectorName, TimelineTheme> = {
  rapid_deceleration: "braking",
  brake_activity: "braking",
  abs_activation: "braking",
  gear_change: "drivetrain",
  signal_dropout: "telemetry",
  traffic_burst: "traffic",
};

const THEME_TITLES: Record<TimelineTheme, string> = {
  braking: "Braking episode",
  drivetrain: "Gear change",
  telemetry: "Telemetry gap",
  traffic: "Traffic burst",
};

const SEVERITY_RANK: Record<EventSeverity, number> = {
  info: 0,
  warning: 1,
  critical: 2,
};

function formatTime(value: number): string {
  return Number.isInteger(value) ? `${value}` : value.toFixed(2).replace(/0+$/, "").replace(/\.$/, "");
}

function formatValue(value: number | string): string {
  if (typeof value === "string") return value;
  if (!Number.isFinite(value)) return String(value);
  return String(Math.round(value * 100) / 100);
}

function entryId(theme: TimelineTheme, index: number): string {
  return `${theme}-episode-${index}`;
}

interface EpisodeBucket {
  theme: TimelineTheme;
  events: VehicleEvent[];
  startTime: number;
  endTime: number;
}

function groupByTheme(events: VehicleEvent[], windowSec: number): EpisodeBucket[] {
  const byTheme = new Map<TimelineTheme, VehicleEvent[]>();

  for (const event of events) {
    const theme = THEMES[event.type];
    const list = byTheme.get(theme);
    if (list) list.push(event);
    else byTheme.set(theme, [event]);
  }

  const buckets: EpisodeBucket[] = [];

  for (const [theme, themeEvents] of byTheme) {
    const sorted = [...themeEvents].sort(
      (a, b) => a.startTime - b.startTime || a.endTime - b.endTime,
    );

    if (theme !== "braking") {
      for (const event of sorted) {
        buckets.push({
          theme,
          events: [event],
          startTime: event.startTime,
          endTime: event.endTime,
        });
      }
      continue;
    }

    let current: EpisodeBucket | undefined;
    for (const event of sorted) {
      if (
        current === undefined ||
        event.startTime - current.endTime > windowSec
      ) {
        if (current) buckets.push(current);
        current = {
          theme,
          events: [event],
          startTime: event.startTime,
          endTime: event.endTime,
        };
      } else {
        current.events.push(event);
        current.startTime = Math.min(current.startTime, event.startTime);
        current.endTime = Math.max(current.endTime, event.endTime);
      }
    }
    if (current) buckets.push(current);
  }

  return buckets.sort(
    (a, b) =>
      a.startTime - b.startTime ||
      a.endTime - b.endTime ||
      a.theme.localeCompare(b.theme),
  );
}

function buildFacts(events: VehicleEvent[], limit: number): string[] {
  const facts: string[] = [];

  for (const event of events) {
    for (const evidence of event.evidence) {
      const unit = evidence.unit ? ` ${evidence.unit}` : "";
      facts.push(
        `${evidence.signalName} was ${formatValue(evidence.value)}${unit} at t=${formatTime(evidence.timestamp)} s: ${evidence.description}`,
      );
      if (facts.length >= limit) return facts;
    }
  }

  return facts;
}

function buildEntry(bucket: EpisodeBucket, index: number, maxFacts: number): TimelineEntry {
  const severity = bucket.events.reduce<EventSeverity>(
    (highest, event) =>
      SEVERITY_RANK[event.severity] > SEVERITY_RANK[highest]
        ? event.severity
        : highest,
    "info",
  );

  const observedFacts = buildFacts(bucket.events, maxFacts);
  const interpretations = bucket.events.map(
    (event) => `${event.title} (${event.type}).`,
  );

  const limitations = [
    ...new Set(bucket.events.flatMap((event) => event.limitations)),
  ];

  const confidence = bucket.events.reduce(
    (best, event) => Math.max(best, event.confidence ?? 0),
    0,
  );

  const eventTitles = bucket.events.map((event) => event.title);
  const rangeText =
    bucket.startTime === bucket.endTime
      ? `at t=${formatTime(bucket.startTime)} s`
      : `from t=${formatTime(bucket.startTime)} s to ${formatTime(bucket.endTime)} s`;
  const summary =
    bucket.events.length === 1
      ? `Detected ${rangeText}.`
      : `${bucket.events.length} related detections ${rangeText}: ${eventTitles.join("; ")}.`;

  return {
    id: entryId(bucket.theme, index),
    theme: bucket.theme,
    title: THEME_TITLES[bucket.theme],
    startTime: bucket.startTime,
    endTime: bucket.endTime,
    severity,
    observedFacts,
    interpretations,
    eventIds: bucket.events.map((event) => event.id),
    events: bucket.events,
    ...(confidence > 0
      ? { confidence: Math.round(confidence * 100) / 100 }
      : {}),
    limitations,
    summary,
  };
}

export function buildTimeline(
  events: VehicleEvent[],
  config: TimelineConfig = {},
): Timeline {
  const windowSec = config.windowSec ?? 2;
  const maxFactsPerEntry = config.maxFactsPerEntry ?? 12;

  const uniqueEvents: VehicleEvent[] = [];
  const seenIds = new Set<string>();
  for (const event of events) {
    if (seenIds.has(event.id)) continue;
    seenIds.add(event.id);
    uniqueEvents.push(event);
  }

  const buckets = groupByTheme(uniqueEvents, windowSec);
  const entries = buckets.map((bucket, index) =>
    buildEntry(bucket, index + 1, maxFactsPerEntry),
  );

  const starts = entries.map((entry) => entry.startTime);
  const ends = entries.map((entry) => entry.endTime);
  const startTime = starts.length > 0 ? Math.min(...starts) : 0;
  const endTime = ends.length > 0 ? Math.max(...ends) : 0;

  const summary =
    entries.length === 0
      ? "No events were detected in this log."
      : `Timeline covers t=${formatTime(startTime)} s to t=${formatTime(endTime)} s with ${entries.length} ${entries.length === 1 ? "episode" : "episodes"}: ${entries
          .map(
            (entry) =>
              `${entry.title} (${formatTime(entry.startTime)}-${formatTime(entry.endTime)} s)`,
          )
          .join("; ")}.`;

  return {
    startTime,
    endTime,
    durationSec: endTime - startTime,
    entries,
    summary,
    statistics: {
      totalEvents: uniqueEvents.length,
      groupedEvents: entries.reduce(
        (total, entry) => total + entry.events.length,
        0,
      ),
      episodeCount: entries.length,
    },
  };
}