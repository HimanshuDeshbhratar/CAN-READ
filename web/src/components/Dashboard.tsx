import type {
  AnalysisResponse,
  NarrationState,
  TimelineEntry,
  VehicleEvent,
} from "../types";
import { EvidencePanel } from "./EvidencePanel";
import { MetricsGrid } from "./MetricsGrid";
import { NarrativePanel } from "./NarrativePanel";
import { SignalExplorer } from "./SignalExplorer";
import { TimelinePanel } from "./TimelinePanel";
import { WarningsPanel } from "./WarningsPanel";

interface DashboardProps {
  analysis: AnalysisResponse;
  selectedEvent: VehicleEvent | null;
  selectedEntry: TimelineEntry | null;
  focusRange: { start: number; end: number } | null;
  narration: NarrationState;
  onSelectEntry: (entry: TimelineEntry) => void;
  onSelectEvent: (event: VehicleEvent, entry: TimelineEntry) => void;
  onClearFocus: () => void;
  onRetryNarration: () => void;
}

export function Dashboard({
  analysis,
  selectedEvent,
  selectedEntry,
  focusRange,
  narration,
  onSelectEntry,
  onSelectEvent,
  onClearFocus,
  onRetryNarration,
}: DashboardProps) {
  return (
    <main className="dashboard">
      <div className="dashboard-title">
        <div>
          <span className="section-kicker">Analysis workspace</span>
          <h1>Drive analysis</h1>
        </div>
        <span className={`source-badge ${analysis.source === "bundled-sample" ? "demo" : ""}`}>
          {analysis.source === "bundled-sample"
            ? "Synthetic demo drive"
            : "Uploaded log"}
        </span>
      </div>

      <MetricsGrid analysis={analysis} />
      <WarningsPanel analysis={analysis} />

      <div className="dashboard-grid">
        <TimelinePanel
          entries={analysis.timeline.entries}
          summary={analysis.timeline.summary}
          selectedEventId={selectedEvent?.id ?? null}
          onSelectEntry={onSelectEntry}
          onSelectEvent={onSelectEvent}
        />

        <div className="dashboard-main">
          <SignalExplorer
            analysis={analysis}
            focusRange={focusRange}
            onClearFocus={onClearFocus}
          />
          <EvidencePanel event={selectedEvent} entry={selectedEntry} />
        </div>
      </div>

      <NarrativePanel
        analysis={analysis}
        narration={narration}
        onRetry={onRetryNarration}
      />
    </main>
  );
}
