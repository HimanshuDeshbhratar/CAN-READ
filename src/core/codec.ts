import type { Dbc, Message, Signal } from "./dbc.js";

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

function validateSignal(signal: Signal, message: Message): void {
  if (!Number.isInteger(signal.startBit) || signal.startBit < 0) {
    throw new Error(
      `Invalid start bit ${signal.startBit} for signal "${signal.name}" in message "${message.name}".`,
    );
  }
  if (
    !Number.isInteger(signal.length) ||
    signal.length < 1 ||
    signal.length > 64
  ) {
    throw new Error(
      `Invalid length ${signal.length} for signal "${signal.name}" in message "${message.name}"; expected 1-64 bits.`,
    );
  }
  if (signal.startBit + signal.length > message.dlc * 8) {
    throw new Error(
      `Signal "${signal.name}" in message "${message.name}" extends past the message DLC (bits ${signal.startBit}-${signal.startBit + signal.length - 1}, DLC ${message.dlc}).`,
    );
  }
  if (!Number.isFinite(signal.factor) || signal.factor === 0) {
    throw new Error(
      `Invalid factor for signal "${signal.name}" in message "${message.name}"; factor must be finite and non-zero.`,
    );
  }
  if (!Number.isFinite(signal.offset)) {
    throw new Error(
      `Invalid offset for signal "${signal.name}" in message "${message.name}".`,
    );
  }
}

function rawRange(length: number, signed: boolean): { min: bigint; max: bigint } {
  if (signed) {
    return {
      min: -(1n << BigInt(length - 1)),
      max: (1n << BigInt(length - 1)) - 1n,
    };
  }
  return { min: 0n, max: mask(length) };
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
    validateSignal(signal, message);

    const requiredBytes = Math.ceil((signal.startBit + signal.length) / 8);
    if (data.length < requiredBytes) {
      throw new Error(
        `Frame for message "${message.name}" is ${data.length} bytes; signal "${signal.name}" requires at least ${requiredBytes}.`,
      );
    }

    const bits = readLittleEndianBits(data, signal.startBit, signal.length);
    const raw = signal.signed ? toSigned(bits, signal.length) : bits;
    if (
      raw > BigInt(Number.MAX_SAFE_INTEGER) ||
      raw < BigInt(Number.MIN_SAFE_INTEGER)
    ) {
      throw new Error(
        `Signal "${signal.name}" raw value ${raw} cannot be represented safely as a JavaScript number.`,
      );
    }
    const rawValue = Number(raw);
    const value = rawValue * signal.factor + signal.offset;
    if (!Number.isFinite(value)) {
      throw new Error(
        `Signal "${signal.name}" decoded value is not finite; check its factor and offset.`,
      );
    }

    const decoded: DecodedSignal = {
      value,
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
    validateSignal(signal, message);

    const value = values[signal.name]!;
    if (!Number.isFinite(value)) {
      throw new Error(
        `Value for signal "${signal.name}" must be a finite number.`,
      );
    }

    const rawNumber = Math.round((value - signal.offset) / signal.factor);
    if (!Number.isSafeInteger(rawNumber)) {
      throw new Error(
        `Value ${value} for signal "${signal.name}" cannot be represented safely as an integer raw value.`,
      );
    }

    const range = rawRange(signal.length, signal.signed);
    const raw = BigInt(rawNumber);
    if (raw < range.min || raw > range.max) {
      throw new Error(
        `Value ${value} for signal "${signal.name}" is out of range (raw ${rawNumber}; allowed ${range.min}-${range.max}).`,
      );
    }

    bits |= (raw & mask(signal.length)) << BigInt(signal.startBit);
  }

  const out = new Uint8Array(message.dlc);
  for (let i = 0; i < out.length; i++) {
    out[i] = Number((bits >> BigInt(8 * i)) & 0xffn);
  }
  return out;
}
