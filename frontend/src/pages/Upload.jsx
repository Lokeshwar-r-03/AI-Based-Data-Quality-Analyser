import React, { useState, useEffect } from "react";
import { UploadCloud, FileText, FileSpreadsheet, Play, AlertTriangle, Trash2 } from "lucide-react";
import { uploadDataset, fetchProfile, startAnalysis, loadSampleDataset, fetchDatasetPreview, fetchRecentAnalyses, deleteAnalysis } from "../api/client";

export default function Upload({ onAnalysisStarted, showToast, user, onRestoreAnalysis }) {
  const [file, setFile] = useState(null);
  const [loading, setLoading] = useState(false);
  const [dataset, setDataset] = useState(null);
  const [profile, setProfile] = useState(null);
  const [previewData, setPreviewData] = useState(null);
  const [error, setError] = useState("");
  const [isDragActive, setIsDragActive] = useState(false);
  
  const [uploadProgress, setUploadProgress] = useState(0);
  const [isUploading, setIsUploading] = useState(false);

  const [recentUploads, setRecentUploads] = useState([]);
  const [loadingRecent, setLoadingRecent] = useState(false);

  const fetchRecent = async () => {
    if (!user) return;
    setLoadingRecent(true);
    try {
      const list = await fetchRecentAnalyses();
      setRecentUploads(list);
    } catch (err) {
      console.error("Failed to fetch recent uploads:", err);
    } finally {
      setLoadingRecent(false);
    }
  };

  useEffect(() => {
    fetchRecent();
  }, [user]);

  const handleDragOver = (e) => {
    e.preventDefault();
    setIsDragActive(true);
  };

  const handleDragLeave = () => {
    setIsDragActive(false);
  };

  const processFile = async (selectedFile) => {
    setError("");
    setProfile(null);
    setDataset(null);
    setPreviewData(null);
    setIsDragActive(false);

    const ext = selectedFile.name.split(".").pop().toLowerCase();
    if (ext !== "csv" && ext !== "xlsx") {
      showToast("Only CSV and XLSX files are supported", "warning");
      setError("FILE COMPATIBILITY ERROR: Only CSV and XLSX file formats are supported.");
      return;
    }

    if (selectedFile.size > 25 * 1024 * 1024) {
      showToast("File size exceeds 25MB limit", "error");
      setError("SIZE LIMIT EXCEEDED: File size exceeds the maximum limit of 25MB.");
      return;
    }

    setFile(selectedFile);
    setIsUploading(true);
    setUploadProgress(0);

    // Simulate progress smoothly
    let progress = 0;
    const progressInterval = setInterval(() => {
      progress += Math.floor(Math.random() * 15) + 8;
      if (progress >= 95) {
        clearInterval(progressInterval);
        setUploadProgress(95);
      } else {
        setUploadProgress(progress);
      }
    }, 100);

    try {
      const datasetData = await uploadDataset(selectedFile);
      const [preview, profileData] = await Promise.all([
        fetchDatasetPreview(datasetData.dataset_id),
        fetchProfile(datasetData.dataset_id)
      ]);

      // Complete the progress animation
      clearInterval(progressInterval);
      setUploadProgress(100);
      
      // Delay slightly for smooth transitions
      setTimeout(() => {
        if (datasetData.row_count > 50000) {
          setError(`This file has ${datasetData.row_count.toLocaleString()} rows, which exceeds the 50,000-row limit. Please upload a smaller file or split it into batches.`);
          setFile(null);
          setIsUploading(false);
        } else {
          setDataset(datasetData);
          setPreviewData(preview);
          setProfile(profileData.columns);
          setIsUploading(false);
          showToast("Dataset uploaded successfully", "success");
        }
      }, 400);

    } catch (err) {
      clearInterval(progressInterval);
      setIsUploading(false);
      showToast("Upload failed, please try again", "error");
      setError(err.message || "Failed to load and profile dataset structure.");
    }
  };

  const handleLoadSample = async () => {
    setError("");
    setProfile(null);
    setDataset(null);
    setPreviewData(null);
    setIsUploading(true);
    setUploadProgress(0);

    let progress = 0;
    const progressInterval = setInterval(() => {
      progress += Math.floor(Math.random() * 25) + 12;
      if (progress >= 95) {
        clearInterval(progressInterval);
        setUploadProgress(95);
      } else {
        setUploadProgress(progress);
      }
    }, 70);

    try {
      const datasetData = await loadSampleDataset();
      const [preview, profileData] = await Promise.all([
        fetchDatasetPreview(datasetData.dataset_id),
        fetchProfile(datasetData.dataset_id)
      ]);

      clearInterval(progressInterval);
      setUploadProgress(100);

      setTimeout(() => {
        if (datasetData.row_count > 50000) {
          setError(`This file has ${datasetData.row_count.toLocaleString()} rows, which exceeds the 50,000-row limit. Please upload a smaller file or split it into batches.`);
          setIsUploading(false);
        } else {
          setDataset(datasetData);
          setPreviewData(preview);
          setProfile(profileData.columns);
          setIsUploading(false);
          showToast("Dataset uploaded successfully", "success");
        }
      }, 400);

    } catch (err) {
      clearInterval(progressInterval);
      setIsUploading(false);
      showToast("Upload failed, please try again", "error");
      setError(err.message || "Failed to load sample dataset");
    }
  };

  const handleDrop = (e) => {
    e.preventDefault();
    if (e.dataTransfer.files && e.dataTransfer.files[0]) {
      processFile(e.dataTransfer.files[0]);
    }
  };

  const handleFileChange = (e) => {
    if (e.target.files && e.target.files[0]) {
      processFile(e.target.files[0]);
    }
  };

  const handleRunAnalysis = async () => {
    if (!dataset) return;
    setLoading(true);
    try {
      const res = await startAnalysis(dataset.dataset_id);
      onAnalysisStarted(res.analysis_id, dataset);
    } catch (err) {
      showToast("Failed to initiate data quality scanner", "error");
      setError(err.message || "Failed to initiate data quality scanner.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="max-w-4xl mx-auto py-6 px-4">

      {/* ── Hero intro ── */}
      {(!previewData || !dataset) && (
        <div className="text-center mb-10 space-y-5">
          {/* Badge */}
          <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-blue-500/10 border border-blue-500/20 text-xs font-semibold text-blue-400">
            <span>✦</span>
            <span>AI-Powered · Multi-Layer · Context-Aware</span>
          </div>

          {/* Headline */}
          <h1 className="text-3xl sm:text-4xl font-extrabold tracking-tight text-slate-100 font-mono leading-tight max-w-2xl mx-auto">
            Turn messy spreadsheets into <span className="text-brand-400">clean, explained data.</span>
          </h1>
          <p className="text-slate-400 text-xs sm:text-sm max-w-2xl mx-auto leading-relaxed font-sans">
            Upload a CSV or Excel file. DataSetIQ profiles every column, scores each issue with deterministic statistics, and uses AI to explain what's wrong in plain English — with a full audit trail of every change.
          </p>

          {/* Feature chips */}
          <div className="flex flex-wrap justify-center gap-3 pt-1">
            {[
              { icon: "📊", label: "Z-Score & IQR Outlier Detection" },
              { icon: "🌲", label: "Isolation Forest ML Scan" },
              { icon: "✅", label: "Programmatic Rule Validation" },
              { icon: "✦",  label: "AI Explanations" },
              { icon: "🗂️", label: "Human-in-the-Loop Triage Queue" },
            ].map(({ icon, label }) => (
              <span
                key={label}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-slate-800/70 border border-slate-700/60 text-xs text-slate-300 font-medium font-mono"
              >
                <span>{icon}</span>
                {label}
              </span>
            ))}
          </div>
        </div>
      )}

      {(!previewData || !dataset) && (
        <div className="bg-slate-900 border border-slate-800 rounded-xl p-8 shadow-[var(--card-shadow)] max-w-2xl mx-auto">
          <div className="mb-6">
            <h2 className="text-xl font-bold text-slate-100 font-sans tracking-tight">Load Dataset</h2>
            <p className="text-slate-400 text-xs mt-1">
              Select or drop a target database file to profile columns and check structure constraints.
            </p>
          </div>

          <div
            onDragOver={handleDragOver}
            onDragLeave={handleDragLeave}
            onDrop={handleDrop}
            className={`border-2 border-dashed rounded-xl p-10 cursor-pointer flex flex-col items-center justify-center relative group transition-all duration-200 outline-none focus-within:ring-2 focus-within:ring-brand-500/50 ${
              isDragActive
                ? "border-brand-500 border-solid bg-brand-500/5 shadow-[0_0_15px_rgba(99,102,241,0.15)]"
                : "border-slate-800 hover:border-slate-700 bg-slate-950/10"
            }`}
          >
            {isUploading ? (
              <div className="w-full max-w-md mx-auto py-6 text-center select-none pointer-events-none">
                <div className="text-slate-400 text-xs font-mono mb-3.5 tracking-wider animate-pulse">
                  PROFILING SCHEMAS & NORMALIZING FORMATS ({uploadProgress}%)
                </div>
                <div className="w-full h-2 bg-slate-950 rounded-full overflow-hidden border border-slate-800">
                  <div
                    className="h-full bg-brand-500 rounded-full transition-all duration-200 ease-out"
                    style={{ width: `${uploadProgress}%` }}
                  ></div>
                </div>
              </div>
            ) : (
              <>
                <input
                  type="file"
                  onChange={handleFileChange}
                  className="absolute inset-0 opacity-0 cursor-pointer"
                  accept=".csv,.xlsx"
                  aria-label="Upload CSV or XLSX file"
                />
                <UploadCloud className={`w-12 h-12 mb-3 transition-colors ${
                  isDragActive ? "text-brand-500" : "text-slate-500 group-hover:text-slate-400"
                }`} />
                <p className="text-slate-200 text-sm font-medium mb-1">Click to select or drop database file</p>
                <p className="text-slate-500 text-[10px] font-mono uppercase tracking-wider">CSV, XLSX / MAX 25MB (50,000 ROWS CAP)</p>
              </>
            )}
          </div>

          {!isUploading && (
            <div className="mt-4 text-center select-none">
              <button
                onClick={handleLoadSample}
                className="text-xs text-slate-500 hover:text-brand-400 transition-colors font-medium hover:underline hover:decoration-brand-500 hover:underline-offset-4 cursor-pointer"
              >
                or try a sample dataset
              </button>
            </div>
          )}

          {error && (
            <div className="mt-6 p-4 bg-red-950/15 border border-red-900/40 rounded-lg text-red-400 flex items-start gap-2.5 text-xs font-mono">
              <AlertTriangle className="w-4 h-4 shrink-0 text-red-500 mt-0.5" />
              <span>{error}</span>
            </div>
          )}
        </div>
      )}

      {/* Recent Uploads Section */}
      {user && (!previewData || !dataset) && (
        <div id="recent-uploads-section" className="bg-slate-900 border border-slate-800 rounded-xl p-6 shadow-[var(--card-shadow)] max-w-2xl mx-auto mt-6">
          <h3 className="text-xs font-bold text-slate-100 uppercase tracking-wider font-mono mb-4 flex items-center gap-2 select-none">
            <span>Recent Uploads</span>
            {loadingRecent && <div className="w-3.5 h-3.5 border-2 border-slate-400 border-t-transparent rounded-full animate-spin"></div>}
          </h3>
          
          {recentUploads.length === 0 ? (
            <p className="text-slate-505 text-xs py-4 text-center select-none font-mono">
              No recent uploads found. Cleaned datasets will appear here.
            </p>
          ) : (
            <div className="divide-y divide-slate-800/60 max-h-64 overflow-y-auto pr-1">
              {recentUploads.map((upload) => (
                <div key={upload.id} className="py-3.5 flex items-center justify-between gap-4 text-xs font-mono group first:pt-0 last:pb-0">
                  <div className="flex items-center gap-3 min-w-0">
                    {upload.filename.endsWith(".xlsx") ? (
                      <FileSpreadsheet className="w-4 h-4 text-emerald-400 shrink-0" />
                    ) : (
                      <FileText className="w-4 h-4 text-blue-400 shrink-0" />
                    )}
                    <div className="min-w-0">
                      <p className="font-semibold text-slate-200 truncate max-w-[220px]" title={upload.filename}>
                        {upload.filename}
                      </p>
                      <p className="text-[10px] text-slate-500 mt-0.5">
                        {new Date(upload.uploaded_at).toLocaleDateString()} • {upload.rows.toLocaleString()} rows • {upload.columns} cols
                      </p>
                    </div>
                  </div>
                  
                  <div className="flex items-center gap-3 shrink-0">
                    <span className="text-[10px] bg-slate-950 px-2 py-1 rounded text-slate-400 border border-slate-850">
                      Quality: <span className="text-rose-400 font-bold">{upload.health_index_before.toFixed(0)}%</span>
                      {" → "}
                      <span className="text-emerald-400 font-bold">{upload.health_index_after.toFixed(0)}%</span>
                    </span>
                    
                    <button
                      onClick={() => onRestoreAnalysis(upload)}
                      className="px-2.5 py-1 rounded bg-blue-600 hover:bg-blue-500 text-white font-bold transition-all hover:scale-102 cursor-pointer focus:outline-none"
                    >
                      Restore
                    </button>
                    
                    <button
                      onClick={async () => {
                        if (confirm(`Delete analysis for "${upload.filename}"?`)) {
                          try {
                            await deleteAnalysis(upload.id);
                            showToast("Analysis deleted", "success");
                            fetchRecent();
                          } catch (err) {
                            showToast("Failed to delete analysis", "error");
                          }
                        }
                      }}
                      className="p-1.5 rounded hover:bg-red-500/10 text-slate-500 hover:text-red-400 transition-colors cursor-pointer focus:outline-none"
                      title="Delete Analysis"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* How it Works Section */}
      {(!previewData || !dataset) && (
        <div id="how-it-works" className="mt-20 border-t border-slate-800/80 pt-16 max-w-4xl mx-auto select-none px-4">
          <h2 className="text-xs font-bold text-slate-350 font-mono mb-8 text-center uppercase tracking-[0.25em]">
            How It Works
          </h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-6">
            {[
              {
                step: "01",
                title: "Profile",
                desc: "Fingerprints your schema and profiles every column's values.",
                color: "text-blue-400 border-blue-500/20 bg-blue-500/5",
              },
              {
                step: "02",
                title: "Score",
                desc: "Runs z-score/IQR, Isolation Forest, and rule-based checks — confidence is always a number, never a guess.",
                color: "text-indigo-400 border-indigo-500/20 bg-indigo-500/5",
              },
              {
                step: "03",
                title: "Explain",
                desc: "AI interprets the deterministic findings in plain English — it explains, it never decides.",
                color: "text-purple-400 border-purple-500/20 bg-purple-500/5",
              },
              {
                step: "04",
                title: "Fix",
                desc: "High-confidence issues are auto-corrected. Anything uncertain goes to your review queue, never silently changed.",
                color: "text-emerald-400 border-emerald-500/20 bg-emerald-500/5",
              },
            ].map(({ step, title, desc, color }) => (
              <div key={title} className="bg-slate-900 border border-slate-800 rounded-xl p-8 space-y-4 relative overflow-hidden group hover:border-slate-700 transition-all flex flex-col justify-between shadow-[var(--card-shadow)]">
                <div>
                  <div className={`w-9 h-9 rounded-xl border flex items-center justify-center font-bold text-xs font-mono mb-4 ${color}`}>
                    {step}
                  </div>
                  <h3 className="text-lg font-bold text-slate-100 font-mono mb-2">{title}</h3>
                  <p className="text-slate-300 text-sm leading-relaxed font-sans">{desc}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {previewData && dataset && (
        <div className="space-y-6">
          {/* File Preview Card */}
          <div className="bg-slate-900 border border-slate-800 rounded-xl p-6 shadow-[var(--card-shadow)] max-w-3xl mx-auto space-y-6">
            <div className="flex items-center gap-4 border-b border-slate-800/60 pb-5 select-none">
              <div className="p-3 bg-slate-950 border border-slate-800 rounded-lg text-brand-400">
                {file?.name?.endsWith(".xlsx") ? (
                  <FileSpreadsheet className="w-7 h-7" />
                ) : (
                  <FileText className="w-7 h-7" />
                )}
              </div>
              <div className="space-y-1">
                <h3 className="text-sm font-bold text-slate-100 font-mono truncate max-w-md">{dataset.filename}</h3>
                <p className="text-slate-400 text-xs font-mono">
                  {dataset.row_count.toLocaleString()} rows • {dataset.column_count} columns
                  {dataset.schema_fingerprint?.domain && (
                    <>
                      {" • Domain: "}
                      <span className="text-brand-400 font-bold uppercase text-[10px] tracking-wider bg-brand-500/10 px-2 py-0.5 rounded">
                        {dataset.schema_fingerprint.domain}
                      </span>
                    </>
                  )}
                </p>
              </div>
            </div>

            {/* Preview Grid Table */}
            <div className="space-y-2.5">
              <h4 className="text-[10px] font-bold text-slate-500 uppercase tracking-wider font-mono select-none">
                Dataset preview (First 5 Rows)
              </h4>
              <div className="overflow-x-auto border border-slate-800/80 rounded-lg">
                <table className="w-full text-left text-[11px] font-mono border-collapse">
                  <thead>
                    <tr className="border-b border-slate-800 bg-slate-950 text-slate-400 select-none">
                      {previewData.columns.map((col, idx) => (
                        <th key={idx} className="py-2.5 px-4 font-semibold border-r border-slate-800/60 last:border-r-0">
                          {col}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-800/40 text-slate-300">
                    {previewData.rows.map((row, rowIdx) => (
                      <tr 
                        key={rowIdx} 
                        className="hover:bg-slate-950/20 transition-colors odd:bg-slate-900/40 even:bg-slate-950/20"
                      >
                        {row.map((cell, cellIdx) => (
                          <td key={cellIdx} className="py-2.5 px-4 border-r border-slate-800/60 last:border-r-0 truncate max-w-[150px]" title={cell !== null ? String(cell) : "null"}>
                            {cell === null || cell === "" ? <span className="text-slate-500 italic">null</span> : String(cell)}
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>

            {/* Actions Panel */}
            <div className="flex flex-col sm:flex-row items-center justify-between gap-4 pt-4 border-t border-slate-800/60">
              <button
                onClick={handleRunAnalysis}
                disabled={loading}
                className="w-full sm:w-auto bg-brand-500 hover:bg-brand-600 active:scale-98 text-slate-50 px-6 py-2.5 rounded-lg flex items-center justify-center gap-2 text-xs font-extrabold shadow-md shadow-brand-500/20 transition-all duration-150 disabled:opacity-50 focus:outline-none focus:ring-2 focus:ring-brand-500/50 cursor-pointer"
              >
                {loading ? (
                  <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin"></div>
                ) : (
                  <Play className="w-3.5 h-3.5 fill-current" />
                )}
                <span>Analyze Dataset</span>
              </button>

              <button
                onClick={() => {
                  setFile(null);
                  setDataset(null);
                  setProfile(null);
                  setPreviewData(null);
                  setError("");
                }}
                className="text-xs text-slate-500 hover:text-slate-350 transition-colors font-semibold py-2 hover:underline cursor-pointer"
              >
                Choose different file
              </button>
            </div>

            {error && (
              <div className="mt-4 p-4 bg-red-950/15 border border-red-900/40 rounded-lg text-red-400 flex items-start gap-2.5 text-xs font-mono">
                <AlertTriangle className="w-4 h-4 shrink-0 text-red-500 mt-0.5" />
                <span>{error}</span>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
