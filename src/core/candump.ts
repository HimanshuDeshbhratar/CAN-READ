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

const FRAME_RE = /^\(([^()]*)\)\s+(\S+)\s+([^#\s]+)#(.*)$/;
const STANDARD_ID_RE = /^[0-9A-Fa-f]{3}$/;
const EXTENDED_ID_RE = /^[0-9A-Fa-f]{8}$/;
const HEX_RE = /^[0-9A-Fa-f]*$/;

export function parseCandump(text: string): CandumpParseResult {
  const frames: CanFrame[] = [];
  const warnings: string[] = [];
  const lines = text.split(/\r?\n/);

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!.trim();
    if (line === "") continue;

    const lineNumber = i + 1;
    const skip = (reason: string): void => {
      warnings.push(`Line ${lineNumber} skipped: ${reason}`);
    };

    const match = FRAME_RE.exec(line);
    if (!match) {
      skip("malformed frame");
      continue;
    }

    const timestamp = Number(match[1]!);
    if (!Number.isFinite(timestamp)) {
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

    const data = new Uint8Array(payload.length / 2);
    for (let byte = 0; byte < data.length; byte++) {
      data[byte] = Number.parseInt(payload.slice(byte * 2, byte * 2 + 2), 16);
    }

    frames.push({
      timestamp,
      channel,
      id: Number.parseInt(idText, 16),
      extended,
      data,
    });
  }

  return { frames, warnings };
}