import { useEffect, useMemo, useState } from "react";
import {
  CartesianGrid,
  Line,
  LineChart,
  ReferenceArea,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import type { AnalysisResult, SignalSeries } from "../types";
import { seriesKey } from "../utils";

interface SignalExplorerProps {
  analysis: AnalysisResult;
  focusRange: { start: number; end: number } | null;
  onClearFocus: () => void;
}

interface ChartPoint {
  t: number;
  value: number | null;
}

const COLORS = ["#5eead4", "#fbbf24", "#93c5fd", "#fda4af", "#c4b5fd"];

function median(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1
    ? sorted[middle]!
    : (sorted[middle - 1]! + sorted[middle]!) / 2;
}

function buildChartData(series: SignalSeries): ChartPoint[] {
  const points = series.points;
  if (points.length < 2) {
    return points.map((point) => ({ t: point.t, value: point.value }));
  }

  const intervals: number[] = [];
  for (let i = 1; i < points.length; i++) {
    const interval = points[i]!.t - points[i - 1]!.t;
    if (interval > 0) intervals.push(interval);
  }
  const gapThreshold = Math.max(median(intervals) * 4, 0.25);

  const data: ChartPoint[] = [];
  for (let i = 0; i < points.length; i++) {
    const point = points[i]!;
    data.push({ t: point.t, value: point.value });

    const next = points[i + 1];
    if (next && next.t - point.t > gapThreshold) {
      data.push({ t: point.t + (next.t - point.t) / 2, value: null });
    }
  }
  return data;
}

function isDiscrete(series: SignalSeries): boolean {
  return (
    series.length <= 4 ||
    series.points.some((point) => point.label !== undefined) ||
    /active|gear|state|switch/i.test(series.signalName)
  );
}

export function SignalExplorer({
  analysis,
  focusRange,
  onClearFocus,
}: SignalExplorerProps) {
  const duration = Math.max(analysis.statistics.logDurationSec, 0.01);
  const available = useMemo(
    () => analysis.series.filter((series) => series.points.length > 0),
    [analysis.series],
  );
  const [selectedKeys, setSelectedKeys] = useState<string[]>([]);
  const [viewRange, setViewRange] = useState<[number, number]>([0, duration]);

  useEffect(() => {
    const preferred =
      available.find((series) => /speed/i.test(series.signalName)) ??
      available[0];
    setSelectedKeys(preferred ? [seriesKey(preferred)] : []);
    setViewRange([0, duration]);
  }, [available, duration]);

  useEffect(() => {
    if (!focusRange) return;
    const padding = Math.max(1, (focusRange.end - focusRange.start) * 0.25);
    const start = Math.max(0, focusRange.start - padding);
    const end = Math.min(duration, focusRange.end + padding);
    if (end > start) setViewRange([start, end]);
  }, [focusRange, duration]);

  function toggleSeries(series: SignalSeries) {
    const key = seriesKey(series);
    if (selectedKeys.includes(key)) {
      setSelectedKeys(selectedKeys.filter((entry) => entry !== key));
    } else if (selectedKeys.length < 3) {
      setSelectedKeys([...selectedKeys, key]);
    }
  }

  function updateStart(value: number) {
    setViewRange([Math.min(value, viewRange[1] - 0.1), viewRange[1]]);
  }

  function updateEnd(value: number) {
    setViewRange([viewRange[0], Math.max(value, viewRange[0] + 0.1)]);
  }

  function resetRange() {
    setViewRange([0, duration]);
    onClearFocus();
  }

  const selectedSeries = selectedKeys
    .map((key) => available.find((series) => seriesKey(series) === key))
    .filter((series): series is SignalSeries => series !== undefined);

  return (
    <section className="panel signal-panel">
      <div className="panel-heading">
        <div>
          <span className="section-kicker">Signals</span>
          <h2>Signal explorer</h2>
        </div>
        <span className="count-pill">
          {available.length} series · up to 3 shown
        </span>
      </div>

      {available.length === 0 ? (
        <div className="empty-state">
          <strong>No decoded signal series.</strong>
          <p>
            Upload a DBC that matches the log to decode signals and render
            time-series charts.
          </p>
        </div>
      ) : (
        <>
          <div className="signal-picker" aria-label="Select signals">
            {available.map((series) => {
              const key = seriesKey(series);
              const selected = selectedKeys.includes(key);
              const disabled = !selected && selectedKeys.length >= 3;
              return (
                <button
                  key={key}
                  type="button"
                  className={`signal-chip${selected ? " selected" : ""}`}
                  aria-pressed={selected}
                  disabled={disabled}
                  onClick={() => toggleSeries(series)}
                  title={`${series.messageName}.${series.signalName}`}
                >
                  <span>{series.signalName}</span>
                  <small>
                    {series.messageName}
                    {series.unit ? ` · ${series.unit}` : ""}
                  </small>
                </button>
              );
            })}
          </div>

          <div className="range-controls">
            <label>
              <span>From {viewRange[0].toFixed(2)} s</span>
              <input
                type="range"
                min={0}
                max={duration}
                step={0.01}
                value={viewRange[0]}
                onChange={(event) => updateStart(Number(event.target.value))}
              />
            </label>
            <label>
              <span>To {viewRange[1].toFixed(2)} s</span>
              <input
                type="range"
                min={0}
                max={duration}
                step={0.01}
                value={viewRange[1]}
                onChange={(event) => updateEnd(Number(event.target.value))}
              />
            </label>
            <button type="button" className="button ghost" onClick={resetRange}>
              Reset range
            </button>
          </div>

          <p className="chart-note">
            Line breaks mark gaps between samples; values are never interpolated.
            {focusRange
              ? ` Event focus: ${focusRange.start.toFixed(2)}–${focusRange.end.toFixed(2)} s.`
              : ""}
          </p>

          {selectedSeries.length === 0 ? (
            <div className="empty-state compact">
              Select one or more signals to chart.
            </div>
          ) : (
            <div className="charts">
              {selectedSeries.map((series, index) => {
                const data = buildChartData(series);
                const discrete = isDiscrete(series);
                return (
                  <div className="chart-card" key={seriesKey(series)}>
                    <div className="chart-heading">
                      <div>
                        <strong>{series.signalName}</strong>
                        <small>
                          {series.messageName}
                          {series.unit ? ` · ${series.unit}` : " · unitless"}
                        </small>
                      </div>
                      <span className="count-pill">
                        {series.totalPoints} samples
                      </span>
                    </div>
                    {series.truncated && (
                      <p className="chart-warning">
                        Showing the first {series.points.length} of{" "}
                        {series.totalPoints} samples to keep the dashboard
                        responsive.
                      </p>
                    )}
                    <div className="chart-wrap">
                      <ResponsiveContainer width="100%" height={230}>
                        <LineChart
                          data={data}
                          margin={{ top: 8, right: 18, bottom: 4, left: 10 }}
                        >
                          <CartesianGrid
                            strokeDasharray="3 3"
                            stroke="rgba(148, 163, 184, 0.16)"
                          />
                          <XAxis
                            dataKey="t"
                            type="number"
                            domain={viewRange}
                            allowDataOverflow
                            tickFormatter={(value) =>
                              `${Number(value).toFixed(0)}s`
                            }
                            stroke="#64748b"
                            tick={{ fill: "#94a3b8", fontSize: 11 }}
                            tickCount={6}
                          />
                          <YAxis
                            stroke="#64748b"
                            tick={{ fill: "#94a3b8", fontSize: 11 }}
                            width={64}
                            domain={["auto", "auto"]}
                          />
                          <Tooltip
                            cursor={{ stroke: "rgba(148, 163, 184, 0.4)" }}
                            contentStyle={{
                              background: "#0b1220",
                              border: "1px solid rgba(148, 163, 184, 0.25)",
                              borderRadius: 10,
                              color: "#e2e8f0",
                              fontSize: 12,
                            }}
                            labelFormatter={(label) =>
                              `t = ${Number(label).toFixed(2)} s`
                            }
                            formatter={(value) => {
                              const display =
                                typeof value === "number"
                                  ? Math.round(value * 100) / 100
                                  : value;
                              return [
                                series.unit
                                  ? `${String(display)} ${series.unit}`
                                  : String(display),
                                series.signalName,
                              ];
                            }}
                          />
                          {focusRange && (
                            <ReferenceArea
                              x1={focusRange.start}
                              x2={focusRange.end}
                              fill="#fbbf24"
                              fillOpacity={0.12}
                              strokeOpacity={0}
                            />
                          )}
                          <Line
                            type={discrete ? "stepAfter" : "monotone"}
                            dataKey="value"
                            name={series.signalName}
                            stroke={COLORS[index % COLORS.length] ?? "#5eead4"}
                            strokeWidth={2}
                            dot={series.points.length <= 2 ? { r: 3 } : false}
                            connectNulls={false}
                            isAnimationActive={false}
                          />
                        </LineChart>
                      </ResponsiveContainer>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </>
      )}
    </section>
  );
}
