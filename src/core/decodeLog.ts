import type { CanFrame } from "./candump.js";
import type { DecodedSignal } from "./codec.js";
import { decodeFrame } from "./codec.js";
import type { Dbc } from "./dbc.js";

export interface DecodedSample {
  t: number;
  messageName: string;
  id: number;
  signals: Record<string, DecodedSignal>;
}

export function decodeLog(
  dbc: Dbc,
  frames: CanFrame[],
): {
  samples: DecodedSample[];
  unknownIds: Map<number, number>;
  startTimestamp: number;
  durationSec: number;
} {
  const unknownIds = new Map<number, number>();

  if (frames.length === 0) {
    return { samples: [], unknownIds, startTimestamp: 0, durationSec: 0 };
  }

  const startTimestamp = frames[0]!.timestamp;
  const samples: DecodedSample[] = [];

  for (const frame of frames) {
    const decoded = decodeFrame(dbc, frame.id, frame.data);
    if (!decoded) {
      unknownIds.set(frame.id, (unknownIds.get(frame.id) ?? 0) + 1);
      continue;
    }

    samples.push({
      t: frame.timestamp - startTimestamp,
      messageName: decoded.messageName,
      id: frame.id,
      signals: decoded.signals,
    });
  }

  const durationSec = frames[frames.length - 1]!.timestamp - startTimestamp;

  return { samples, unknownIds, startTimestamp, durationSec };
}