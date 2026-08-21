import React, { useEffect, useState } from "react";
import {
  Sparkles,
  Code,
  ShieldCheck,
  Zap,
  Clock,
  CheckCircle,
  HelpCircle,
  FileCode,
  LineChart,
  ArrowRight,
  RefreshCw,
  UploadCloud,
  FileText,
  AlertTriangle
} from "lucide-react";
import {
  loadSampleDataset,
  startAnalysis,
  fetchAnalysisStatus,
  fetchFindings,
  fetchBeforeAfter
} from "../api/client";

export default function Why({
  analysisId,
  findings,
  dataset,
  analysisDuration,
  onAnalysisComplete,
  onNavigateToUpload
}) {
  const [backgroundLoading, setBackgroundLoading] = useState(false);
  const [error, setError] = useState(null);
  const [loadedFallbackId, setLoadedFallbackId] = useState(null);

  // Background analysis trigger for first-time visitor fallback
  useEffect(() => {
    if (analysisId && findings && findings.length >= 0) {
      return; // Already have active analysis session
    }

    const runBackgroundSampleAnalysis = async () => {
      setBackgroundLoading(true);
      setError(null);
      const startTime = Date.now();

      try {
        const datasetData = await loadSampleDataset();
        const analysisData = await startAnalysis(datasetData.dataset_id);
        const aId = analysisData.analysis_id;

        let status = "queued";
        let polledData = null;
        
        while (status !== "completed" && status !== "failed") {
          await new Promise((resolve) => setTimeout(resolve, 1000));
          polledData = await fetchAnalysisStatus(aId);
          status = polledData.status;
        }

        if (status === "failed") {
          throw new Error("Sample dataset analysis pipeline failed in background.");
        }

        const [baData, findingsData] = await Promise.all([
          fetchBeforeAfter(aId),
          fetchFindings(aId)
        ]);

        const duration = ((Date.now() - startTime) / 1000).toFixed(1);

        setLoadedFallbackId(aId);
        onAnalysisComplete(
          aId,
          datasetData,
          findingsData.findings,
          baData.before,
          baData.after,
          duration
        );
      } catch (err) {
        console.error("Background sample analysis failed:", err);
        setError(err.message || "Failed to automatically process sample dataset.");
      } finally {
        setBackgroundLoading(false);
      }
    };

    runBackgroundSampleAnalysis();
  }, [analysisId, findings, onAnalysisComplete]);

  // Selection priority:
  // 1. Resolve Queue item where stat score/ml score is positive but rule check passes, OR vice versa.
  // 2. Any Resolve Queue item (status === "pending_review").
  // 3. Highest confidence auto-fixed rule violation.
  // 4. Return null (indicates zero flagged issues).
  const selectExample = () => {
    if (!findings || findings.length === 0) return null;

    const resolveQueue = findings.filter(
      (f) => f.confidence >= 0.40 && f.confidence < 0.85 && f.status === "pending_review"
    );

    // Rule 1: Stat signal (Z-Score/IQR or Forest) vs Rule Check disagreement
    const disagreeItem = resolveQueue.find((f) => {
      const hasStatSignal = (f.stat_score > 0 || f.ml_score > 0);
      const hasRuleViolation = f.rule_violation;
      return (hasStatSignal && !hasRuleViolation) || (!hasStatSignal && hasRuleViolation);
    });

    if (disagreeItem) {
      return {
        item: disagreeItem,
        badge: "Signal Disagreement",
        color: "border-indigo-500/30 text-indigo-400 bg-indigo-500/5"
      };
    }

    // Rule 2: Any Resolve Queue item sorted by confidence descending
    if (resolveQueue.length > 0) {
      const sortedQueue = [...resolveQueue].sort((a, b) => b.confidence - a.confidence);
      return {
        item: sortedQueue[0],
        badge: "Resolve Queue Triage",
        color: "border-amber-500/30 text-amber-400 bg-amber-500/5"
      };
    }

    // Rule 3: Auto-Fixed Rule Anomaly
    const autoFixedRules = findings.filter(
      (f) => f.status === "auto_applied" && f.rule_violation
    );
    if (autoFixedRules.length > 0) {
      const sortedAuto = [...autoFixedRules].sort((a, b) => b.confidence - a.confidence);
      return {
        item: sortedAuto[0],
        badge: "Auto-Fixed Rule",
        color: "border-emerald-500/30 text-emerald-400 bg-emerald-500/5"
      };
    }

    return null;
  };

  const selected = selectExample();

  const formatIssueType = (type) => {
    if (!type) return "";
    return type
      .split("_")
      .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
      .join(" ");
  };

  return (
    <div className="space-y-12 py-4 animate-fade-in select-none">
      
      {/* ━━ Headline Section (a) ━━ */}
      <div className="text-center max-w-4xl mx-auto space-y-4">
        <h2 className="text-3xl sm:text-4xl font-extrabold tracking-tight text-slate-100 font-mono">
          Why DataSet<span className="text-brand-400">IQ</span>
        </h2>
        <p className="text-slate-300 text-sm sm:text-base max-w-2xl mx-auto leading-relaxed">
          Most data-quality tools are built for engineering teams monitoring live pipelines. 
          DataSetIQ is built for the one-off cleanup — a single analyst, a single messy file, right now.
        </p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-8 max-w-4xl mx-auto">
        {/* ━━ The Problem Section (b) ━━ */}
        <div className="bg-slate-900 border border-slate-800 rounded-2xl p-6 space-y-3.5">
          <div className="inline-flex items-center justify-center w-8 h-8 rounded-lg bg-rose-500/10 border border-rose-500/20 text-rose-400">
            <XCircleIcon className="w-4 h-4" />
          </div>
          <h3 className="text-sm font-bold text-slate-150 uppercase tracking-wider font-mono">The Problem</h3>
          <p className="text-slate-400 text-xs sm:text-sm leading-relaxed font-sans">
            Cleaning a spreadsheet by hand means manually scanning for blanks, eyeballing near-duplicate rows, sanity-checking every large number, and re-deriving formulas row by row — slow, easy to get wrong, doesn't scale.
          </p>
        </div>

        {/* ━━ Not a Pipeline Monitor Section (f) ━━ */}
        <div className="bg-slate-900 border border-slate-800 rounded-2xl p-6 space-y-3.5">
          <div className="inline-flex items-center justify-center w-8 h-8 rounded-lg bg-blue-500/10 border border-blue-500/20 text-blue-400">
            <LineChart className="w-4 h-4" />
          </div>
          <h3 className="text-sm font-bold text-slate-150 uppercase tracking-wider font-mono">Not a Pipeline Monitor</h3>
          <p className="text-slate-400 text-xs sm:text-sm leading-relaxed font-sans">
            Enterprise data-observability platforms are built to watch pipelines continuously, with dashboards, alerting, and team workflows. DataSetIQ has none of that by design — no setup, no configuration, no ongoing monitoring. You upload a file, get an explained, corrected result, and you're done.
          </p>
        </div>
      </div>

      {/* ━━ Core Principle Callout Section (c) ━━ */}
      <div className="max-w-4xl mx-auto bg-slate-900 border-l-4 border-l-brand-500 border border-slate-800 rounded-xl p-6 relative overflow-hidden">
        <div className="absolute top-0 right-0 w-32 h-32 bg-brand-500/5 rounded-full blur-2xl pointer-events-none" />
        <div className="space-y-2">
          <h4 className="text-xs font-bold text-brand-400 uppercase tracking-wider font-mono">Our Core Principle</h4>
          <p className="text-slate-200 text-xs sm:text-sm leading-relaxed font-sans font-medium">
            "The deterministic layer decides and executes. AI proposes and explains. Confidence scores gate automation — nothing above the uncertainty threshold changes without a human approving it."
          </p>
          <p className="text-slate-455 text-xs leading-relaxed font-sans pt-1">
            This keeps the AI layer auditable — every explanation is grounded in a number you can independently check, never a black-box judgment call.
          </p>
        </div>
      </div>

      {/* ━━ Time Saved Section (e) ━━ */}
      <div className="max-w-4xl mx-auto bg-slate-950 border border-slate-850/80 rounded-xl p-5 text-center font-mono">
        {backgroundLoading ? (
          <div className="flex items-center justify-center gap-3 py-2 text-slate-400 text-xs font-semibold">
            <RefreshCw className="w-4 h-4 animate-spin text-brand-500" />
            <span>Analyzing time saved...</span>
          </div>
        ) : error ? (
          <div className="text-rose-500 text-xs font-semibold py-2">
            {error}
          </div>
        ) : (
          <p className="text-slate-350 text-xs sm:text-sm font-semibold">
            ⏱️ <span className="text-brand-400">{findings?.length || 0} issues</span> found and evaluated in <span className="text-brand-400">{analysisDuration || "0.0"}s</span>. A manual review of a file this size typically takes <span className="text-brand-400">15–25 minutes</span>.
          </p>
        )}
      </div>

      {/* ━━ See It In Action (Dynamic Example) (d) ━━ */}
      <div className="max-w-4xl mx-auto space-y-5">
        <div className="text-center space-y-1">
          <h3 className="text-lg font-bold text-slate-100 font-mono uppercase tracking-wider">See It In Action</h3>
          <p className="text-slate-400 text-xs leading-relaxed">
            Dynamic extract showing how DataSetIQ parses individual issues in your dataset.
          </p>
        </div>

        {analysisId && analysisId === loadedFallbackId && !backgroundLoading && (
          <div className="bg-amber-500/10 border border-amber-500/20 text-amber-400 px-4 py-2.5 rounded-xl text-center text-xs font-semibold max-w-xl mx-auto select-none font-mono">
            Example from our sample dataset — upload your own file to see this section reflect your data instead.
          </div>
        )}

        {backgroundLoading ? (
          <div className="bg-slate-900 border border-slate-800 rounded-2xl p-16 text-center shadow-xl space-y-4">
            <RefreshCw className="w-8 h-8 animate-spin text-brand-500 mx-auto" />
            <h4 className="text-slate-200 font-bold font-mono text-xs">Compiling Action Trace...</h4>
            <p className="text-slate-450 text-[11px] max-w-md mx-auto leading-relaxed font-sans">
              Running our multi-layered validation pipeline on the Shopify Orders sample export in the background.
            </p>
          </div>
        ) : selected ? (
          // Render example using same visual structure as Resolve Queue detail card
          <div className="bg-slate-900 border border-slate-800 rounded-2xl p-6 shadow-xl space-y-6">
            
            {/* Header info */}
            <div className="border-b border-slate-800 pb-4 flex flex-col sm:flex-row sm:items-baseline justify-between gap-4">
              <div className="space-y-1">
                <div className="flex items-center gap-2">
                  <h4 className="text-xs sm:text-sm font-bold text-slate-100 font-mono">
                    {selected.item.column === "ALL_COLUMNS" ? "Full Row Check" : selected.item.column}
                  </h4>
                  <span className="text-slate-500 text-[10px] font-mono">Row Index: {selected.item.row_index}</span>
                </div>
                <p className="text-slate-400 text-xs">
                  Issue Type: <span className="font-semibold text-slate-350">{formatIssueType(selected.item.issue_type)}</span>
                </p>
              </div>

              <div className="flex items-center gap-3">
                <span className={`font-mono text-[10px] border px-2.5 py-0.5 rounded-full font-bold ${selected.color}`}>
                  {selected.badge}
                </span>
                <span className="font-mono text-[10px] text-amber-400 font-semibold bg-amber-500/5 border border-amber-500/20 px-2.5 py-0.5 rounded-full">
                  Confidence: {(selected.item.confidence * 100).toFixed(0)}%
                </span>
              </div>
            </div>

            {/* Split layout: AI Interpretation vs Code Trace */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6 items-stretch">
              
              {/* Left Drawer Block: AI Reasoning */}
              <div className="bg-slate-950 border border-blue-900/10 rounded-xl p-5 space-y-4 relative overflow-hidden flex flex-col justify-between">
                <div>
                  <div className="flex items-center gap-2 text-[10px] text-blue-400 font-semibold uppercase tracking-wider select-none border-b border-slate-900 pb-2.5 mb-3.5">
                    <Sparkles className="w-3.5 h-3.5 text-blue-500" />
                    <span>AI Interpretation</span>
                  </div>
                  
                  <p className="text-slate-300 text-xs leading-relaxed italic font-serif">
                    "{selected.item.ai_explanation || "No explanation trace returned. Using offline rule weights and statistical variance thresholds."}"
                  </p>
                </div>
                
                <div className="border-t border-slate-900 pt-3 mt-4">
                  <span className="text-slate-500 text-[9px] uppercase font-mono tracking-wider font-semibold block mb-0.5">Recommended Action</span>
                  <code className="text-blue-400 text-xs font-mono font-bold">
                    {selected.item.ai_recommended_action || "flag_for_review"}
                  </code>
                </div>
              </div>

              {/* Right Drawer Block: Code Trace */}
              <div className="bg-slate-950 border border-slate-800 rounded-xl p-5 flex flex-col justify-between font-mono">
                <div>
                  <div className="flex items-center gap-2 text-[10px] text-slate-400 font-semibold uppercase tracking-wider border-b border-slate-900 pb-2.5 mb-4 select-none">
                    <Code className="w-3.5 h-3.5 text-slate-500" />
                    <span>Offline System Code Trace</span>
                  </div>

                  <div className="space-y-2.5 text-xs">
                    <div className="flex justify-between items-center">
                      <span className="text-slate-500">Stat Variance Score:</span>
                      <span className="text-slate-350 font-semibold">{selected.item.stat_score.toFixed(3)}</span>
                    </div>
                    <div className="flex justify-between items-center">
                      <span className="text-slate-500">Isolation Forest score:</span>
                      <span className="text-slate-350 font-semibold">{selected.item.ml_score.toFixed(3)}</span>
                    </div>
                    <div className="flex justify-between items-center">
                      <span className="text-slate-500">Logical Rule weight:</span>
                      <span className="text-slate-350 font-semibold">{selected.item.rule_score.toFixed(3)}</span>
                    </div>
                    <div className="flex justify-between items-center">
                      <span className="text-slate-500">Hard Rule Violation:</span>
                      <span className={selected.item.rule_violation ? "text-emerald-400 font-bold" : "text-slate-500"}>
                        {selected.item.rule_violation ? "TRUE (Floored)" : "FALSE"}
                      </span>
                    </div>
                  </div>
                </div>

                <div className="border-t border-slate-900 pt-3 mt-4">
                  <div className="flex justify-between items-baseline">
                    <span className="text-slate-500 text-xs">Original Value:</span>
                    <code className="text-red-400 bg-red-950/20 px-2 py-0.5 rounded truncate max-w-[150px] text-xs" title={selected.item.before_value}>
                      {selected.item.before_value === "" || selected.item.before_value === null ? "[Empty]" : String(selected.item.before_value)}
                    </code>
                  </div>
                </div>
              </div>

            </div>

          </div>
        ) : (
          // Rule 4: Zero flagged issues fallback
          <div className="bg-slate-900 border border-slate-800 rounded-2xl p-12 text-center shadow-xl space-y-4 max-w-2xl mx-auto">
            <div className="w-12 h-12 bg-emerald-500/10 text-emerald-400 rounded-full flex items-center justify-center mx-auto mb-2 border border-emerald-500/25">
              <CheckCircle className="w-6 h-6" />
            </div>
            <h4 className="text-sm font-bold text-slate-100 font-mono uppercase tracking-wider">Zero Issues Trace</h4>
            <p className="text-slate-450 text-xs leading-relaxed max-w-md mx-auto font-sans">
              Your last file had 0 issues out of {dataset?.row_count?.toLocaleString() || 0} rows — nothing needed review.
            </p>
            {analysisDuration && (
              <p className="text-[10px] text-slate-500 font-mono">
                Evaluated in {analysisDuration}s
              </p>
            )}
          </div>
        )}
      </div>

      {/* ━━ Closing CTA Button back to upload (g) ━━ */}
      <div className="flex justify-center pt-4">
        <button
          onClick={onNavigateToUpload}
          className="px-6 py-3 rounded-xl bg-brand-500 hover:bg-brand-600 text-white text-xs font-bold transition-all shadow-md shadow-brand-500/10 flex items-center gap-2 cursor-pointer focus:outline-none"
        >
          <UploadCloud className="w-4 h-4 text-slate-200" />
          <span>Try it on your own file</span>
        </button>
      </div>

    </div>
  );
}

// Inline icons
function XCircleIcon(props) {
  return (
    <svg
      {...props}
      xmlns="http://www.w3.org/2000/svg"
      width="24"
      height="24"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <circle cx="12" cy="12" r="10" />
      <path d="m15 9-6 6" />
      <path d="m9 9 6 6" />
    </svg>
  );
}
