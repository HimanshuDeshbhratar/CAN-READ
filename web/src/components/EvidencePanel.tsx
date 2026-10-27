import type { TimelineEntry, VehicleEvent } from "../types";
import {
  confidenceLabel,
  defaultDetectionRule,
  eventTypeLabel,
  formatEvidenceValue,
  formatRange,
  formatTime,
} from "../utils";

interface EvidencePanelProps {
  event: VehicleEvent | null;
  entry: TimelineEntry | null;
}

export function EvidencePanel({ event, entry }: EvidencePanelProps) {
  if (!event) {
    return (
      <section className="panel evidence-panel">
        <div className="panel-heading">
          <div>
            <span className="section-kicker">Traceability</span>
            <h2>Event evidence</h2>
          </div>
        </div>
        <div className="empty-state">
          <strong>Select an event.</strong>
          <p>
            Choose a detection from the timeline to inspect its measured values,
            detection rule, and limitations.
          </p>
        </div>
      </section>
    );
  }

  const confidence = confidenceLabel(event.confidence);
  const rule = event.detectionRule ?? defaultDetectionRule(event.type);
  const related = entry?.events.filter((entryEvent) => entryEvent.id !== event.id) ?? [];

  return (
    <section className="panel evidence-panel">
      <div className="panel-heading">
        <div>
          <span className="section-kicker">Traceability</span>
          <h2>Event evidence</h2>
        </div>
        <span className={`severity ${event.severity}`}>{event.severity}</span>
      </div>

      <div className="evidence-header">
        <div>
          <h3>{event.title}</h3>
          <p className="muted">
            {eventTypeLabel(event.type)} · {formatRange(event.startTime, event.endTime)}
            {confidence ? ` · confidence ${confidence}` : ""}
          </p>
        </div>
        <code>{event.type}</code>
      </div>

      <p className="evidence-summary">{event.summary}</p>

      <div className="rule-box">
        <span className="rule-label">Detection rule</span>
        <p>{rule}</p>
      </div>

      <h4>Measured and derived values</h4>
      <div className="table-wrap">
        <table className="evidence-table">
          <thead>
            <tr>
              <th>Time</th>
              <th>Signal</th>
              <th>Value</th>
              <th>Why it matters</th>
            </tr>
          </thead>
          <tbody>
            {event.evidence.map((item, index) => {
              const derived =
                item.signalName.includes("derived") ||
                item.unit === "m/s²" ||
                item.unit === "Hz";
              return (
                <tr key={`${item.signalName}-${item.timestamp}-${index}`}>
                  <td className="mono">{formatTime(item.timestamp)}</td>
                  <td>
                    {item.signalName}
                    {derived && <span className="derived-tag">derived</span>}
                  </td>
                  <td className="mono">
                    {formatEvidenceValue(item.value)}
                    {item.unit ? ` ${item.unit}` : ""}
                  </td>
                  <td>{item.description}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {related.length > 0 && (
        <div className="related">
          <h4>Correlated detections</h4>
          <ul>
            {related.map((relatedEvent) => (
              <li key={relatedEvent.id}>
                <span className={`severity-dot ${relatedEvent.severity}`} />
                <strong>{relatedEvent.title}</strong>
                <span className="muted">
                  {" "}
                  · {formatRange(relatedEvent.startTime, relatedEvent.endTime)}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="limitations">
        <h4>Limitations</h4>
        <ul>
          {event.limitations.map((limitation, index) => (
            <li key={`${index}-${limitation.slice(0, 24)}`}>{limitation}</li>
          ))}
        </ul>
      </div>
    </section>
  );
}
