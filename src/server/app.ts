import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import cors from "@fastify/cors";
import multipart from "@fastify/multipart";
import fastifyStatic from "@fastify/static";
import Fastify, { type FastifyInstance } from "fastify";
import type { DetectorConfig } from "../core/events.js";
import type { TimelineConfig } from "../core/timeline.js";
import {
  AnalysisError,
  analyze,
  type AnalysisResult,
} from "../services/analysis.js";
import {
  isProviderConfigured,
  narrate,
  readProviderConfig,
  type NarrationEnv,
  type NarrationProvider,
} from "../services/narrator.js";
import {
  validateAnalysisResult,
  validateDetectorConfig,
  validateTimelineConfig,
  type ValidationIssue,
} from "./validation.js";

const PROJECT_ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
  "..",
);
const SAMPLE_LOG_PATH = path.resolve(PROJECT_ROOT, "samples", "drive_demo.log");
const SAMPLE_DBC_PATH = path.resolve(PROJECT_ROOT, "samples", "vehicle.dbc");
const WEB_DIST_PATH = path.resolve(PROJECT_ROOT, "dist", "web");
const WEB_INDEX_PATH = path.resolve(WEB_DIST_PATH, "index.html");

function resolveCorsOrigins(value: string | undefined): string | string[] {
  const configured = value ?? "http://localhost:5173,http://127.0.0.1:5173";
  const origins = configured
    .split(",")
    .map((origin) => origin.trim())
    .filter((origin) => origin !== "");
  return origins.length === 1 ? origins[0]! : origins;
}

export interface ServerOptions {
  env?: NarrationEnv & { CORS_ORIGIN?: string; PORT?: string; HOST?: string };
  provider?: NarrationProvider;
  logger?: boolean;
}

export interface ApiErrorBody {
  error: {
    code: string;
    message: string;
    details?: string[];
  };
}

const ANALYSIS_STORE_TTL_MS = 10 * 60 * 1000;
const ANALYSIS_STORE_MAX = 50;

interface StoredAnalysis {
  result: AnalysisResult;
  expiresAt: number;
}

class AnalysisStore {
  private readonly entries = new Map<string, StoredAnalysis>();

  put(id: string, result: AnalysisResult): void {
    this.entries.set(id, { result, expiresAt: Date.now() + ANALYSIS_STORE_TTL_MS });
    if (this.entries.size > ANALYSIS_STORE_MAX) {
      const oldest = this.entries.keys().next();
      if (!oldest.done) this.entries.delete(oldest.value);
    }
  }

  get(id: string): AnalysisResult | undefined {
    const entry = this.entries.get(id);
    if (!entry) return undefined;
    if (entry.expiresAt < Date.now()) {
      this.entries.delete(id);
      return undefined;
    }
    return entry.result;
  }
}

function randomId(): string {
  return Math.random().toString(36).slice(2, 10) + Date.now().toString(36);
}

export async function buildServer(options: ServerOptions = {}): Promise<FastifyInstance> {
  const env = options.env ?? process.env;
  const store = new AnalysisStore();

  const app = Fastify({
    logger: options.logger ?? false,
    bodyLimit: 40 * 1024 * 1024,
    requestTimeout: 60_000,
    connectionTimeout: 15_000,
  });

  await app.register(cors, {
    origin: resolveCorsOrigins(env.CORS_ORIGIN),
    methods: ["GET", "POST", "OPTIONS"],
  });

  await app.register(multipart, {
    limits: {
      fileSize: 32 * 1024 * 1024,
      files: 2,
      fields: 10,
    },
  });

  if (existsSync(WEB_INDEX_PATH)) {
    await app.register(fastifyStatic, {
      root: WEB_DIST_PATH,
      prefix: "/",
    });
  }

  app.setErrorHandler((error, request, reply) => {
    const err = error as { statusCode?: number; message?: string };
    const statusCode =
      typeof err.statusCode === "number" && err.statusCode >= 400
        ? err.statusCode
        : 500;

    const body: ApiErrorBody = {
      error: {
        code:
          statusCode === 400
            ? "bad_request"
            : statusCode === 413
              ? "payload_too_large"
              : statusCode === 404
                ? "not_found"
                : "internal_error",
        message:
          statusCode >= 500
            ? "The request could not be completed."
            : (err.message ?? "The request is invalid."),
      },
    };

    if (statusCode >= 500) {
      request.log.error({ err }, "request failed");
    }

    void reply.status(statusCode).send(body);
  });

  app.setNotFoundHandler((request, reply) => {
    if (
      existsSync(WEB_INDEX_PATH) &&
      request.method === "GET" &&
      !request.url.startsWith("/api")
    ) {
      return reply.type("text/html").sendFile("index.html");
    }

    void reply.status(404).send({
      error: {
        code: "not_found",
        message: "Route not found.",
      },
    } satisfies ApiErrorBody);
  });

  app.get("/api/health", async () => {
    const config = readProviderConfig(env);
    return {
      status: "ok",
      uptimeSec: Math.round(process.uptime()),
      narration: {
        provider: config.provider,
        configured: isProviderConfigured(config),
      },
      limits: {
        maxLogBytes: 32 * 1024 * 1024,
        maxDbcBytes: 4 * 1024 * 1024,
      },
    };
  });

  app.get("/api/sample", async (request) => {
    const query = request.query as { include?: string } | undefined;
    const includeText = query?.include === "text";

    const logText = readFileSync(SAMPLE_LOG_PATH, "utf8");
    const dbcText = readFileSync(SAMPLE_DBC_PATH, "utf8");

    const base = {
      name: "drive_demo",
      logBytes: Buffer.byteLength(logText, "utf8"),
      dbcBytes: Buffer.byteLength(dbcText, "utf8"),
      logLines: logText.split("\n").filter((line) => line.trim() !== "").length,
      description:
        "Bundled 60-second demo drive generated from samples/vehicle.dbc.",
      analysisUrl: "/api/sample/analysis",
    };

    if (!includeText) return base;

    return { ...base, log: logText, dbc: dbcText };
  });

  app.get("/api/sample/analysis", async (_request, reply) => {
    const logText = readFileSync(SAMPLE_LOG_PATH, "utf8");
    const dbcText = readFileSync(SAMPLE_DBC_PATH, "utf8");

    try {
      const result = analyze({ logText, dbcText });
      const analysisId = randomId();
      store.put(analysisId, result);

      return {
        analysisId,
        source: "bundled-sample",
        ...result,
      };
    } catch (error) {
      if (error instanceof AnalysisError) {
        return reply
          .status(400)
          .send({
            error: { code: error.code, message: error.message, details: error.details },
          } satisfies ApiErrorBody);
      }
      throw error;
    }
  });

  app.post("/api/analyze", async (request, reply) => {
    const contentType = request.headers["content-type"] ?? "";

    if (!contentType.includes("multipart/form-data")) {
      return reply.status(400).send({
        error: {
          code: "bad_request",
          message:
            "Send multipart/form-data with a 'log' file field and an optional 'dbc' file field.",
        },
      } satisfies ApiErrorBody);
    }

    let logText = "";
    let dbcText: string | undefined;
    let configText: string | undefined;

    const parts = request.parts();

    for await (const part of parts) {
      if (part.type === "file") {
        const buffer = await part.toBuffer();
        if (buffer.includes(0)) {
          return reply.status(400).send({
            error: {
              code: "invalid_encoding",
              message: `The '${part.fieldname}' upload must be UTF-8 text.`,
            },
          } satisfies ApiErrorBody);
        }
        const text = buffer.toString("utf8");

        if (part.fieldname === "log") {
          if (buffer.length > 32 * 1024 * 1024) {
            return reply.status(413).send({
              error: {
                code: "payload_too_large",
                message: "The CAN log exceeds the maximum size of 32 MiB.",
              },
            } satisfies ApiErrorBody);
          }
          logText = text;
        } else if (part.fieldname === "dbc") {
          if (buffer.length > 4 * 1024 * 1024) {
            return reply.status(413).send({
              error: {
                code: "payload_too_large",
                message: "The DBC file exceeds the maximum size of 4 MiB.",
              },
            } satisfies ApiErrorBody);
          }
          dbcText = text;
        } else {
          part.file.resume();
        }
      } else if (part.fieldname === "config") {
        configText =
          typeof part.value === "string" ? part.value : String(part.value);
      }
    }

    if (logText.trim() === "") {
      return reply.status(400).send({
        error: {
          code: "missing_log",
          message: "A 'log' file field containing a candump log is required.",
        },
      } satisfies ApiErrorBody);
    }

    let detectorConfig: DetectorConfig | undefined;
    let timelineConfig: TimelineConfig | undefined;

    if (configText !== undefined && configText.trim() !== "") {
      let parsedConfig: unknown;
      try {
        parsedConfig = JSON.parse(configText);
      } catch {
        return reply.status(400).send({
          error: {
            code: "invalid_config",
            message: "The 'config' field must contain valid JSON.",
          },
        } satisfies ApiErrorBody);
      }

      if (
        typeof parsedConfig !== "object" ||
        parsedConfig === null ||
        Array.isArray(parsedConfig)
      ) {
        return reply.status(400).send({
          error: {
            code: "invalid_config",
            message: "The 'config' field must contain a JSON object.",
          },
        } satisfies ApiErrorBody);
      }

      const configHolder = parsedConfig as {
        detectors?: unknown;
        timeline?: unknown;
      };
      const detectorValidation = validateDetectorConfig(configHolder.detectors);
      if (!detectorValidation.ok) {
        return reply.status(400).send({
          error: {
            code: "invalid_config",
            message: "The detector configuration is invalid.",
            details: detectorValidation.issues.map(formatIssue),
          },
        } satisfies ApiErrorBody);
      }
      detectorConfig = detectorValidation.value as DetectorConfig | undefined;

      const timelineValidation = validateTimelineConfig(configHolder.timeline);
      if (!timelineValidation.ok) {
        return reply.status(400).send({
          error: {
            code: "invalid_config",
            message: "The timeline configuration is invalid.",
            details: timelineValidation.issues.map(formatIssue),
          },
        } satisfies ApiErrorBody);
      }
      timelineConfig = timelineValidation.value as TimelineConfig | undefined;
    }

    try {
      const result = analyze({
        logText,
        ...(dbcText === undefined ? {} : { dbcText }),
        ...(detectorConfig === undefined ? {} : { detectorConfig }),
        ...(timelineConfig === undefined ? {} : { timelineConfig }),
      });

      const analysisId = randomId();
      store.put(analysisId, result);

      return { analysisId, ...result };
    } catch (error) {
      if (error instanceof AnalysisError) {
        return reply.status(400).send({
          error: {
            code: error.code,
            message: error.message,
            ...(error.details.length > 0 ? { details: error.details } : {}),
          },
        } satisfies ApiErrorBody);
      }
      throw error;
    }
  });

  app.post("/api/narrate", async (request, reply) => {
    const body = request.body as
      | { analysis?: unknown; analysisId?: unknown }
      | undefined;

    if (body === undefined || body === null) {
      return reply.status(400).send({
        error: {
          code: "bad_request",
          message: "Send a JSON body with 'analysis' or 'analysisId'.",
        },
      } satisfies ApiErrorBody);
    }

    let analysis: AnalysisResult | undefined;

    if (typeof body.analysisId === "string") {
      const stored = store.get(body.analysisId);
      if (!stored) {
        return reply.status(404).send({
          error: {
            code: "not_found",
            message:
              "No stored analysis matches that id. Run POST /api/analyze first; stored analyses expire after 10 minutes.",
          },
        } satisfies ApiErrorBody);
      }
      analysis = stored;
    } else if (body.analysis !== undefined) {
      const validation = validateAnalysisResult(body.analysis);
      if (!validation.ok) {
        return reply.status(400).send({
          error: {
            code: "invalid_analysis",
            message: "The supplied analysis object is not a valid analysis result.",
            details: validation.issues.map(formatIssue),
          },
        } satisfies ApiErrorBody);
      }
      analysis = validation.value;
    } else {
      return reply.status(400).send({
        error: {
          code: "bad_request",
          message: "Send a JSON body with 'analysis' or 'analysisId'.",
        },
      } satisfies ApiErrorBody);
    }

    const outcome = await narrate(analysis, {
      ...(options.provider ? { provider: options.provider } : {}),
      env,
    });

    return {
      mode: outcome.mode,
      provider: outcome.provider,
      report: outcome.report,
      warnings: outcome.warnings,
    };
  });

  return app;
}

function formatIssue(issue: ValidationIssue): string {
  return issue.path === ""
    ? issue.message
    : `${issue.path}: ${issue.message}`;
}
