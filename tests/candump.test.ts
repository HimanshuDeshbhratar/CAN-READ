import { describe, expect, it } from "vitest";
import { parseCandump } from "../src/core/candump.js";

describe("parseCandump", () => {
  it("parses a standard frame", () => {
    const { frames, warnings } = parseCandump(
      "(1700000000.012345) can0 100#F401000000000000\n",
    );

    expect(warnings).toEqual([]);
    expect(frames).toHaveLength(1);

    const frame = frames[0]!;
    expect(frame.timestamp).toBeCloseTo(1700000000.012345, 6);
    expect(frame.channel).toBe("can0");
    expect(frame.id).toBe(0x100);
    expect(frame.extended).toBe(false);
    expect([...frame.data]).toEqual([0xf4, 0x01, 0, 0, 0, 0, 0, 0]);
  });

  it("parses an extended-ID frame", () => {
    const { frames, warnings } = parseCandump(
      "(1.0) can0 18FEF100#1122334455667788\n",
    );

    expect(warnings).toEqual([]);
    expect(frames).toHaveLength(1);

    const frame = frames[0]!;
    expect(frame.id).toBe(Number.parseInt("18FEF100", 16));
    expect(frame.extended).toBe(true);
    expect([...frame.data]).toEqual([
      0x11, 0x22, 0x33, 0x44, 0x55, 0x66, 0x77, 0x88,
    ]);
  });

  it("parses an empty-data frame", () => {
    const { frames, warnings } = parseCandump("(2.0) can0 123#\n");

    expect(warnings).toEqual([]);
    expect(frames).toHaveLength(1);
    expect(frames[0]!.id).toBe(0x123);
    expect(frames[0]!.data).toHaveLength(0);
  });

  it("parses lowercase hex", () => {
    const { frames, warnings } = parseCandump("(3.0) can0 1a0#deadbeef\n");

    expect(warnings).toEqual([]);
    expect(frames).toHaveLength(1);
    expect(frames[0]!.id).toBe(0x1a0);
    expect([...frames[0]!.data]).toEqual([0xde, 0xad, 0xbe, 0xef]);
  });

  it("handles CRLF line endings and blank lines", () => {
    const text =
      "(1.0) can0 100#01\r\n\r\n(1.5) can0 101#02\r\n";

    const { frames, warnings } = parseCandump(text);

    expect(warnings).toEqual([]);
    expect(frames).toHaveLength(2);
    expect(frames[0]!.id).toBe(0x100);
    expect(frames[1]!.id).toBe(0x101);
  });

  it("skips malformed, remote, and CAN FD lines with warnings", () => {
    const text = [
      "(1.0) can0 100#01",
      "(2.0) can0 100#F",
      "not a frame",
      "(4.0) can0 123#R",
      "(5.0) can0 123##01AABB",
      "(6.0) can0 18FEF100#1122334455667788",
    ].join("\n");

    const { frames, warnings } = parseCandump(text);

    expect(frames.map((frame) => frame.id)).toEqual([
      0x100,
      0x18fef100,
    ]);
    expect(warnings).toHaveLength(4);
    expect(warnings[0]).toMatch(/^Line 2 skipped: /);
    expect(warnings[1]).toMatch(/^Line 3 skipped: /);
    expect(warnings[2]).toMatch(/^Line 4 skipped: /);
    expect(warnings[3]).toMatch(/^Line 5 skipped: /);
  });
});