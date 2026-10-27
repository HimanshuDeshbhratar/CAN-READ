import type { TimelineEntry, VehicleEvent } from "../types";
import {
  confidenceLabel,
  eventTypeLabel,
  formatRange,
  formatTime,
} from "../utils";

interface TimelinePanelProps {
  entries: TimelineEntry[];
  summary: string;
  selectedEventId: string | null;
  onSelectEntry: (entry: TimelineEntry) => void;
  onSelectEvent: (event: VehicleEvent, entry: TimelineEntry) => void;
}

function severityClass(severity: string): string {
  return severity === "critical"
    ? "critical"
    : severity === "warning"
      ? "warning"
      : "info";
}

export function TimelinePanel({
  entries,
  summary,
  selectedEventId,
  onSelectEntry,
  onSelectEvent,
}: TimelinePanelProps) {
  return (
    <aside className="panel timeline-panel">
      <div className="panel-heading">
        <div>
          <span className="section-kicker">Chronology</span>
          <h2>Timeline</h2>
        </div>
        <span className="count-pill">{entries.length} episodes</span>
      </div>
      <p className="panel-lede">{summary}</p>

      {entries.length === 0 ? (
        <div className="empty-state">
          <strong>No events detected.</strong>
          <p>
            The log decoded successfully, but no detector crossed its threshold.
          </p>
        </div>
      ) : (
        <div className="timeline-list">
          {entries.map((entry) => (
            <article
              className="timeline-card"
              key={entry.id}
              onClick={() => onSelectEntry(entry)}
            >
              <div className="timeline-meta">
                <span className={`severity ${severityClass(entry.severity)}`}>
                  {entry.severity}
                </span>
                <span className="time-range">
                  {formatRange(entry.startTime, entry.endTime)}
                </span>
              </div>
              <h3>{entry.title}</h3>
              <p>{entry.summary}</p>

              <ul className="event-list">
                {entry.events.map((event) => {
                  const confidence = confidenceLabel(event.confidence);
                  const active = event.id === selectedEventId;
                  return (
                    <li
                      className={`event-row${active ? " selected" : ""}`}
                      key={event.id}
                    >
                      <div className="event-body">
                        <button
                          type="button"
                          className="event-main"
                          onClick={(clickEvent) => {
                            clickEvent.stopPropagation();
                            onSelectEvent(event, entry);
                          }}
                        >
                          <span
                            className={`severity-dot ${severityClass(event.severity)}`}
                          />
                          <span className="event-copy">
                            <strong>{event.title}</strong>
                            <small>
                              {eventTypeLabel(event.type)} · {event.severity} ·{" "}
                              {formatTime(event.startTime)}
                            </small>
                          </span>
                          {confidence && (
                            <span
                              className="confidence"
                              title="Heuristic detector confidence, not a calibrated probability"
                            >
                              {confidence}
                            </span>
                          )}
                        </button>
                        <p
                          className="event-summary"
                          onClick={(clickEvent) => {
                            clickEvent.stopPropagation();
                            onSelectEvent(event, entry);
                          }}
                        >
                          {event.summary}
                        </p>
                      </div>
                      <button
                        type="button"
                        className="inspect"
                        onClick={(clickEvent) => {
                          clickEvent.stopPropagation();
                          onSelectEvent(event, entry);
                        }}
                      >
                        Inspect evidence
                      </button>
                    </li>
                  );
                })}
              </ul>
            </article>
          ))}
        </div>
      )}
    </aside>
  );
}
