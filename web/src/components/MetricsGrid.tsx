import { formatDuration, formatNumber } from "../utils";
import type { AnalysisResult } from "../types";

interface MetricsGridProps {
  analysis: AnalysisResult;
}

interface MetricProps {
  label: string;
  value: string;
  detail: string;
  tone?: "default" | "good" | "warn" | "danger";
}

function Metric({ label, value, detail, tone = "default" }: MetricProps) {
  return (
    <div className={`metric ${tone}`}>
      <span className="metric-label">{label}</span>
      <strong className="metric-value">{value}</strong>
      <span className="metric-detail">{detail}</span>
    </div>
  );
}

export function MetricsGrid({ analysis }: MetricsGridProps) {
  const decodedPercent =
    analysis.statistics.totalFrames > 0
      ? (analysis.statistics.decodedFrames / analysis.statistics.totalFrames) *
        100
      : 0;

  const unknownFrameCount = analysis.unknownIds.reduce(
    (total, entry) => total + entry.count,
    0,
  );

  const warningCount =
    analysis.warnings.length + analysis.unsupported.length;

  return (
    <section className="metrics" aria-label="Analysis overview">
      <Metric
        label="Total CAN frames"
        value={formatNumber(analysis.statistics.totalFrames)}
        detail={`${formatNumber(analysis.statistics.skippedFrames)} skipped`}
      />
      <Metric
        label="Decoded frames"
        value={formatNumber(analysis.statistics.decodedFrames)}
        detail={`${decodedPercent.toFixed(1)}% of the log`}
        tone="good"
      />
      <Metric
        label="Unknown CAN IDs"
        value={formatNumber(analysis.unknownIds.length)}
        detail={`${formatNumber(unknownFrameCount)} frames undecoded`}
        tone={analysis.unknownIds.length > 0 ? "warn" : "default"}
      />
      <Metric
        label="Log duration"
        value={formatDuration(analysis.statistics.logDurationSec)}
        detail={`${formatNumber(analysis.statistics.messageCount)} messages · ${formatNumber(analysis.statistics.signalCount)} signals`}
      />
      <Metric
        label="Detected events"
        value={formatNumber(analysis.events.length)}
        detail={`${formatNumber(analysis.timeline.entries.length)} timeline episodes`}
      />
      <Metric
        label="Data-quality warnings"
        value={formatNumber(warningCount)}
        detail={`${formatNumber(analysis.unsupported.length)} unsupported detectors`}
        tone={warningCount > 0 ? "warn" : "good"}
      />
    </section>
  );
}
