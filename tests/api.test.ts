import { readFileSync } from "node:fs";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { buildServer } from "../src/server/app.js";

const logText = readFileSync(
  new URL("../samples/drive_demo.log", import.meta.url),
  "utf8",
);
const dbcText = readFileSync(
  new URL("../samples/vehicle.dbc", import.meta.url),
  "utf8",
);

function multipartBody(
  boundary: string,
  fields: Array<
    | { name: string; value: string }
    | { name: string; filename: string; value: string }
  >,
): string {
  const chunks: string[] = [];

  for (const field of fields) {
    chunks.push(`--${boundary}`);
    if ("filename" in field) {
      chunks.push(
        `Content-Disposition: form-data; name="${field.name}"; filename="${field.filename}"`,
      );
      chunks.push("Content-Type: text/plain");
    } else {
      chunks.push(`Content-Disposition: form-data; name="${field.name}"`);
    }
    chunks.push("");
    chunks.push(field.value);
  }

  chunks.push(`--${boundary}--`);
  chunks.push("");
  return chunks.join("\r\n");
}

describe("analysis API", () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    app = await buildServer({ env: {} });
  });

  afterAll(async () => {
    await app.close();
  });

  it("reports health", async () => {
    const response = await app.inject({ method: "GET", url: "/api/health" });
    expect(response.statusCode).toBe(200);

    const body = response.json();
    expect(body.status).toBe("ok");
    expect(body.narration.configured).toBe(false);
  });

  it("describes and returns the bundled sample safely", async () => {
    const summary = await app.inject({ method: "GET", url: "/api/sample" });
    expect(summary.statusCode).toBe(200);
    expect(summary.json().name).toBe("drive_demo");
    expect(summary.json().log).toBeUndefined();

    const full = await app.inject({
      method: "GET",
      url: "/api/sample?include=text",
    });
    expect(full.statusCode).toBe(200);
    expect(full.json().log).toContain("can0 100#");
    expect(full.json().dbc).toContain("BO_ 256 VehicleSpeed");
  });

  it("runs the real pipeline for the sample analysis endpoint", async () => {
    const response = await app.inject({
      method: "GET",
      url: "/api/sample/analysis",
    });
    expect(response.statusCode).toBe(200);

    const body = response.json();
    expect(body.analysisId).toBeTruthy();
    expect(body.events).toHaveLength(5);
    expect(body.timeline.entries).toHaveLength(3);
    expect(body.unknownIds).toEqual([]);
  });

  it("analyzes uploaded multipart log and DBC files", async () => {
    const boundary = "----canlognarratortest";
    const payload = multipartBody(boundary, [
      { name: "log", filename: "drive_demo.log", value: logText },
      { name: "dbc", filename: "vehicle.dbc", value: dbcText },
      {
        name: "config",
        value: JSON.stringify({
          detectors: { enabled: { traffic_burst: false } },
          timeline: { windowSec: 2 },
        }),
      },
    ]);

    const response = await app.inject({
      method: "POST",
      url: "/api/analyze",
      headers: {
        "content-type": `multipart/form-data; boundary=${boundary}`,
      },
      payload,
    });

    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body.analysisId).toBeTruthy();
    expect(body.statistics.totalFrames).toBe(4440);
    expect(body.events).toHaveLength(5);
    expect(body.timeline.entries).toHaveLength(3);
    expect(body.unsupported).toEqual([]);
  });

  it("returns useful errors for malformed multipart analysis", async () => {
    const boundary = "----broken";
    const payload = multipartBody(boundary, [
      {
        name: "log",
        filename: "bad.log",
        value: "(1.0) can0 100#00",
      },
      {
        name: "dbc",
        filename: "bad.dbc",
        value: 'BO_ 256 Bad: 8 ECU\nSG_ Bad : 0|0@1+ (1,0) [0|1] "" ECU',
      },
    ]);

    const response = await app.inject({
      method: "POST",
      url: "/api/analyze",
      headers: {
        "content-type": `multipart/form-data; boundary=${boundary}`,
      },
      payload,
    });

    expect(response.statusCode).toBe(400);
    expect(response.json().error.code).toBe("invalid_dbc");
  });

  it("rejects unsafe analysis configuration", async () => {
    const boundary = "----badconfig";
    const payload = multipartBody(boundary, [
      { name: "log", filename: "drive_demo.log", value: logText },
      { name: "dbc", filename: "vehicle.dbc", value: dbcText },
      {
        name: "config",
        value: JSON.stringify({ detectors: { traffic: { windowSec: 0 } } }),
      },
    ]);

    const response = await app.inject({
      method: "POST",
      url: "/api/analyze",
      headers: {
        "content-type": `multipart/form-data; boundary=${boundary}`,
      },
      payload,
    });

    expect(response.statusCode).toBe(400);
    expect(response.json().error.code).toBe("invalid_config");
    expect(response.json().error.details).toContain(
      "config.traffic.windowSec: must be greater than 0.",
    );
  });

  it("applies the configured CORS origin", async () => {
    const response = await app.inject({
      method: "GET",
      url: "/api/health",
      headers: { origin: "http://localhost:5173" },
    });

    expect(response.statusCode).toBe(200);
    expect(response.headers["access-control-allow-origin"]).toBe(
      "http://localhost:5173",
    );
  });

  it("rejects a multipart request without a log file", async () => {
    const boundary = "----nolog";
    const payload = multipartBody(boundary, [
      { name: "dbc", filename: "vehicle.dbc", value: dbcText },
    ]);

    const response = await app.inject({
      method: "POST",
      url: "/api/analyze",
      headers: {
        "content-type": `multipart/form-data; boundary=${boundary}`,
      },
      payload,
    });

    expect(response.statusCode).toBe(400);
    expect(response.json().error.code).toBe("missing_log");
  });

  it("rejects an oversized DBC upload", async () => {
    const boundary = "----bigdbc";
    const payload = multipartBody(boundary, [
      { name: "log", filename: "drive_demo.log", value: logText },
      {
        name: "dbc",
        filename: "oversized.dbc",
        value: "A".repeat(4 * 1024 * 1024 + 1),
      },
    ]);

    const response = await app.inject({
      method: "POST",
      url: "/api/analyze",
      headers: {
        "content-type": `multipart/form-data; boundary=${boundary}`,
      },
      payload,
    });

    expect(response.statusCode).toBe(413);
    expect(response.json().error.code).toBe("payload_too_large");
  });

  it("falls back to deterministic narration when the provider fails", async () => {
    const analysisResponse = await app.inject({
      method: "GET",
      url: "/api/sample/analysis",
    });
    const analysis = analysisResponse.json();

    const failingApp = await buildServer({
      env: {},
      provider: {
        name: "broken",
        generate: async () => {
          throw new Error("provider down");
        },
      },
    });

    try {
      const response = await failingApp.inject({
        method: "POST",
        url: "/api/narrate",
        payload: { analysis },
      });

      expect(response.statusCode).toBe(200);
      expect(response.json().mode).toBe("fallback");
      expect(response.json().provider).toBe("broken");
      expect(response.json().warnings[0]).toContain("failed");
    } finally {
      await failingApp.close();
    }
  });

  it("rejects JSON bodies on the file endpoint", async () => {
    const response = await app.inject({
      method: "POST",
      url: "/api/analyze",
      payload: { log: logText, dbc: dbcText },
    });

    expect(response.statusCode).toBe(400);
    expect(response.json().error.code).toBe("bad_request");
  });

  it("narrates a stored analysis with the deterministic fallback", async () => {
    const analysisResponse = await app.inject({
      method: "GET",
      url: "/api/sample/analysis",
    });
    const analysis = analysisResponse.json();

    const response = await app.inject({
      method: "POST",
      url: "/api/narrate",
      payload: { analysisId: analysis.analysisId },
    });

    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body.mode).toBe("fallback");
    expect(body.provider).toBe("deterministic");
    expect(body.report.overallSummary).toContain("event(s)");
    expect(body.report.narrative.length).toBeGreaterThan(0);
  });

  it("narrates a client-supplied analysis after validation", async () => {
    const analysisResponse = await app.inject({
      method: "GET",
      url: "/api/sample/analysis",
    });
    const analysis = analysisResponse.json();

    const response = await app.inject({
      method: "POST",
      url: "/api/narrate",
      payload: { analysis },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json().report.importantFindings.length).toBe(5);
  });

  it("rejects invalid analysis objects", async () => {
    const response = await app.inject({
      method: "POST",
      url: "/api/narrate",
      payload: { analysis: { version: 1, events: "not-an-array" } },
    });

    expect(response.statusCode).toBe(400);
    expect(response.json().error.code).toBe("invalid_analysis");
    expect(response.json().error.details.length).toBeGreaterThan(0);
  });

  it("returns 404 for an unknown stored analysis id", async () => {
    const response = await app.inject({
      method: "POST",
      url: "/api/narrate",
      payload: { analysisId: "missing" },
    });

    expect(response.statusCode).toBe(404);
    expect(response.json().error.code).toBe("not_found");
  });

  it("uses a consistent error structure for unknown routes", async () => {
    const response = await app.inject({ method: "GET", url: "/api/unknown" });
    expect(response.statusCode).toBe(404);
    expect(response.json()).toEqual({
      error: { code: "not_found", message: "Route not found." },
    });
  });
});