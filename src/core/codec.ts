import type { Dbc } from "./dbc.js";

export interface DecodedSignal {
  value: number;
  raw: number;
  unit: string;
  label?: string;
}

export interface DecodedFrame {
  messageName: string;
  signals: Record<string, DecodedSignal>;
}

function mask(length: number): bigint {
  return (1n << BigInt(length)) - 1n;
}

function toSigned(bits: bigint, length: number): bigint {
  const signBit = 1n << BigInt(length - 1);
  return bits & signBit ? bits - (1n << BigInt(length)) : bits;
}

function readLittleEndianBits(
  data: Uint8Array,
  startBit: number,
  length: number,
): bigint {
  let bits = 0n;
  for (let i = data.length - 1; i >= 0; i--) {
    bits = (bits << 8n) | BigInt(data[i]!);
  }
  return (bits >> BigInt(startBit)) & mask(length);
}

export function decodeFrame(
  dbc: Dbc,
  id: number,
  data: Uint8Array,
): DecodedFrame | null {
  const message = dbc.messages.get(id);
  if (!message) return null;

  const signals: Record<string, DecodedSignal> = {};
  for (const signal of message.signals) {
    if (!signal.littleEndian) {
      throw new Error(`Big-endian signals are not supported yet: ${signal.name}`);
    }

    const bits = readLittleEndianBits(data, signal.startBit, signal.length);
    const raw = signal.signed ? toSigned(bits, signal.length) : bits;
    const rawValue = Number(raw);

    const decoded: DecodedSignal = {
      value: rawValue * signal.factor + signal.offset,
      raw: rawValue,
      unit: signal.unit,
    };
    const label = signal.valueTable?.[rawValue];
    if (label !== undefined) decoded.label = label;
    signals[signal.name] = decoded;
  }

  return { messageName: message.name, signals };
}

export function encodeFrame(
  dbc: Dbc,
  id: number,
  values: Record<string, number>,
): Uint8Array {
  const message = dbc.messages.get(id);
  if (!message) {
    throw new Error(`Unknown message id: ${id}`);
  }

  let bits = 0n;
  for (const signal of message.signals) {
    if (!Object.prototype.hasOwnProperty.call(values, signal.name)) continue;
    if (!signal.littleEndian) {
      throw new Error(`Big-endian signals are not supported yet: ${signal.name}`);
    }

    const value = values[signal.name]!;
    const raw = Math.round((value - signal.offset) / signal.factor);
    const truncated = BigInt(raw) & mask(signal.length);
    bits |= truncated << BigInt(signal.startBit);
  }

  const out = new Uint8Array(message.dlc);
  for (let i = 0; i < out.length; i++) {
    out[i] = Number((bits >> BigInt(8 * i)) & 0xffn);
  }
  return out;
}
