import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { encodeFrame } from "../src/core/codec.js";
import { parseDbc, type Dbc } from "../src/core/dbc.js";

const BASE_TIMESTAMP = 1700000000;
const DURATION_SEC = 60;
const CHANNEL = "can0";
const SEED = 42;
const JITTER_SEC = 0.003;

const PROJECT_ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);
const DBC_PATH = path.resolve(PROJECT_ROOT, "samples", "vehicle.dbc");
const LOG_PATH = path.resolve(PROJECT_ROOT, "samples", "drive_demo.log");

interface PendingFrame {
  timestamp: number;
  order: number;
  id: number;
  data: Uint8Array;
}

interface ScheduleEntry {
  messageName: string;
  hz: number;
}

const SCHEDULE: ScheduleEntry[] = [
  { messageName: "VehicleSpeed", hz: 20 },
  { messageName: "WheelSpeed", hz: 20 },
  { messageName: "EngineStatus", hz: 10 },
  { messageName: "BrakeStatus", hz: 20 },
  { messageName: "GearStatus", hz: 5 },
];

function mulberry32(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function noise(rng: () => number, amplitude: number): number {
  return (rng() * 2 - 1) * amplitude;
}

function baseSpeedAt(t: number): number {
  if (t < 10) return 0;
  if (t < 25) return (50 * (t - 10)) / 15;
  if (t < 40) return 50;
  if (t < 43) return 50 - (35 * (t - 40)) / 3;
  if (t < 50) return 15 + (45 * (t - 43)) / 7;
  return 60;
}

function vehicleSpeedAt(t: number, rng: () => number): number {
  const speed = baseSpeedAt(t);
  return t >= 25 && t < 40 ? speed + noise(rng, 1) : speed;
}

function wheelSpeedAt(t: number, rng: () => number): number {
  return Math.max(0, baseSpeedAt(t) + noise(rng, 0.3));
}

function rpmAt(t: number, rng: () => number): number {
  const speed = baseSpeedAt(t);
  const base = speed > 0 ? 800 + speed * 40 : 800;
  return base + noise(rng, 20);
}

function coolantTempAt(t: number): number {
  if (t <= 53) return 70 + (25 * t) / 53;
  return 95 + (15 * (t - 53)) / 7;
}

function brakePressureAt(t: number): number {
  return t >= 40 && t < 43 ? 90 : 0;
}

function absActiveAt(t: number): number {
  return t >= 41 && t <= 42.5 ? 1 : 0;
}

function gearPositionAt(t: number): number {
  return t >= 10 ? 3 : 0;
}

function messageId(dbc: Dbc, name: string): number {
  for (const message of dbc.messages.values()) {
    if (message.name === name) return message.id;
  }
  throw new Error(`Message not found in DBC: ${name}`);
}

function valuesFor(
  messageName: string,
  t: number,
  rng: () => number,
): Record<string, number> {
  switch (messageName) {
    case "VehicleSpeed":
      return { Speed_kmh: vehicleSpeedAt(t, rng) };
    case "WheelSpeed":
      return { WheelSpeed_kmh: wheelSpeedAt(t, rng) };
    case "EngineStatus":
      return {
        RPM: rpmAt(t, rng),
        CoolantTemp_C: coolantTempAt(t),
      };
    case "BrakeStatus":
      return {
        BrakePressure_pct: brakePressureAt(t),
        ABS_Active: absActiveAt(t),
      };
    case "GearStatus":
      return { GearPosition: gearPositionAt(t) };
    default:
      throw new Error(`Unknown message: ${messageName}`);
  }
}

function formatId(id: number): string {
  const hex = id.toString(16).toUpperCase();
  return id > 0x7ff ? hex.padStart(8, "0") : hex.padStart(3, "0");
}

function formatData(data: Uint8Array): string {
  return [...data]
    .map((byte) => byte.toString(16).padStart(2, "0").toUpperCase())
    .join("");
}

function roundTimestamp(timestamp: number): number {
  return Math.round(timestamp * 1e6) / 1e6;
}

export function generateSampleLog(): string {
  const dbc = parseDbc(readFileSync(DBC_PATH, "utf8"));
  const rng = mulberry32(SEED);
  const pending: PendingFrame[] = [];
  let order = 0;

  for (const { messageName, hz } of SCHEDULE) {
    const id = messageId(dbc, messageName);
    const tickCount = DURATION_SEC * hz;

    for (let tick = 0; tick < tickCount; tick++) {
      const t = tick / hz;

      if (messageName === "WheelSpeed" && t >= 50 && t < 53) continue;

      const data = encodeFrame(dbc, id, valuesFor(messageName, t, rng));
      pending.push({
        timestamp: BASE_TIMESTAMP + t + rng() * JITTER_SEC,
        order: order++,
        id,
        data,
      });
    }
  }

  pending.sort((a, b) => a.timestamp - b.timestamp || a.order - b.order);

  const firstTimestamp = pending[0]!.timestamp;
  const shift = BASE_TIMESTAMP - firstTimestamp;
  let previous = -Infinity;

  const lines: string[] = [];
  for (const frame of pending) {
    let timestamp = roundTimestamp(frame.timestamp + shift);
    if (timestamp <= previous) {
      timestamp = roundTimestamp(previous + 0.000001);
    }
    previous = timestamp;
    lines.push(
      `(${timestamp.toFixed(6)}) ${CHANNEL} ${formatId(frame.id)}#${formatData(frame.data)}`,
    );
  }

  return `${lines.join("\n")}\n`;
}

const invokedPath = process.argv[1];
const scriptPath = fileURLToPath(import.meta.url);
if (
  invokedPath !== undefined &&
  path.resolve(invokedPath).toLowerCase() === scriptPath.toLowerCase()
) {
  writeFileSync(LOG_PATH, generateSampleLog(), "utf8");
  console.log(`Wrote ${LOG_PATH}`);
}