import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import type { CanFrame } from "../src/core/candump.js";
import { parseCandump } from "../src/core/candump.js";
import { parseDbc } from "../src/core/dbc.js";
import { decodeLog, type DecodedLog, type DecodedSample } from "../src/core/decodeLog.js";
import { detectEvents } from "../src/core/events.js";

const dbc = parseDbc(
  readFileSync(new URL("../samples/vehicle.dbc", import.meta.url), "utf8"),
);
const parsed = parseCandump(
  readFileSync(new URL("../samples/drive_demo.log", import.meta.url), "utf8"),
);
const log = decodeLog(dbc, parsed.frames);
const result = detectEvents(log);

function eventOfType(type: string) {
  return result.events.find((event) => event.type === type);
}

function makeLog(
  samples: DecodedSample[],
  frames: CanFrame[] = [],
): DecodedLog {
  const sorted = [...samples].sort((a, b) => a.t - b.t);
  const orderedFrames = [...frames].sort(
    (a, b) => a.timestamp - b.timestamp,
  );
  const last = sorted[sorted.length - 1];
  const lastFrame = orderedFrames[orderedFrames.length - 1];
  const durationSec = Math.max(
    last === undefined ? 0 : last.t,
    lastFrame === undefined ? 0 : lastFrame.timestamp,
  );
  return {
    samples: sorted,
    unknownIds: new Map(),
    startTimestamp: 0,
    durationSec,
    frames: orderedFrames,
    warnings: [],
    statistics: {
      totalFrames: orderedFrames.length,
      decodedFrames: orderedFrames.length,
      skippedFrames: 0,
      unknownFrames: 0,
      decodedMessageCount: new Set(samples.map((sample) => sample.id)).size,
      warningCount: 0,
    },
  };
}

describe("detectEvents on the demo drive", () => {
  it("returns chronological events using every detector", () => {
    expect(result.warnings).toEqual([]);
    expect(result.unsupported).toEqual([]);

    for (let i = 1; i < result.events.length; i++) {
      expect(result.events[i]!.startTime).toBeGreaterThanOrEqual(
        result.events[i - 1]!.startTime,
      );
    }

    expect(new Set(result.events.map((event) => event.type))).toEqual(
      new Set([
        "rapid_deceleration",
        "brake_activity",
        "abs_activation",
        "gear_change",
        "signal_dropout",
      ]),
    );
  });

  it("detects one rapid deceleration with cautious hard-braking wording", () => {
    const event = eventOfType("rapid_deceleration");
    expect(event).toBeDefined();
    expect(event!.title).toBe("Possible hard braking");
    expect(event!.startTime).toBeGreaterThan(39);
    expect(event!.startTime).toBeLessThan(41);
    expect(event!.endTime).toBeGreaterThan(42.5);
    expect(event!.endTime).toBeLessThan(43.5);

    const speedEvidence = event!.evidence.filter(
      (item) => item.signalName === "Speed_kmh",
    );
    expect(speedEvidence).toHaveLength(2);
    expect(Number(speedEvidence[0]!.value)).toBeGreaterThan(45);
    expect(Number(speedEvidence[1]!.value)).toBeCloseTo(15, 1);

    const deceleration = event!.evidence.find(
      (item) => item.unit === "m/s²",
    );
    expect(deceleration).toBeDefined();
    expect(Number(deceleration!.value)).toBeGreaterThan(2.5);
    expect(Number(deceleration!.value)).toBeLessThan(4);

    expect(event!.summary).toContain("consistent with");
    expect(event!.summary).toContain("do not by themselves prove");
    expect(event!.confidence).toBeGreaterThanOrEqual(0.8);
    expect(event!.limitations.length).toBeGreaterThan(0);
  });

  it("detects the elevated brake-pressure interval", () => {
    const event = eventOfType("brake_activity");
    expect(event).toBeDefined();
    expect(event!.title).toBe("Elevated brake pressure");
    expect(event!.startTime).toBeGreaterThan(39.9);
    expect(event!.startTime).toBeLessThan(40.1);
    expect(event!.endTime).toBeGreaterThan(42.9);
    expect(event!.endTime).toBeLessThan(43.1);

    const peak = event!.evidence.find((item) =>
      item.description.startsWith("Peak value"),
    );
    expect(peak).toBeDefined();
    expect(peak!.value).toBe(90);
    expect(peak!.unit).toBe("%");
  });

  it("detects the ABS activation interval", () => {
    const event = eventOfType("abs_activation");
    expect(event).toBeDefined();
    expect(event!.startTime).toBeGreaterThan(40.9);
    expect(event!.startTime).toBeLessThan(41.1);
    expect(event!.endTime).toBeGreaterThan(42.4);
    expect(event!.endTime).toBeLessThan(42.7);

    const duration = event!.evidence.find(
      (item) => item.signalName === "ABS activation duration (derived)",
    );
    expect(duration).toBeDefined();
    expect(Number(duration!.value)).toBeGreaterThan(1.4);
    expect(Number(duration!.value)).toBeLessThan(1.7);
  });

  it("detects the park-to-drive gear change with labels", () => {
    const changes = result.events.filter(
      (event) => event.type === "gear_change",
    );
    expect(changes).toHaveLength(1);

    const event = changes[0]!;
    expect(event.startTime).toBeGreaterThan(9.9);
    expect(event.startTime).toBeLessThan(10.1);
    expect(event.evidence[0]!.value).toBe("P");
    expect(event.evidence[1]!.value).toBe("D");
    expect(event.summary).toContain("P");
    expect(event.summary).toContain("D");
  });

  it("flags the WheelSpeed dropout cautiously", () => {
    const event = eventOfType("signal_dropout");
    expect(event).toBeDefined();
    expect(event!.title).toBe("Possible telemetry dropout");
    expect(event!.startTime).toBeGreaterThan(49.5);
    expect(event!.startTime).toBeLessThan(50);
    expect(event!.endTime).toBeGreaterThan(52.9);
    expect(event!.endTime).toBeLessThan(53.2);
    expect(event!.summary).toContain("WheelSpeed");
    expect(event!.summary).toContain("may also reflect");
    expect(event!.evidence[0]!.messageId).toBe(272);
    expect(Number(event!.evidence[0]!.value)).toBeGreaterThan(2.8);
    expect(Number(event!.evidence[0]!.value)).toBeLessThan(3.2);
    expect(event!.confidence).toBe(0.65);
  });

  it("respects configurable thresholds and signal mappings", () => {
    const conservative = detectEvents(log, {
      deceleration: { minSpeedDropKmh: 100 },
    });
    expect(
      conservative.events.some(
        (event) => event.type === "rapid_deceleration",
      ),
    ).toBe(false);

    const wheelBased = detectEvents(log, {
      signals: { speed: "WheelSpeed.WheelSpeed_kmh" },
    });
    const deceleration = wheelBased.events.find(
      (event) => event.type === "rapid_deceleration",
    );
    expect(deceleration).toBeDefined();
    expect(
      deceleration!.evidence.some(
        (item) => item.signalName === "WheelSpeed_kmh",
      ),
    ).toBe(true);
  });

  it("can disable individual detectors", () => {
    const filtered = detectEvents(log, {
      enabled: { brake_activity: false, abs_activation: false },
    });
    expect(
      filtered.events.some((event) => event.type === "brake_activity"),
    ).toBe(false);
    expect(
      filtered.events.some((event) => event.type === "abs_activation"),
    ).toBe(false);
    expect(
      filtered.events.some((event) => event.type === "rapid_deceleration"),
    ).toBe(true);
  });
});

describe("deceleration boundaries", () => {
  function speedSample(t: number, value: number): DecodedSample {
    return {
      t,
      messageName: "VehicleSpeed",
      id: 256,
      signals: {
        Speed_kmh: {
          value,
          raw: Math.round(value * 10),
          unit: "km/h",
        },
      },
    };
  }

  function decelerations(samples: DecodedSample[]) {
    return detectEvents(makeLog(samples)).events.filter(
      (event) => event.type === "rapid_deceleration",
    );
  }

  it("does not fire on constant speed", () => {
    const samples = Array.from({ length: 101 }, (_, index) =>
      speedSample(index * 0.1, 50),
    );
    expect(decelerations(samples)).toHaveLength(0);
  });

  it("does not fire on quantization noise", () => {
    const samples = Array.from({ length: 101 }, (_, index) =>
      speedSample(index * 0.1, index % 2 === 0 ? 49.5 : 50.5),
    );
    expect(decelerations(samples)).toHaveLength(0);
  });

  it("handles irregular sampling intervals", () => {
    const events = decelerations([
      speedSample(0, 50),
      speedSample(1.2, 47),
      speedSample(3.2, 15),
    ]);

    expect(events).toHaveLength(1);
    expect(events[0]!.startTime).toBe(0);
    expect(events[0]!.endTime).toBe(3.2);
    expect(Number(
      events[0]!.evidence.find((item) => item.unit === "m/s²")!.value,
    )).toBeCloseTo(3.04, 1);
  });

  it("respects the minimum speed-drop boundary", () => {
    expect(
      decelerations([speedSample(0, 50), speedSample(0.8, 41)]),
    ).toHaveLength(0);
  });

  it("respects the minimum deceleration boundary", () => {
    expect(
      decelerations([speedSample(0, 50), speedSample(1, 40)]),
    ).toHaveLength(0);
  });

  it("fires just beyond the configured boundaries", () => {
    const events = decelerations([
      speedSample(0, 50),
      speedSample(0.8, 40),
    ]);
    expect(events).toHaveLength(1);
  });
});

describe("unsupported detectors", () => {
  it("reports detectors whose required signals are absent", () => {
    const gearOnly = makeLog([
      {
        t: 0,
        messageName: "GearStatus",
        id: 1024,
        signals: {
          GearPosition: { value: 0, raw: 0, unit: "", label: "P" },
        },
      },
      {
        t: 1,
        messageName: "GearStatus",
        id: 1024,
        signals: {
          GearPosition: { value: 3, raw: 3, unit: "", label: "D" },
        },
      },
    ]);

    const detection = detectEvents(gearOnly);
    const unsupported = detection.unsupported.map(
      (entry) => entry.detector,
    );

    expect(unsupported).toEqual(
      expect.arrayContaining([
        "rapid_deceleration",
        "brake_activity",
        "abs_activation",
        "traffic_burst",
      ]),
    );
    expect(detection.events.some((event) => event.type === "gear_change")).toBe(
      true,
    );
  });
});

describe("unusual CAN traffic", () => {
  it("detects a burst against an inferred baseline", () => {
    const frames: CanFrame[] = [];
    for (let i = 0; i < 10; i++) {
      frames.push({
        timestamp: i,
        channel: "can0",
        id: 0x123,
        extended: false,
        data: new Uint8Array(8),
      });
    }
    for (let i = 0; i < 20; i++) {
      frames.push({
        timestamp: 5 + i * 0.02,
        channel: "can0",
        id: 0x123,
        extended: false,
        data: new Uint8Array(8),
      });
    }
    frames.sort((a, b) => a.timestamp - b.timestamp);

    const burstLog = makeLog([], frames);
    const detection = detectEvents(burstLog);
    const bursts = detection.events.filter(
      (event) => event.type === "traffic_burst",
    );

    expect(bursts).toHaveLength(1);
    const event = bursts[0]!;
    expect(event.severity).toBe("info");
    expect(event.startTime).toBe(5);
    expect(event.endTime).toBe(6);
    expect(event.summary).toContain("0x123");
    expect(event.summary).toContain("baseline");
    expect(event.summary).toContain("does not indicate malicious behavior");

    const observed = event.evidence[0]!;
    expect(observed.channel).toBe("can0");
    expect(observed.messageId).toBe(0x123);
    expect(Number(observed.value)).toBeGreaterThan(15);
    expect(Number(event.evidence[1]!.value)).toBe(1);
  });
});