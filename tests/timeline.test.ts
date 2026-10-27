import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { parseCandump } from "../src/core/candump.js";
import { parseDbc } from "../src/core/dbc.js";
import { decodeLog } from "../src/core/decodeLog.js";
import { detectEvents, type VehicleEvent } from "../src/core/events.js";
import { buildTimeline } from "../src/core/timeline.js";

const dbc = parseDbc(
  readFileSync(new URL("../samples/vehicle.dbc", import.meta.url), "utf8"),
);
const log = decodeLog(
  dbc,
  parseCandump(
    readFileSync(new URL("../samples/drive_demo.log", import.meta.url), "utf8"),
  ).frames,
);
const events = detectEvents(log).events;
const timeline = buildTimeline(events);

function entryOfTheme(theme: string) {
  return timeline.entries.find((entry) => entry.theme === theme);
}

function event(
  id: string,
  type: VehicleEvent["type"],
  startTime: number,
  endTime: number,
): VehicleEvent {
  return {
    id,
    type,
    severity: "warning",
    startTime,
    endTime,
    title: `Event ${id}`,
    summary: `Summary for ${id}.`,
    evidence: [
      {
        signalName: "Speed_kmh",
        timestamp: startTime,
        value: 50,
        unit: "km/h",
        description: "Speed at the start of the interval.",
      },
    ],
    limitations: ["Limitation for " + id],
  };
}

describe("buildTimeline on the demo drive", () => {
  it("groups the braking detections into one episode", () => {
    const entry = entryOfTheme("braking");
    expect(entry).toBeDefined();
    expect(entry!.eventIds).toEqual([
      "rapid_deceleration-1",
      "brake_activity-1",
      "abs_activation-1",
    ]);
    expect(entry!.startTime).toBeGreaterThan(39);
    expect(entry!.startTime).toBeLessThan(41);
    expect(entry!.endTime).toBeGreaterThan(42.5);
    expect(entry!.endTime).toBeLessThan(43.5);
    expect(entry!.title).toBe("Braking episode");
  });

  it("preserves the original events and their evidence", () => {
    const entry = entryOfTheme("braking")!;
    expect(entry.events).toHaveLength(3);
    expect(entry.events[0]!.evidence.length).toBeGreaterThan(0);

    const original = events.find(
      (candidate) => candidate.id === "rapid_deceleration-1",
    )!;
    const preserved = entry.events.find(
      (candidate) => candidate.id === "rapid_deceleration-1",
    )!;
    expect(preserved.evidence).toEqual(original.evidence);
    expect(preserved.limitations).toEqual(original.limitations);
  });

  it("separates unrelated themes that occur close in time", () => {
    const entry = entryOfTheme("braking")!;
    const gear = entryOfTheme("drivetrain")!;
    const telemetry = entryOfTheme("telemetry")!;

    expect(gear).toBeDefined();
    expect(telemetry).toBeDefined();
    expect(gear!.eventIds).not.toContain("rapid_deceleration-1");
    expect(telemetry!.eventIds).not.toContain("brake_activity-1");
    expect(entry.events.every((item) => item.type !== "gear_change")).toBe(true);
  });

  it("distinguishes observed facts from interpretations", () => {
    const entry = entryOfTheme("braking")!;

    expect(entry.observedFacts.length).toBeGreaterThan(0);
    expect(entry.interpretations.length).toBe(3);
    expect(entry.observedFacts[0]).toMatch(/was .* at t=/);
    expect(entry.interpretations[0]).toContain("Possible hard braking");
    expect(entry.observedFacts.join(" ")).not.toContain("consistent with");
  });

  it("produces a deterministic summary", () => {
    expect(timeline.summary).toContain("episodes");
    expect(timeline.summary).toContain("Braking episode");
    expect(entryOfTheme("braking")!.summary).toContain("3 related detections");
    expect(entryOfTheme("drivetrain")!.summary).toBe("Detected at t=10 s.");
    expect(buildTimeline(events).summary).toBe(timeline.summary);
    expect(timeline.statistics.totalEvents).toBe(events.length);
    expect(timeline.statistics.groupedEvents).toBe(events.length);
  });

  it("covers the timeline range and keeps entries chronological", () => {
    expect(timeline.startTime).toBeGreaterThan(9);
    expect(timeline.endTime).toBeGreaterThan(52);
    expect(timeline.durationSec).toBeCloseTo(
      timeline.endTime - timeline.startTime,
      10,
    );

    for (let i = 1; i < timeline.entries.length; i++) {
      expect(timeline.entries[i]!.startTime).toBeGreaterThanOrEqual(
        timeline.entries[i - 1]!.startTime,
      );
    }
  });
});

describe("buildTimeline grouping rules", () => {
  it("does not merge unrelated events that are outside the temporal window", () => {
    const far = buildTimeline(
      [
        event("rapid_deceleration-1", "rapid_deceleration", 0, 1),
        event("brake_activity-1", "brake_activity", 30, 31),
      ],
      { windowSec: 2 },
    );

    expect(far.entries).toHaveLength(2);
    expect(far.entries[0]!.eventIds).toEqual(["rapid_deceleration-1"]);
    expect(far.entries[1]!.eventIds).toEqual(["brake_activity-1"]);
  });

  it("deduplicates repeated event ids", () => {
    const duplicate = event(
      "rapid_deceleration-1",
      "rapid_deceleration",
      0,
      1,
    );
    const deduplicated = buildTimeline([duplicate, duplicate]);

    expect(deduplicated.entries).toHaveLength(1);
    expect(deduplicated.entries[0]!.events).toHaveLength(1);
    expect(deduplicated.statistics.totalEvents).toBe(1);
  });

  it("keeps same-theme non-braking events separate", () => {
    const separate = buildTimeline(
      [
        event("signal_dropout-1", "signal_dropout", 0, 1),
        event("signal_dropout-2", "signal_dropout", 2, 3),
      ],
      { windowSec: 5 },
    );

    expect(separate.entries).toHaveLength(2);
    expect(separate.entries[0]!.eventIds).toEqual(["signal_dropout-1"]);
    expect(separate.entries[1]!.eventIds).toEqual(["signal_dropout-2"]);
  });

  it("merges overlapping and closely spaced related events", () => {
    const merged = buildTimeline(
      [
        event("rapid_deceleration-1", "rapid_deceleration", 0, 3),
        event("brake_activity-1", "brake_activity", 1, 4),
        event("abs_activation-1", "abs_activation", 2, 3.5),
      ],
      { windowSec: 2 },
    );

    expect(merged.entries).toHaveLength(1);
    expect(merged.entries[0]!.events).toHaveLength(3);
    expect(merged.entries[0]!.startTime).toBe(0);
    expect(merged.entries[0]!.endTime).toBe(4);
  });

  it("respects a larger correlation window", () => {
    const eventsWithGap = [
      event("rapid_deceleration-1", "rapid_deceleration", 0, 1),
      event("brake_activity-1", "brake_activity", 10, 11),
    ];

    expect(
      buildTimeline(eventsWithGap, { windowSec: 2 }).entries,
    ).toHaveLength(2);
    expect(
      buildTimeline(eventsWithGap, { windowSec: 20 }).entries,
    ).toHaveLength(1);
  });

  it("returns an empty timeline for no events", () => {
    const empty = buildTimeline([]);
    expect(empty.entries).toEqual([]);
    expect(empty.summary).toBe("No events were detected in this log.");
    expect(empty.durationSec).toBe(0);
  });

  it("caps the number of observed facts per entry", () => {
    const capped = buildTimeline(events, { maxFactsPerEntry: 2 });
    for (const entry of capped.entries) {
      expect(entry.observedFacts.length).toBeLessThanOrEqual(2);
    }
  });
});