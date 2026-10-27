import type {
  AnalysisResponse,
  HealthResponse,
  NarrationResponse,
} from "./types";

const API_BASE = (import.meta.env["VITE_API_BASE_URL"] ?? "").replace(/\/$/, "");

export class ApiError extends Error {
  readonly code: string;
  readonly status: number;
  readonly details: string[];

  constructor(
    message: string,
    code = "request_failed",
    status = 0,
    details: string[] = [],
  ) {
    super(message);
    this.name = "ApiError";
    this.code = code;
    this.status = status;
    this.details = details;
  }
}

async function readError(response: Response): Promise<ApiError> {
  let message = `Request failed with HTTP ${response.status}.`;
  let code = "request_failed";
  let details: string[] = [];

  try {
    const body = (await response.json()) as {
      error?: { code?: string; message?: string; details?: string[] };
    };
    if (body.error?.message) message = body.error.message;
    if (body.error?.code) code = body.error.code;
    if (Array.isArray(body.error?.details)) details = body.error.details;
  } catch {
    // Keep the generic message when the body is not JSON.
  }

  return new ApiError(message, code, response.status, details);
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  let response: Response;

  try {
    response = await fetch(`${API_BASE}${path}`, {
      ...init,
      signal: AbortSignal.timeout(120_000),
    });
  } catch (error) {
    throw new ApiError(
      error instanceof Error
        ? `Could not reach the analysis API: ${error.message}`
        : "Could not reach the analysis API.",
      "network_error",
    );
  }

  if (!response.ok) throw await readError(response);
  return (await response.json()) as T;
}

export function analyzeFiles(
  logFile: File,
  dbcFile: File | null,
): Promise<AnalysisResponse> {
  const form = new FormData();
  form.append("log", logFile, logFile.name);
  if (dbcFile) form.append("dbc", dbcFile, dbcFile.name);

  return request<AnalysisResponse>("/api/analyze", {
    method: "POST",
    body: form,
  });
}

export function loadSampleAnalysis(): Promise<AnalysisResponse> {
  return request<AnalysisResponse>("/api/sample/analysis");
}

export function narrateAnalysis(
  analysis: AnalysisResponse,
): Promise<NarrationResponse> {
  const body = analysis.analysisId
    ? { analysisId: analysis.analysisId }
    : { analysis };

  return request<NarrationResponse>("/api/narrate", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

export function getHealth(): Promise<HealthResponse> {
  return request<HealthResponse>("/api/health");
}
