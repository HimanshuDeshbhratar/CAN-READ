export interface Signal {
  name: string;
  startBit: number;
  length: number;
  littleEndian: boolean;
  signed: boolean;
  factor: number;
  offset: number;
  min: number;
  max: number;
  unit: string;
  valueTable?: Record<number, string>;
}

export interface Message {
  id: number;
  name: string;
  dlc: number;
  signals: Signal[];
}

export interface Dbc {
  messages: Map<number, Message>;
}

const MAX_MESSAGE_ID = 0x1fffffff;
const MAX_CLASSIC_DLC = 8;
const MAX_SIGNAL_LENGTH = 64;

const MESSAGE_RE =
  /^BO_\s+(\d+)\s+([A-Za-z_][A-Za-z0-9_]*)\s*:\s*(\d+)\s+\S+/;

const SIGNAL_RE =
  /^SG_\s+([A-Za-z_][A-Za-z0-9_]*)\s*(?:([Mm]\d*)\s*)?:\s*(\d+)\|(\d+)@([01])([+-])\s*\(\s*([^,]+?)\s*,\s*([^)]+?)\s*\)\s*\[\s*([^|]+?)\s*\|\s*([^\]]+?)\s*\]\s*"([^"]*)"/;

const VALUE_RE = /^VAL_\s+(\d+)\s+([A-Za-z_][A-Za-z0-9_]*)\s+(.*)$/;

const VALUE_PAIR_RE = /(-?\d+)\s+"([^"]*)"/g;

interface PendingValueTable {
  messageId: number;
  signalName: string;
  table: Record<number, string>;
}

export function parseDbc(text: string): Dbc {
  const dbc: Dbc = { messages: new Map() };
  const pendingValueTables: PendingValueTable[] = [];
  let currentMessage: Message | undefined;

  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (line === "") continue;

    const messageMatch = MESSAGE_RE.exec(line);
    if (messageMatch) {
      const id = Number(messageMatch[1]);
      const name = messageMatch[2]!;
      const dlc = Number(messageMatch[3]);

      if (!Number.isInteger(id) || id < 0 || id > MAX_MESSAGE_ID) {
        throw new Error(
          `Invalid message id ${id} for "${name}"; expected 0-${MAX_MESSAGE_ID}.`,
        );
      }
      if (dbc.messages.has(id)) {
        throw new Error(`Duplicate message id ${id} ("${name}") in DBC.`);
      }
      if (!Number.isInteger(dlc) || dlc < 0 || dlc > MAX_CLASSIC_DLC) {
        throw new Error(
          `Invalid DLC ${dlc} for message "${name}"; classic CAN supports 0-${MAX_CLASSIC_DLC}.`,
        );
      }

      const message: Message = { id, name, dlc, signals: [] };
      dbc.messages.set(id, message);
      currentMessage = message;
      continue;
    }

    const signalMatch = SIGNAL_RE.exec(line);
    if (signalMatch) {
      if (!currentMessage) continue;

      const name = signalMatch[1]!;
      const littleEndian = signalMatch[5] === "1";
      if (!littleEndian) {
        throw new Error(`Big-endian signals are not supported yet: ${name}`);
      }
      if (signalMatch[2] !== undefined) {
        throw new Error(`Multiplexed signals are not supported yet: ${name}`);
      }

      const startBit = Number(signalMatch[3]);
      const length = Number(signalMatch[4]);
      const factor = Number(signalMatch[7]);
      const offset = Number(signalMatch[8]);
      const min = Number(signalMatch[9]);
      const max = Number(signalMatch[10]);

      if (!Number.isInteger(length) || length < 1 || length > MAX_SIGNAL_LENGTH) {
        throw new Error(
          `Invalid length ${length} for signal "${name}" in message "${currentMessage.name}"; expected 1-${MAX_SIGNAL_LENGTH} bits.`,
        );
      }
      if (!Number.isInteger(startBit) || startBit < 0) {
        throw new Error(
          `Invalid start bit ${startBit} for signal "${name}" in message "${currentMessage.name}".`,
        );
      }
      if (startBit + length > currentMessage.dlc * 8) {
        throw new Error(
          `Signal "${name}" in message "${currentMessage.name}" extends past the message DLC (bits ${startBit}-${startBit + length - 1}, DLC ${currentMessage.dlc}).`,
        );
      }
      if (!Number.isFinite(factor) || factor === 0) {
        throw new Error(
          `Invalid factor for signal "${name}" in message "${currentMessage.name}"; factor must be finite and non-zero.`,
        );
      }
      if (
        !Number.isFinite(offset) ||
        !Number.isFinite(min) ||
        !Number.isFinite(max)
      ) {
        throw new Error(
          `Invalid numeric definition for signal "${name}" in message "${currentMessage.name}".`,
        );
      }
      if (min > max) {
        throw new Error(
          `Invalid range for signal "${name}" in message "${currentMessage.name}"; min ${min} is greater than max ${max}.`,
        );
      }
      if (currentMessage.signals.some((signal) => signal.name === name)) {
        throw new Error(
          `Duplicate signal "${name}" in message "${currentMessage.name}".`,
        );
      }

      currentMessage.signals.push({
        name,
        startBit,
        length,
        littleEndian,
        signed: signalMatch[6] === "-",
        factor,
        offset,
        min,
        max,
        unit: signalMatch[11]!,
      });
      continue;
    }

    const valueMatch = VALUE_RE.exec(line);
    if (valueMatch) {
      const table: Record<number, string> = {};
      VALUE_PAIR_RE.lastIndex = 0;
      let pair: RegExpExecArray | null;
      while ((pair = VALUE_PAIR_RE.exec(valueMatch[3]!)) !== null) {
        table[Number(pair[1])] = pair[2]!;
      }
      pendingValueTables.push({
        messageId: Number(valueMatch[1]),
        signalName: valueMatch[2]!,
        table,
      });
    }
  }

  for (const pending of pendingValueTables) {
    const message = dbc.messages.get(pending.messageId);
    const signal = message?.signals.find((s) => s.name === pending.signalName);
    if (signal) signal.valueTable = pending.table;
  }

  return dbc;
}
