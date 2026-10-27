import { useRef, useState, type DragEvent } from "react";

interface UploadScreenProps {
  onAnalyze: (logFile: File, dbcFile: File | null) => void;
  onDemo: () => void;
  loading: boolean;
  loadingMode: "upload" | "demo" | null;
  error: string | null;
}

const MAX_LOG_BYTES = 32 * 1024 * 1024;
const MAX_DBC_BYTES = 4 * 1024 * 1024;

export function UploadScreen({
  onAnalyze,
  onDemo,
  loading,
  loadingMode,
  error,
}: UploadScreenProps) {
  const [logFile, setLogFile] = useState<File | null>(null);
  const [dbcFile, setDbcFile] = useState<File | null>(null);
  const [localError, setLocalError] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);
  const logInput = useRef<HTMLInputElement>(null);

  function chooseLog(file: File | undefined) {
    if (!file) return;
    if (file.size > MAX_LOG_BYTES) {
      setLocalError("The CAN log is larger than the 32 MiB upload limit.");
      return;
    }
    setLocalError(null);
    setLogFile(file);
  }

  function chooseDbc(file: File | undefined) {
    if (!file) return;
    if (file.size > MAX_DBC_BYTES) {
      setLocalError("The DBC file is larger than the 4 MiB upload limit.");
      return;
    }
    setLocalError(null);
    setDbcFile(file);
  }

  function handleDrop(event: DragEvent<HTMLDivElement>) {
    event.preventDefault();
    setDragging(false);
    const file = event.dataTransfer.files[0];
    chooseLog(file);
  }

  function submit() {
    if (!logFile) {
      setLocalError("Choose a candump log before starting the analysis.");
      return;
    }
    onAnalyze(logFile, dbcFile);
  }

  return (
    <main className="landing">
      <section className="hero">
        <div className="eyebrow">
          <span className="signal-dot" /> CAN bus analysis workspace
        </div>
        <h1>
          CAN Log <span>Narrator</span>
        </h1>
        <p className="hero-copy">
          Turn a raw candump log into a chronological, evidence-backed account
          of what the vehicle did. Signals are decoded with your DBC, events are
          detected deterministically, and every conclusion links back to measured
          values.
        </p>

        <div className="hero-actions">
          <button
            className="button primary large"
            type="button"
            onClick={onDemo}
            disabled={loading}
          >
            {loadingMode === "demo" ? "Running demo…" : "Try demo drive"}
          </button>
          <span className="hero-note">
            Uses the bundled 60-second synthetic drive. No API key required.
          </span>
        </div>

        <div className="format-grid">
          <div>
            <h3>CAN log</h3>
            <p>
              candump text: <code>(timestamp)&nbsp;channel&nbsp;ID#DATA</code>.
              Standard 11-bit and extended 29-bit IDs, classic CAN payloads up to
              8 bytes.
            </p>
          </div>
          <div>
            <h3>DBC</h3>
            <p>
              Optional. Little-endian signals, scaling, offsets, signed values,
              units, and value tables. Big-endian and multiplexed signals are
              reported as unsupported.
            </p>
          </div>
          <div>
            <h3>Limits</h3>
            <p>
              32 MiB log, 4 MiB DBC. Files are processed in memory and are never
              stored permanently or executed.
            </p>
          </div>
        </div>
      </section>

      <section className="upload-card">
        <div className="card-heading">
          <span className="step">01</span>
          <div>
            <h2>Analyze a log</h2>
            <p>Upload a candump log and, optionally, its DBC definitions.</p>
          </div>
        </div>

        <div
          className={`dropzone${dragging ? " dragging" : ""}`}
          onDragOver={(event) => {
            event.preventDefault();
            setDragging(true);
          }}
          onDragLeave={() => setDragging(false)}
          onDrop={handleDrop}
          onClick={() => logInput.current?.click()}
          role="button"
          tabIndex={0}
          onKeyDown={(event) => {
            if (event.key === "Enter" || event.key === " ") {
              logInput.current?.click();
            }
          }}
        >
          <input
            ref={logInput}
            type="file"
            accept=".log,.txt,.candump"
            hidden
            onChange={(event) => chooseLog(event.target.files?.[0])}
          />
          <span className="drop-icon">↓</span>
          <strong>{logFile ? logFile.name : "Drop a candump log here"}</strong>
          <span>
            {logFile
              ? `${(logFile.size / 1024).toFixed(1)} KiB selected`
              : "or click to browse · .log, .txt"}
          </span>
        </div>

        <label className="file-row">
          <span>
            <strong>DBC file</strong>
            <small>Optional — required to decode signals</small>
          </span>
          <span className="file-action">
            {dbcFile ? dbcFile.name : "Choose DBC"}
            <input
              type="file"
              accept=".dbc,.txt"
              hidden
              onChange={(event) => chooseDbc(event.target.files?.[0])}
            />
          </span>
        </label>

        {(localError || error) && (
          <div className="callout danger" role="alert">
            {localError ?? error}
          </div>
        )}

        <button
          className="button primary full"
          type="button"
          onClick={submit}
          disabled={loading}
        >
          {loadingMode === "upload" ? "Analyzing…" : "Analyze log"}
        </button>
        <p className="fineprint">
          The analysis runs on the local API at <code>/api/analyze</code>. Nothing
          is sent to a model unless narration is enabled on the server.
        </p>
      </section>
    </main>
  );
}
