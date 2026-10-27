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

export interface DecodedLogStatistics {
  totalFrames: number;
  decodedFrames: number;
  skippedFrames: number;
  unknownFrames: number;
  decodedMessageCount: number;
  warningCount: number;
}

export interface DecodedLog {
  samples: DecodedSample[];
  unknownIds: Map<number, number>;
  startTimestamp: number;
  durationSec: number;
  frames: CanFrame[];
  warnings: string[];
  statistics: DecodedLogStatistics;
}

const MAX_WARNINGS = 100;

function emptyStatistics(warningCount: number): DecodedLogStatistics {
  return {
    totalFrames: 0,
    decodedFrames: 0,
    skippedFrames: 0,
    unknownFrames: 0,
    decodedMessageCount: 0,
    warningCount,
  };
}

export function decodeLog(dbc: Dbc, frames: CanFrame[]): DecodedLog {
  const unknownIds = new Map<number, number>();
  const warnings: string[] = [];
  let suppressedWarnings = 0;

  if (frames.length === 0) {
    return {
      samples: [],
      unknownIds,
      startTimestamp: 0,
      durationSec: 0,
      frames: [],
      warnings,
      statistics: emptyStatistics(0),
    };
  }

  const warn = (message: string): void => {
    if (warnings.length < MAX_WARNINGS) {
      warnings.push(message);
    } else {
      suppressedWarnings++;
    }
  };

  let nonMonotonic = false;
  for (let i = 1; i < frames.length; i++) {
    if (frames[i]!.timestamp < frames[i - 1]!.timestamp) {
      nonMonotonic = true;
      break;
    }
  }
  if (nonMonotonic) {
    warn("Frames are not in chronological order; samples were sorted by timestamp.");
  }

  const orderedFrames = [...frames].sort(
    (a, b) => a.timestamp - b.timestamp,
  );
  const startTimestamp = orderedFrames[0]!.timestamp;
  const samples: DecodedSample[] = [];
  const decodedMessageIds = new Set<number>();
  let decodedFrames = 0;
  let skippedFrames = 0;

  for (const frame of orderedFrames) {
    const message = dbc.messages.get(frame.id);
    if (!message) {
      unknownIds.set(frame.id, (unknownIds.get(frame.id) ?? 0) + 1);
      continue;
    }

    if (frame.data.length > message.dlc) {
      warn(
        `Frame at ${frame.timestamp.toFixed(6)} (ID 0x${frame.id.toString(16).toUpperCase()}) has ${frame.data.length} bytes but message "${message.name}" has DLC ${message.dlc}; extra bytes were ignored.`,
      );
    }

    try {
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
      decodedFrames++;
      decodedMessageIds.add(frame.id);
    } catch (error) {
      skippedFrames++;
      const reason = error instanceof Error ? error.message : String(error);
      warn(
        `Frame at ${frame.timestamp.toFixed(6)} (ID 0x${frame.id.toString(16).toUpperCase()}) skipped: ${reason}`,
      );
    }
  }

  const durationSec =
    orderedFrames[orderedFrames.length - 1]!.timestamp - startTimestamp;
  const unknownFrames = [...unknownIds.values()].reduce(
    (total, count) => total + count,
    0,
  );

  if (suppressedWarnings > 0) {
    warnings.push(`${suppressedWarnings} additional warning(s) suppressed.`);
  }

  return {
    samples,
    unknownIds,
    startTimestamp,
    durationSec,
    frames: orderedFrames,
    warnings,
    statistics: {
      totalFrames: frames.length,
      decodedFrames,
      skippedFrames,
      unknownFrames,
      decodedMessageCount: decodedMessageIds.size,
      warningCount: warnings.length,
    },
  };
}