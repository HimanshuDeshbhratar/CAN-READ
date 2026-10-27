export interface CanFrame {
  timestamp: number;
  channel: string;
  id: number;
  extended: boolean;
  data: Uint8Array;
}

export interface CandumpParseResult {
  frames: CanFrame[];
  warnings: string[];
}

export interface CandumpLimits {
  /** Maximum input size in UTF-16 characters. */
  maxInputChars: number;
  /** Maximum number of lines accepted in one input. */
  maxLines: number;
  /** Maximum payload size for classic CAN frames. */
  maxDataBytes: number;
  /** Maximum number of line warnings retained. */
  maxWarnings: number;
}

export type ParseCandumpOptions = Partial<CandumpLimits>;

export const DEFAULT_CANDUMP_LIMITS: CandumpLimits = {
  maxInputChars: 20_000_000,
  maxLines: 500_000,
  maxDataBytes: 8,
  maxWarnings: 1_000,
};

const FRAME_RE = /^\(([^()]*)\)\s+(\S+)\s+([^#\s]+)#(.*)$/;
const STANDARD_ID_RE = /^[0-9A-Fa-f]{3}$/;
const EXTENDED_ID_RE = /^[0-9A-Fa-f]{8}$/;
const HEX_RE = /^[0-9A-Fa-f]*$/;

const MAX_STANDARD_ID = 0x7ff;
const MAX_EXTENDED_ID = 0x1fffffff;

export function parseCandump(
  text: string,
  options: ParseCandumpOptions = {},
): CandumpParseResult {
  const limits: CandumpLimits = { ...DEFAULT_CANDUMP_LIMITS, ...options };

  if (text.length > limits.maxInputChars) {
    return {
      frames: [],
      warnings: [
        `Input rejected: ${text.length} characters exceeds the limit of ${limits.maxInputChars}.`,
      ],
    };
  }

  const lines = text.split(/\r?\n/);
  if (lines.length > limits.maxLines) {
    return {
      frames: [],
      warnings: [
        `Input rejected: ${lines.length} lines exceeds the limit of ${limits.maxLines}.`,
      ],
    };
  }

  const frames: CanFrame[] = [];
  const warnings: string[] = [];
  let suppressedWarnings = 0;

  const warn = (message: string): void => {
    if (warnings.length < limits.maxWarnings) {
      warnings.push(message);
    } else {
      suppressedWarnings++;
    }
  };

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!.trim();
    if (line === "") continue;

    const lineNumber = i + 1;
    const skip = (reason: string): void => {
      warn(`Line ${lineNumber} skipped: ${reason}`);
    };

    const match = FRAME_RE.exec(line);
    if (!match) {
      skip("malformed frame");
      continue;
    }

    const timestampText = match[1]!.trim();
    const timestamp = Number(timestampText);
    if (timestampText === "" || !Number.isFinite(timestamp)) {
      skip("invalid timestamp");
      continue;
    }

    const channel = match[2]!;
    const idText = match[3]!;
    const payload = match[4]!;

    let extended: boolean;
    if (STANDARD_ID_RE.test(idText)) {
      extended = false;
    } else if (EXTENDED_ID_RE.test(idText)) {
      extended = true;
    } else {
      skip(`invalid CAN ID "${idText}"`);
      continue;
    }

    const id = Number.parseInt(idText, 16);
    if (!extended && id > MAX_STANDARD_ID) {
      skip(`standard CAN ID "${idText}" exceeds 11 bits`);
      continue;
    }
    if (extended && id > MAX_EXTENDED_ID) {
      skip(`extended CAN ID "${idText}" exceeds 29 bits`);
      continue;
    }

    if (/^[Rr]/.test(payload)) {
      skip("remote frames are not supported");
      continue;
    }

    if (payload.startsWith("#")) {
      skip("CAN FD frames are not supported");
      continue;
    }

    if (payload.length % 2 !== 0 || !HEX_RE.test(payload)) {
      skip("invalid data payload");
      continue;
    }

    const byteLength = payload.length / 2;
    if (byteLength > limits.maxDataBytes) {
      skip(
        `payload is ${byteLength} bytes; classic CAN supports at most ${limits.maxDataBytes}`,
      );
      continue;
    }

    const data = new Uint8Array(byteLength);
    for (let byte = 0; byte < data.length; byte++) {
      data[byte] = Number.parseInt(payload.slice(byte * 2, byte * 2 + 2), 16);
    }

    frames.push({
      timestamp,
      channel,
      id,
      extended,
      data,
    });
  }

  if (suppressedWarnings > 0) {
    warnings.push(`${suppressedWarnings} additional warning(s) suppressed.`);
  }

  return { frames, warnings };
}