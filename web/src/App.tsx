import { useCallback, useEffect, useRef, useState } from "react";
import {
  analyzeFiles,
  getHealth,
  loadSampleAnalysis,
  narrateAnalysis,
} from "./api";
import { Dashboard } from "./components/Dashboard";
import { UploadScreen } from "./components/UploadScreen";
import type {
  AnalysisResponse,
  HealthResponse,
  NarrationState,
  TimelineEntry,
  VehicleEvent,
} from "./types";
import { severityRank } from "./utils";

function chooseDefaultEvent(
  analysis: AnalysisResponse,
): VehicleEvent | null {
  if (analysis.events.length === 0) return null;
  return [...analysis.events].sort(
    (a, b) =>
      severityRank(b.severity) - severityRank(a.severity) ||
      a.startTime - b.startTime,
  )[0]!;
}

export default function App() {
  const [analysis, setAnalysis] = useState<AnalysisResponse | null>(null);
  const [selectedEventId, setSelectedEventId] = useState<string | null>(null);
  const [focusRange, setFocusRange] = useState<{
    start: number;
    end: number;
  } | null>(null);
  const [narration, setNarration] = useState<NarrationState>({
    status: "idle",
  });
  const [loading, setLoading] = useState<"upload" | "demo" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [health, setHealth] = useState<HealthResponse | null>(null);
  const [healthStatus, setHealthStatus] = useState<
    "checking" | "online" | "offline"
  >("checking");
  const narrationToken = useRef(0);

  const refreshHealth = useCallback(() => {
    getHealth()
      .then((result) => {
        setHealth(result);
        setHealthStatus("online");
      })
      .catch(() => {
        setHealth(null);
        setHealthStatus("offline");
      });
  }, []);

  useEffect(() => {
    refreshHealth();
  }, [refreshHealth]);

  const selectedEvent =
    analysis?.events.find((event) => event.id === selectedEventId) ?? null;

  const selectedEntry =
    analysis?.timeline.entries.find((entry) =>
      entry.events.some((event) => event.id === selectedEventId),
    ) ?? null;

  async function runNarration(nextAnalysis: AnalysisResponse) {
    const token = ++narrationToken.current;
    setNarration({ status: "loading" });

    try {
      const result = await narrateAnalysis(nextAnalysis);
      if (token === narrationToken.current) {
        setNarration({ status: "ready", data: result });
      }
    } catch (narrationError) {
      if (token === narrationToken.current) {
        setNarration({
          status: "error",
          message:
            narrationError instanceof Error
              ? narrationError.message
              : "The narration request failed.",
        });
      }
    }
  }

  function presentAnalysis(nextAnalysis: AnalysisResponse) {
    setAnalysis(nextAnalysis);
    setSelectedEventId(chooseDefaultEvent(nextAnalysis)?.id ?? null);
    setFocusRange(null);
    setError(null);
    refreshHealth();
    void runNarration(nextAnalysis);
  }

  async function handleUpload(logFile: File, dbcFile: File | null) {
    setLoading("upload");
    setError(null);
    try {
      const result = await analyzeFiles(logFile, dbcFile);
      presentAnalysis(result);
    } catch (uploadError) {
      setError(
        uploadError instanceof Error
          ? uploadError.message
          : "The log could not be analyzed.",
      );
    } finally {
      setLoading(null);
    }
  }

  async function handleDemo() {
    setLoading("demo");
    setError(null);
    try {
      const result = await loadSampleAnalysis();
      presentAnalysis(result);
    } catch (demoError) {
      setError(
        demoError instanceof Error
          ? demoError.message
          : "The demo analysis could not be loaded.",
      );
    } finally {
      setLoading(null);
    }
  }

  function handleSelectEvent(event: VehicleEvent, _entry: TimelineEntry) {
    setSelectedEventId(event.id);
    setFocusRange({ start: event.startTime, end: event.endTime });
  }

  function handleSelectEntry(entry: TimelineEntry) {
    const event = entry.events[0];
    if (!event) return;
    setSelectedEventId(event.id);
    setFocusRange({ start: entry.startTime, end: entry.endTime });
  }

  function reset() {
    narrationToken.current++;
    setAnalysis(null);
    setSelectedEventId(null);
    setFocusRange(null);
    setNarration({ status: "idle" });
    setError(null);
  }

  return (
    <div className="app">
      <header className="topbar">
        <div className="brand">
          <span className="brand-mark" aria-hidden="true">
            <span />
            <span />
          </span>
          <div>
            <strong>CAN Log Narrator</strong>
            <small>Evidence-first vehicle log analysis</small>
          </div>
        </div>

        <div className="topbar-actions">
          <span
            className={`system-status ${healthStatus}`}
            title={
              healthStatus === "online"
                ? "Analysis API reachable"
                : healthStatus === "checking"
                  ? "Checking the analysis API"
                  : "Analysis API not reachable"
            }
          >
            <span className="status-dot" />
            {healthStatus === "checking"
              ? "Checking API…"
              : healthStatus === "online"
                ? "API online"
                : "API offline"}
          </span>
          {health?.narration.configured ? (
            <span className="system-status ai">AI ready</span>
          ) : (
            <span className="system-status">Fallback narration</span>
          )}
          {analysis && (
            <button type="button" className="button ghost" onClick={reset}>
              New analysis
            </button>
          )}
        </div>
      </header>

      {analysis ? (
        <Dashboard
          analysis={analysis}
          selectedEvent={selectedEvent}
          selectedEntry={selectedEntry}
          focusRange={focusRange}
          narration={narration}
          onSelectEntry={handleSelectEntry}
          onSelectEvent={handleSelectEvent}
          onClearFocus={() => setFocusRange(null)}
          onRetryNarration={() => void runNarration(analysis)}
        />
      ) : (
        <UploadScreen
          onAnalyze={(logFile, dbcFile) => void handleUpload(logFile, dbcFile)}
          onDemo={() => void handleDemo()}
          loading={loading !== null}
          loadingMode={loading}
          error={error}
        />
      )}

      <footer className="footer">
        <span>
          Deterministic detection · evidence-linked timeline · cautious
          narration
        </span>
        <span>
          Demo data is synthetic, not a real vehicle recording.
        </span>
      </footer>
    </div>
  );
}
