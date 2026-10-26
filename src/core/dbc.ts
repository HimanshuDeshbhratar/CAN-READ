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

const MESSAGE_RE =
  /^BO_\s+(\d+)\s+([A-Za-z_][A-Za-z0-9_]*)\s*:\s*(\d+)\s+\S+/;

const SIGNAL_RE =
  /^SG_\s+([A-Za-z_][A-Za-z0-9_]*)\s*(?:[Mm]\d*\s*)?:\s*(\d+)\|(\d+)@([01])([+-])\s*\(\s*([^,]+?)\s*,\s*([^)]+?)\s*\)\s*\[\s*([^|]+?)\s*\|\s*([^\]]+?)\s*\]\s*"([^"]*)"/;

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
      const message: Message = {
        id,
        name: messageMatch[2]!,
        dlc: Number(messageMatch[3]),
        signals: [],
      };
      dbc.messages.set(id, message);
      currentMessage = message;
      continue;
    }

    const signalMatch = SIGNAL_RE.exec(line);
    if (signalMatch) {
      if (!currentMessage) continue;

      const name = signalMatch[1]!;
      const littleEndian = signalMatch[4] === "1";
      if (!littleEndian) {
        throw new Error(`Big-endian signals are not supported yet: ${name}`);
      }

      currentMessage.signals.push({
        name,
        startBit: Number(signalMatch[2]),
        length: Number(signalMatch[3]),
        littleEndian,
        signed: signalMatch[5] === "-",
        factor: Number(signalMatch[6]),
        offset: Number(signalMatch[7]),
        min: Number(signalMatch[8]),
        max: Number(signalMatch[9]),
        unit: signalMatch[10]!,
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
