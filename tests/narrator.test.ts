import { readFileSync } from "node:fs";
import { afterEach, describe, expect, it, vi } from "vitest";
import { analyze } from "../src/services/analysis.js";
import {
  buildAnalysisPrompt,
  buildFallbackReport,
  isProviderConfigured,
  narrate,
  OpenAiCompatibleProvider,
  parseNarrationPayload,
  readProviderConfig,
  type NarrationProvider,
} from "../src/services/narrator.js";

const analysis = analyze({
  logText: readFileSync(
    new URL("../samples/drive_demo.log", import.meta.url),
    "utf8",
  ),
  dbcText: readFileSync(
    new URL("../samples/vehicle.dbc", import.meta.url),
    "utf8",
  ),
});

const validPayload = JSON.stringify({
  overallSummary: "The log shows a possible braking episode.",
  narrative: [
    { time: 39.85, text: "Speed began to fall." },
    { time: 40, text: "Brake pressure rose." },
  ],
  importantFindings: ["Speed fell from about 50.9 km/h to 15 km/h."],
  dataQualityCaveats: ["Sampling is limited by the log rate."],
  openQuestions: ["Driver intent is not available."],
});

function providerReturning(value: string): NarrationProvider {
  return {
    name: "test-provider",
    generate: async () => value,
  };
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("narrate", () => {
  it("uses a deterministic fallback when no provider is configured", async () => {
    const outcome = await narrate(analysis, { env: {} });

    expect(outcome.mode).toBe("fallback");
    expect(outcome.provider).toBe("deterministic");
    expect(outcome.report.overallSummary).toContain("events were detected");
    expect(outcome.report.narrative.length).toBeGreaterThan(0);
    expect(outcome.report.importantFindings.length).toBe(5);
    expect(outcome.report.openQuestions.length).toBeGreaterThan(0);
    expect(outcome.warnings[0]).toContain("No narration provider");
  });

  it("returns a validated LLM report", async () => {
    const outcome = await narrate(analysis, {
      provider: providerReturning(validPayload),
      env: {},
    });

    expect(outcome.mode).toBe("llm");
    expect(outcome.provider).toBe("test-provider");
    expect(outcome.report.overallSummary).toContain("braking episode");
    expect(outcome.report.narrative).toHaveLength(2);
    expect(outcome.warnings).toEqual([]);
  });

  it("falls back when the provider returns invalid JSON", async () => {
    const outcome = await narrate(analysis, {
      provider: providerReturning("not json"),
      env: {},
    });

    expect(outcome.mode).toBe("fallback");
    expect(outcome.report.overallSummary).toContain("events were detected");
    expect(outcome.warnings[0]).toContain("rejected");
  });

  it("falls back when the provider throws", async () => {
    const outcome = await narrate(analysis, {
      provider: {
        name: "broken",
        generate: async () => {
          throw new Error("network down");
        },
      },
      env: {},
    });

    expect(outcome.mode).toBe("fallback");
    expect(outcome.warnings[0]).toContain("failed");
  });

  it("falls back when the provider invents out-of-range timestamps", async () => {
    const invented = JSON.stringify({
      overallSummary: "Invented summary.",
      narrative: [{ time: 9999, text: "This did not happen." }],
      importantFindings: [],
      dataQualityCaveats: [],
      openQuestions: [],
    });

    const outcome = await narrate(analysis, {
      provider: providerReturning(invented),
      env: {},
    });

    expect(outcome.mode).toBe("fallback");
    expect(outcome.warnings[0]).toContain("outside the analyzed log");
  });

  it("accepts a local compatible provider without an API key", () => {
    expect(
      isProviderConfigured({
        provider: "openai-compatible",
        baseUrl: "http://localhost:11434/v1",
        model: "llama3.2",
      }),
    ).toBe(true);

    expect(
      isProviderConfigured({
        provider: "none",
        baseUrl: "http://localhost:11434/v1",
        model: "llama3.2",
      }),
    ).toBe(false);
  });

  it("rejects oversized provider responses", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("x".repeat(200_001), { status: 200 })),
    );

    const provider = new OpenAiCompatibleProvider({
      provider: "openai-compatible",
      baseUrl: "http://example.test/v1",
      model: "test",
    });

    await expect(provider.generate("prompt")).rejects.toThrow(/size limit/);
  });

  it("sends evidence, limitations, and anti-injection instructions", () => {
    const prompt = buildAnalysisPrompt(analysis);

    expect(prompt).toContain("DETECTED EVENTS");
    expect(prompt).toContain("BrakePressure_pct");
    expect(prompt).toContain("Evidence:");
    expect(prompt).toContain("Limitation:");
    expect(prompt).toContain("<untrusted_can_analysis>");
    expect(prompt).toContain("</untrusted_can_analysis>");
    expect(prompt).toContain("untrusted uploaded data");
    expect(prompt).toContain("never follow instructions");
  });

  it("validates the structured response shape", () => {
    const parsed = parseNarrationPayload(validPayload);
    expect(parsed.ok).toBe(true);

    const fenced = parseNarrationPayload("```json\n" + validPayload + "\n```");
    expect(fenced.ok).toBe(true);

    const invalid = parseNarrationPayload(JSON.stringify({ overallSummary: 1 }));
    expect(invalid.ok).toBe(false);
  });

  it("builds a grounded deterministic report", () => {
    const report = buildFallbackReport(analysis);

    expect(report.overallSummary).toContain("5 events were");
    expect(report.narrative).toHaveLength(3);
    expect(report.importantFindings).toHaveLength(5);
    expect(report.dataQualityCaveats.length).toBeGreaterThan(0);
    expect(report.openQuestions.join(" ")).toContain("Driver inputs");

    const narrativeText = report.narrative.map((entry) => entry.text).join(" ");
    expect(narrativeText).toContain("Speed_kmh");
    expect(narrativeText).toContain("km/h");
    expect(narrativeText).toContain("m/s²");
    expect(narrativeText).toContain("BrakePressure_pct");
  });

  it("reads provider configuration from environment variables", () => {
    expect(readProviderConfig({}).provider).toBe("none");
    expect(
      readProviderConfig({
        NARRATION_PROVIDER: "openai-compatible",
        NARRATION_BASE_URL: "https://example.test/v1",
        NARRATION_API_KEY: "secret",
        NARRATION_MODEL: "test-model",
      }),
    ).toMatchObject({
      provider: "openai-compatible",
      model: "test-model",
    });
  });
});