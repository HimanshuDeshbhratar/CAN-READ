import type { AnalysisResult } from "../types";

interface WarningsPanelProps {
  analysis: AnalysisResult;
}

export function WarningsPanel({ analysis }: WarningsPanelProps) {
  const hasWarnings = analysis.warnings.length > 0;
  const hasUnsupported = analysis.unsupported.length > 0;

  if (!hasWarnings && !hasUnsupported) {
    return (
      <div className="quality-ok">
        <span className="status-dot ok" />
        No parsing, decoding, or detector-coverage warnings were reported.
      </div>
    );
  }

  return (
    <details className="warnings" open={hasWarnings || hasUnsupported}>
      <summary>
        Data-quality notes
        <span className="count">
          {analysis.warnings.length + analysis.unsupported.length}
        </span>
      </summary>
      {hasWarnings && (
        <div>
          <h4>Warnings</h4>
          <ul>
            {analysis.warnings.map((warning, index) => (
              <li key={`${index}-${warning.slice(0, 24)}`}>{warning}</li>
            ))}
          </ul>
        </div>
      )}
      {hasUnsupported && (
        <div>
          <h4>Detectors without required signals</h4>
          <ul>
            {analysis.unsupported.map((entry) => (
              <li key={entry.detector}>
                <code>{entry.detector}</code> — {entry.reason}
              </li>
            ))}
          </ul>
        </div>
      )}
    </details>
  );
}
