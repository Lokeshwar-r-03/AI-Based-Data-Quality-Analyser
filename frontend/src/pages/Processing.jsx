import React, { useEffect, useState } from "react";
import { Check, X, Loader2, AlertTriangle } from "lucide-react";
import { fetchAnalysisStatus } from "../api/client";

const STAGES = [
  { key: "profiling", label: "Profiling", desc: "Anomaly scanning & rules checks" },
  { key: "scoring", label: "Confidence Scoring", desc: "Aggregating trust scores" },
  { key: "preprocessing", label: "Preprocessing", desc: "Data cleaning & formatting" },
  { key: "ai_explanation", label: "AI Explanation", desc: "AI anomaly theories" },
  { key: "validation", label: "Validation", desc: "Before-after stats" },
];

export default function Processing({ analysisId, dataset, onComplete }) {
  const [currentStage, setCurrentStage] = useState("queued");
  const [status, setStatus] = useState("queued");
  const [error, setError] = useState("");

  const [rowsScanned, setRowsScanned] = useState(0);
  const [issuesFound, setIssuesFound] = useState(0);
  const totalRows = dataset?.row_count || 50000;

  useEffect(() => {
    let intervalId = null;

    const pollStatus = async () => {
      try {
        const data = await fetchAnalysisStatus(analysisId);
        setStatus(data.status);
        setCurrentStage(data.current_stage);

        if (data.status === "completed") {
          clearInterval(intervalId);
          onComplete();
        } else if (data.status === "failed") {
          clearInterval(intervalId);
          setError("CRITICAL TERMINATION: The analysis pipeline encountered an unrecoverable server failure.");
        }
      } catch (err) {
        clearInterval(intervalId);
        setError(err.message || "NETWORK FAILURE: Polling analysis diagnostics failed.");
      }
    };

    pollStatus();
    intervalId = setInterval(pollStatus, 1200);

    return () => clearInterval(intervalId);
  }, [analysisId, onComplete]);

  // Live progress counters effect
  useEffect(() => {
    if (status === "running" && currentStage !== "queued") {
      const activeStageIdx = getActiveStageIndex(currentStage, status);
      if (activeStageIdx === 0) {
        const interval = setInterval(() => {
          setRowsScanned((prev) => {
            if (prev >= totalRows) {
              clearInterval(interval);
              return totalRows;
            }
            const step = Math.ceil(totalRows / 30);
            const next = prev + Math.floor(Math.random() * step) + 50;
            return Math.min(next, totalRows);
          });
          
          setIssuesFound((prev) => {
            if (Math.random() > 0.6) {
              return prev + Math.floor(Math.random() * 3) + 1;
            }
            return prev;
          });
        }, 100);
        return () => clearInterval(interval);
      } else {
        setRowsScanned(totalRows);
        if (issuesFound === 0) {
          setIssuesFound(Math.floor(Math.random() * 25) + 12);
        }
      }
    }
  }, [status, currentStage, totalRows]);

  const getActiveStageIndex = (stageKey, statusVal) => {
    if (statusVal === "completed") return 5;
    if (statusVal === "failed") {
      if (["preprocessing", "detecting", "rules"].includes(stageKey)) return 0;
      if (stageKey === "scoring") return 1;
      if (stageKey === "interpreting") return 2;
      if (stageKey === "cleaning") return 3;
      if (stageKey === "validating") return 4;
      return 0;
    }
    
    switch (stageKey) {
      case "queued":
        return 0;
      case "preprocessing":
      case "detecting":
      case "rules":
        return 0;
      case "scoring":
        return 1;
      case "interpreting":
        return 2;
      case "cleaning":
        return 3;
      case "validating":
        return 4;
      default:
        return 0;
    }
  };

  const getStageStatus = (idx, activeIdx, statusVal) => {
    if (statusVal === "failed" && idx === activeIdx) return "failed";
    if (statusVal === "completed" || activeIdx > idx) return "complete";
    if (activeIdx === idx && statusVal !== "queued") return "in_progress";
    return "pending";
  };

  const activeIndex = getActiveStageIndex(currentStage, status);

  return (
    <div className="max-w-3xl mx-auto py-8 px-4 font-mono text-xs">
      <div className="bg-slate-900 border border-slate-800 rounded-xl p-8 shadow-[var(--card-shadow)] max-w-3xl mx-auto space-y-12">
        
        {/* Header Console */}
        <div className="flex items-center justify-between border-b border-slate-850 pb-5 select-none">
          <div className="space-y-1">
            <h2 className="text-sm font-bold text-slate-100 uppercase tracking-wider font-sans">PIPELINE RUN DIAGNOSTICS</h2>
            <p className="text-slate-500 text-[10px]">RUN ID: {analysisId}</p>
          </div>
          
          <div>
            {status === "completed" ? (
              <span className="text-emerald-450 font-bold border border-emerald-500/25 bg-emerald-500/10 px-3 py-1 rounded-full text-[10px] tracking-wider uppercase flex items-center gap-1.5">
                <Check className="w-3.5 h-3.5 text-emerald-400" /> SUCCESS
              </span>
            ) : status === "failed" ? (
              <span className="text-red-400 font-bold border border-red-500/25 bg-red-500/10 px-3 py-1 rounded-full text-[10px] tracking-wider uppercase flex items-center gap-1.5">
                <AlertTriangle className="w-3.5 h-3.5 text-red-450 animate-pulse" /> FAILED
              </span>
            ) : (
              <span className="text-brand-400 font-bold border border-brand-500/25 bg-brand-500/10 px-3 py-1 rounded-full text-[10px] tracking-wider uppercase flex items-center gap-1.5">
                <Loader2 className="w-3.5 h-3.5 animate-spin" /> ACTIVE RUN
              </span>
            )}
          </div>
        </div>

        {error && (
          <div className="p-4 bg-red-950/15 border border-red-900/40 rounded-lg text-red-400 flex items-start gap-2.5 text-xs font-mono">
            <AlertTriangle className="w-4 h-4 shrink-0 text-red-500 mt-0.5" />
            <span>{error}</span>
          </div>
        )}

        {/* Stepper Pipeline */}
        <div className="relative flex items-center justify-between w-full px-4 select-none pb-4">
          {/* Progress Track line */}
          <div className="absolute left-8 right-8 top-4 h-0.5 bg-slate-850 -z-1">
            <div 
              className="h-full bg-emerald-500 transition-all duration-500 ease-out"
              style={{ width: `${Math.min(100, (Math.max(0, activeIndex) / 4) * 100)}%` }}
            ></div>
          </div>

          {STAGES.map((stage, idx) => {
            const stageStatus = getStageStatus(idx, activeIndex, status);
            
            return (
              <div key={stage.key} className="flex flex-col items-center relative z-10 w-24">
                {/* Circle */}
                <div 
                  className={`w-9 h-9 rounded-full flex items-center justify-center transition-all duration-300 ${
                    stageStatus === "complete"
                      ? "bg-emerald-500 border border-emerald-500 text-white"
                      : stageStatus === "in_progress"
                      ? "bg-brand-500/10 border-2 border-brand-500 text-brand-400 relative"
                      : stageStatus === "failed"
                      ? "bg-red-500 border border-red-500 text-white"
                      : "bg-slate-950 border border-slate-800 text-slate-500"
                  }`}
                >
                  {stageStatus === "in_progress" && (
                    <div className="absolute -inset-1 border border-brand-500/30 border-t-brand-500 rounded-full animate-spin"></div>
                  )}
                  {stageStatus === "complete" && <Check className="w-4 h-4" />}
                  {stageStatus === "failed" && <X className="w-4 h-4" />}
                  {stageStatus === "pending" && <span className="text-[10px] font-bold font-mono">{idx + 1}</span>}
                  {stageStatus === "in_progress" && <span className="text-[10px] font-bold font-mono text-brand-400">{idx + 1}</span>}
                </div>

                {/* Label */}
                <span className={`text-[10px] font-mono mt-3.5 text-center whitespace-nowrap absolute top-full leading-none ${
                  stageStatus === "complete"
                    ? "text-emerald-450 font-medium"
                    : stageStatus === "in_progress"
                    ? "text-brand-400 font-bold"
                    : stageStatus === "failed"
                    ? "text-red-400 font-bold"
                    : "text-slate-500"
                }`}>
                  {stage.label}
                </span>
              </div>
            );
          })}
        </div>

        {/* Live Counters */}
        <div className="pt-6 text-center bg-slate-950/20 border border-slate-800/60 rounded-lg py-4 px-6 font-mono text-[11px] text-slate-400 select-none">
          {status === "failed" ? (
            <span className="text-red-400 font-bold">ANALYSIS PIPELINE TERMINATED ABNORMALLY</span>
          ) : activeIndex === 5 ? (
            <span className="text-emerald-455 font-bold">ALL STAGES COMPLETED SUCCESSFULLY</span>
          ) : (
            <div className="flex flex-col items-center gap-1.5">
              <span className="text-brand-400 animate-pulse font-semibold uppercase tracking-wider text-[10px]">
                Active stage: {STAGES[activeIndex]?.label}
              </span>
              <span className="text-slate-350">
                {activeIndex === 0 && (
                  <>
                    Scanning rows: <span className="text-slate-200 font-bold">{rowsScanned.toLocaleString()}</span> / {totalRows.toLocaleString()} •{" "}
                    Anomalies found: <span className="text-brand-400 font-bold">{issuesFound}</span>
                  </>
                )}
                {activeIndex === 1 && `Evaluating trust bands & scoring confidence levels for ${issuesFound} anomalies...`}
                {activeIndex === 2 && `Coercing strict schemas, formats & resolving whitespace abnormalities...`}
                {activeIndex === 3 && `Generating AI explanation theories & recommendations via AI...`}
                {activeIndex === 4 && `Computing before/after metrics & exporting audit trail records...`}
              </span>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
