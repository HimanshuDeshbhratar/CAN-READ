// @vitest-environment jsdom
import { readFileSync } from "node:fs";
import path from "node:path";
import {
  cleanup,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { analyze } from "../../src/services/analysis.js";
import { buildFallbackReport } from "../../src/services/narrator.js";
import App from "./App";

const projectRoot = process.cwd();
const logText = readFileSync(
  path.resolve(projectRoot, "samples", "drive_demo.log"),
  "utf8",
);
const dbcText = readFileSync(
  path.resolve(projectRoot, "samples", "vehicle.dbc"),
  "utf8",
);

const analysis = analyze({ logText, dbcText });
const sampleResponse = {
  analysisId: "demo-test",
  source: "bundled-sample",
  ...analysis,
};
const narrationResponse = {
  mode: "fallback",
  provider: "deterministic",
  report: buildFallbackReport(analysis),
  warnings: [
    "No narration provider is configured; a deterministic report was generated instead.",
  ],
};

class ResizeObserverMock {
  private readonly callback: (
    entries: Array<{ target: Element; contentRect: { width: number; height: number } }>,
    observer: unknown,
  ) => void;

  constructor(
    callback: (
      entries: Array<{ target: Element; contentRect: { width: number; height: number } }>,
      observer: unknown,
    ) => void,
  ) {
    this.callback = callback;
  }

  observe(target: Element) {
    this.callback([{ target, contentRect: { width: 900, height: 300 } }], this);
  }

  unobserve() {}
  disconnect() {}
}

function jsonResponse(value: unknown, status = 200): Response {
  return new Response(JSON.stringify(value), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function urlOf(input: RequestInfo | URL): string {
  if (typeof input === "string") return input;
  if (input instanceof URL) return input.toString();
  return input.url;
}

describe("demo workflow", () => {
  beforeEach(() => {
    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockReturnValue({
      width: 900,
      height: 300,
      top: 0,
      left: 0,
      right: 900,
      bottom: 300,
      x: 0,
      y: 0,
      toJSON: () => ({}),
    } as DOMRect);
    vi.stubGlobal("ResizeObserver", ResizeObserverMock);
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) => {
        const url = urlOf(input);
        if (url.includes("/api/sample/analysis")) {
          return jsonResponse(sampleResponse);
        }
        if (url.includes("/api/narrate")) {
          return jsonResponse(narrationResponse);
        }
        if (url.includes("/api/health")) {
          return jsonResponse({
            status: "ok",
            narration: { provider: "none", configured: false },
          });
        }
        return jsonResponse(
          { error: { code: "not_found", message: "not found" } },
          404,
        );
      }),
    );
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("loads the real sample analysis and displays its measurements", async () => {
    const user = userEvent.setup();
    const { container } = render(<App />);

    await user.click(
      screen.getByRole("button", { name: /try demo drive/i }),
    );

    expect(await screen.findByText("Synthetic demo drive")).toBeTruthy();
    expect(screen.getByText("Total CAN frames")).toBeTruthy();
    expect(screen.getAllByText("4,440").length).toBeGreaterThan(0);
    expect(screen.getByText("Detected events")).toBeTruthy();
    expect(screen.getAllByText("Possible hard braking").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Possible telemetry dropout").length).toBeGreaterThan(0);
    expect(
      screen.getAllByText(/decreased from 50.9 km\/h to 15 km\/h over/).length,
    ).toBeGreaterThan(0);

    await waitFor(() => {
      expect(container.querySelectorAll(".chart-card").length).toBe(1);
    });
    await waitFor(() => {
      expect(container.querySelectorAll(".recharts-surface").length).toBeGreaterThan(0);
    });

    await user.click(
      screen.getByRole("button", { name: /WheelSpeed_kmh/i }),
    );
    await waitFor(() => {
      expect(container.querySelectorAll(".chart-card").length).toBe(2);
    });

    expect(await screen.findByText("Deterministic fallback")).toBeTruthy();
    expect(screen.getByText("Observed facts (deterministic)")).toBeTruthy();
    expect(screen.getByText("Detection rule")).toBeTruthy();
    expect(screen.getByText(/falls by at least 10 km\/h/)).toBeTruthy();
  });

  it("shows evidence for the selected ABS detection", async () => {
    const user = userEvent.setup();
    render(<App />);

    await user.click(
      screen.getByRole("button", { name: /try demo drive/i }),
    );

    const absButtons = await screen.findAllByRole("button", {
      name: /ABS activation/i,
    });
    await user.click(absButtons[0]!);

    expect(screen.getAllByText("ABS_Active").length).toBeGreaterThan(0);
    expect(screen.getAllByText("41.00 s").length).toBeGreaterThan(0);
    expect(screen.getByText(/change into an ABS-active value/)).toBeTruthy();
    expect(
      screen.getByText(/Event focus: 41\.00–42\.55 s/),
    ).toBeTruthy();
    expect(screen.getByText(/heuristic detector score/)).toBeTruthy();
  });
});