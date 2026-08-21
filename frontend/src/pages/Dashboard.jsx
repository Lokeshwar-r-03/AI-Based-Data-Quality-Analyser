import React, { useEffect, useRef, useState } from "react";
import { ArrowRight, Award, FileSpreadsheet, AlertTriangle, Layers, FileCheck, HelpCircle } from "lucide-react";

export default function Dashboard({ beforeMetrics, afterMetrics, findings, dataset, onNavigateToFindings, onNavigateToReport }) {
  const issueChartRef = useRef(null);
  const confChartRef = useRef(null);
  const [animatedScore, setAnimatedScore] = useState(beforeMetrics.quality_score);
  const [showCalculation, setShowCalculation] = useState(false);

  const clampPercentage = (val, name) => {
    if (val < 0 || val > 100) {
      console.warn(`Invariant Violated: Percentage-based metric '${name}' value ${val} falls outside [0, 100] range. Clamping.`);
      return Math.max(0, Math.min(100, val));
    }
    return val;
  };

  const clampedBeforeMissing = clampPercentage(beforeMetrics.missing_pct, "beforeMetrics.missing_pct");
  const clampedAfterMissing = clampPercentage(afterMetrics.missing_pct, "afterMetrics.missing_pct");
  const clampedBeforeQuality = clampPercentage(beforeMetrics.quality_score, "beforeMetrics.quality_score");
  const clampedAfterQuality = clampPercentage(afterMetrics.quality_score, "afterMetrics.quality_score");
  
  // Count up animation for the health score
  useEffect(() => {
    const start = clampedBeforeQuality;
    const end = clampedAfterQuality;
    if (start === end) return;
    
    // Check if user prefers reduced motion
    const prefersReducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (prefersReducedMotion) {
      setAnimatedScore(end);
      return;
    }
    
    const duration = 1200;
    const stepTime = 16;
    const totalSteps = duration / stepTime;
    const stepIncrement = (end - start) / totalSteps;
    
    let currentStep = 0;
    let score = start;
    
    const timer = setInterval(() => {
      currentStep++;
      score += stepIncrement;
      if (currentStep >= totalSteps) {
        setAnimatedScore(end);
        clearInterval(timer);
      } else {
        setAnimatedScore(Math.round(score * 10) / 10);
      }
    }, stepTime);
    
    return () => clearInterval(timer);
  }, [clampedBeforeQuality, clampedAfterQuality]);

  useEffect(() => {
    const initCharts = () => {
      if (!window.Plotly) {
        setTimeout(initCharts, 300);
        return;
      }
      
      // Compute counts of findings
      const counts = {
        missing_value: 0,
        duplicate: 0,
        outlier: 0,
        invalid_format: 0,
        rule_violation: 0,
        cross_field_mismatch: 0
      };
      
      const activeFindings = findings.filter(f => 
        f.issue_type !== "clean" && 
        !f._clean &&
        counts[f.issue_type] !== undefined
      );

      activeFindings.forEach(f => {
        counts[f.issue_type]++;
      });
      
      const labels = {
        missing_value: "Missing Values",
        duplicate: "Duplicates",
        outlier: "Outliers",
        invalid_format: "Formats",
        rule_violation: "Rule Violations",
        cross_field_mismatch: "Cross-Field Mismatches"
      };
      
      // Plotly issue counts bar chart
      const issueData = [{
        x: Object.keys(counts).map(k => labels[k]),
        y: Object.values(counts),
        type: "bar",
        marker: {
          color: [
            "#3B82F6", // Blue for Missing Values
            "#6366F1", // Indigo for Duplicates
            "#F59E0B", // Amber for Outliers
            "#8B5CF6", // Purple for Formats
            "#EF4444", // Red for Rule Violations
            "#10B981"  // Emerald for Cross-Field Mismatches
          ],
          opacity: 0.85,
          line: { color: "rgba(148, 163, 184, 0.15)", width: 1 }
        },
        hovertemplate: "Type: %{x}<br>Count: %{y}<extra></extra>"
      }];
      
      const issueLayout = {
        title: { 
          text: "ANOMALIES IDENTIFIED BY SCANNER", 
          font: { size: 11, color: "#94A3B8", family: "JetBrains Mono, monospace", weight: "bold" } 
        },
        paper_bgcolor: "rgba(0,0,0,0)",
        plot_bgcolor: "rgba(0,0,0,0)",
        font: { color: "#64748B", family: "JetBrains Mono, monospace" },
        xaxis: { 
          showgrid: false, 
          linecolor: "rgba(148, 163, 184, 0.2)", 
          tickfont: { size: 9, color: "#64748B" }, 
          tickangle: -15 
        },
        yaxis: { 
          gridcolor: "rgba(148, 163, 184, 0.12)", 
          linecolor: "rgba(148, 163, 184, 0.2)", 
          zerolinecolor: "rgba(148, 163, 184, 0.2)", 
          tickfont: { size: 9, color: "#64748B" },
          title: "Flagged Items Count",
          titlefont: { size: 9, color: "#64748B" }
        },
        margin: { t: 40, b: 50, l: 40, r: 10 },
        height: 250
      };
      
      window.Plotly.newPlot(issueChartRef.current, issueData, issueLayout, { responsive: true, displayModeBar: false });
      
      // Compute confidence bands
      const bands = {
        "Auto-Applied (>=0.85)": 0,
        "Review Queue (0.40-0.85)": 0,
        "Low Confidence (<0.40)": 0
      };
      
      activeFindings.forEach(f => {
        const c = f.confidence;
        if (c >= 0.85) bands["Auto-Applied (>=0.85)"]++;
        else if (c >= 0.40) bands["Review Queue (0.40-0.85)"]++;
        else bands["Low Confidence (<0.40)"]++;
      });
      
      // Chart counts assertion guard + diagnostics trace
      const barSum = Object.values(counts).reduce((a, b) => a + b, 0);
      const donutSum = Object.values(bands).reduce((a, b) => a + b, 0);
      // Diagnostic: shows exact raw input for both charts in browser console
      console.log("[DataSetIQ] Chart Source of Truth — activeFindings.length:", activeFindings.length);
      console.log("[DataSetIQ] Bar Chart raw counts:", { ...counts }, "→ sum:", barSum);
      console.log("[DataSetIQ] Donut Chart raw counts:", { ...bands }, "→ sum:", donutSum);
      if (barSum !== donutSum) {
        console.error(`[DataSetIQ] CHART INCONSISTENCY: Bar sum (${barSum}) !== Donut sum (${donutSum}). Both charts now use activeFindings — check for unexpected issue_types not in the 6-key counts dict.`);
        console.table(activeFindings.map(f => ({ issue_type: f.issue_type, row: f.row_index, col: f.column, conf: f.confidence })));
      } else {
        console.assert(true, `[DataSetIQ] Charts agree: both show ${barSum} total findings.`);
      }
      
      // Plotly confidence donut chart
      const confData = [{
        values: Object.values(bands),
        labels: Object.keys(bands),
        type: "pie",
        hole: 0.45,
        marker: {
          colors: ["#10B981", "#F59E0B", "#64748B"]
        },
        textinfo: "percent",
        textfont: { size: 9, color: "#fff", family: "JetBrains Mono, monospace" },
        hovertemplate: "Band: %{label}<br>Count: %{value}<extra></extra>"
      }];
      
      const confLayout = {
        title: { 
          text: "CONFIDENCE LEVEL SPREAD", 
          font: { size: 11, color: "#94A3B8", family: "JetBrains Mono, monospace", weight: "bold" } 
        },
        paper_bgcolor: "rgba(0,0,0,0)",
        font: { color: "#64748B", family: "JetBrains Mono, monospace" },
        margin: { t: 40, b: 10, l: 10, r: 10 },
        height: 250,
        showlegend: true,
        legend: { 
          orientation: "h", 
          y: -0.15,
          font: { size: 9, color: "#94A3B8" }
        }
      };
      
      window.Plotly.newPlot(confChartRef.current, confData, confLayout, { responsive: true, displayModeBar: false });
    };
    
    initCharts();
  }, [findings]);
  
  return (
    <div className="space-y-6 py-2 select-none">
      {/* Overview Diagnostic Summary Banner */}
      <div className="bg-slate-900 border border-slate-800 rounded-xl p-5 shadow-xl flex flex-col md:flex-row md:items-center justify-between gap-5">
        <div className="flex items-center gap-4">
          <div className="w-12 h-12 bg-blue-500/10 text-blue-400 border border-blue-500/20 rounded-xl flex items-center justify-center shrink-0">
            <Award className="w-6 h-6 animate-pulse" />
          </div>
          <div className="space-y-1">
            <p className="text-slate-500 text-[10px] font-mono uppercase tracking-wider font-semibold">Data Quality Score</p>
            <h2 className="text-slate-100 font-mono flex items-center gap-3">
              {/* After score – prominent */}
              <span className="text-3xl font-extrabold text-emerald-400">{animatedScore.toFixed(1)}%</span>
              {/* Arrow */}
              <span className="text-slate-600 text-sm">←</span>
              {/* Before score – muted pill */}
              <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full bg-rose-500/10 border border-rose-500/20 text-rose-400 text-sm font-semibold">
                {clampedBeforeQuality.toFixed(1)}%
                <span className="text-[10px] text-rose-400/70 font-normal">before</span>
              </span>
            </h2>
            <button
              onClick={() => setShowCalculation(!showCalculation)}
              className="text-blue-400 hover:text-blue-300 text-[10.5px] font-mono flex items-center gap-1 mt-1 transition-colors bg-transparent border-0 cursor-pointer p-0 focus:outline-none"
            >
              <span>{showCalculation ? "Hide Formula Breakdown" : "How is this calculated?"}</span>
            </button>
          </div>
        </div>
        
        <div className="flex flex-wrap items-center gap-3">
          <button
            onClick={onNavigateToFindings}
            className="bg-slate-800 hover:bg-slate-700 active:scale-95 transition-all text-slate-200 px-4 py-2 rounded-lg border border-slate-700 text-xs font-mono flex items-center gap-1.5 focus:outline-none focus:ring-2 focus:ring-slate-500"
          >
            <span>Resolve Queue</span>
            <ArrowRight className="w-3.5 h-3.5" />
          </button>
          <button
            onClick={onNavigateToReport}
            className="bg-blue-600 hover:bg-blue-500 active:scale-95 transition-all text-slate-50 px-4 py-2 rounded-lg text-xs font-extrabold flex items-center gap-1.5 shadow-md transition-all focus:outline-none focus:ring-2 focus:ring-blue-500"
          >
            <FileSpreadsheet className="w-4 h-4" />
            <span>Audit Trail & Export</span>
          </button>
        </div>
      </div>

      {showCalculation && (
        <div className="bg-slate-900 border border-slate-800 rounded-xl p-5 shadow-inner space-y-3 font-mono text-[11px] text-slate-350 animate-fadeIn">
          <div className="text-slate-400 font-bold border-b border-slate-800 pb-2 flex items-center justify-between">
            <span>DATA QUALITY SCORE FORMULA</span>
            <span className="text-emerald-450 font-mono text-[10px]">Option B: Kept outliers & imputed cells are fully resolved</span>
          </div>
          <div className="space-y-2">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div className="space-y-1 bg-slate-950/40 p-3 rounded-lg border border-slate-850">
                <span className="text-slate-500 font-bold uppercase block text-[9.5px]">General Formula</span>
                <code className="text-blue-400 block text-xs">
                  100 − Σ(Weight_i × Ratio_i)
                </code>
                <p className="text-[10px] text-slate-450 leading-relaxed font-sans mt-1">
                  Combines ratios of unresolved findings, where weights sum to 100%.
                </p>
              </div>
              <div className="space-y-1 bg-slate-950/40 p-3 rounded-lg border border-slate-850">
                <span className="text-slate-500 font-bold uppercase block text-[9.5px]">Plugged-In Live Math</span>
                <code className="text-emerald-450 block text-xs">
                  {afterMetrics.formula || `100 - (0.20 × ${afterMetrics.missing_pct || 0}% + 0.20 × ${afterMetrics.duplicate_rows_pct || 0}% + 0.20 × ${afterMetrics.outliers_pct || 0}% + 0.40 × ${afterMetrics.rule_violations_pct || 0}%)`}
                </code>
                <p className="text-[10px] text-slate-450 leading-relaxed font-sans mt-1">
                  Calculation matches your live unresolved metrics exactly.
                </p>
              </div>
            </div>
            <div className="bg-slate-950/20 border border-slate-850 rounded-lg p-3 space-y-2">
              <div className="text-slate-400 uppercase text-[9.5px] font-bold tracking-wider select-none">Weighted Ratios Breakdown</div>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 text-center">
                <div className="p-2 bg-slate-950/40 rounded border border-slate-850/50">
                  <div className="text-[9.5px] text-slate-500 font-bold uppercase">Missing (20%)</div>
                  <div className="text-xs text-slate-200 mt-1 font-bold">{(afterMetrics.missing_pct || 0).toFixed(2)}%</div>
                </div>
                <div className="p-2 bg-slate-950/40 rounded border border-slate-850/50">
                  <div className="text-[9.5px] text-slate-500 font-bold uppercase">Duplicates (20%)</div>
                  <div className="text-xs text-slate-200 mt-1 font-bold">{(afterMetrics.duplicate_rows_pct || 0).toFixed(2)}%</div>
                </div>
                <div className="p-2 bg-slate-950/40 rounded border border-slate-850/50">
                  <div className="text-[9.5px] text-slate-500 font-bold uppercase">Outliers (20%)</div>
                  <div className="text-xs text-slate-200 mt-1 font-bold">{(afterMetrics.outliers_pct || 0).toFixed(2)}%</div>
                </div>
                <div className="p-2 bg-slate-950/40 rounded border border-slate-850/50">
                  <div className="text-[9.5px] text-slate-500 font-bold uppercase">Rules (40%)</div>
                  <div className="text-xs text-slate-200 mt-1 font-bold">{(afterMetrics.rule_violations_pct || 0).toFixed(2)}%</div>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}
      
      {/* Metric Cards Grid */}
      <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-5 font-mono text-xs">
        {/* Missing values card */}
        <div className="bg-slate-900 border border-slate-800 rounded-xl p-6 shadow-xl relative overflow-hidden flex flex-col justify-between min-h-[11rem] h-auto">
          <div>
            <span className="text-slate-500 text-xs uppercase font-mono tracking-wider font-semibold">Missing Ratio</span>
            <h3 className="text-xl sm:text-2xl font-bold text-slate-100 mt-2">
              {clampedAfterMissing.toFixed(1)}%
              <span className="block mt-1 text-slate-400 text-[11px] font-normal">({afterMetrics.missing_count} of {afterMetrics.total_rows * afterMetrics.total_cols} cells)</span>
            </h3>
            <div className="text-[10px] text-slate-400 mt-2 leading-relaxed font-sans">
              {(() => {
                const missing = findings.filter(f => f.issue_type === "missing_value");
                const total = missing.length;
                const fixed = missing.filter(f => f.status === "auto_applied").length;
                const pending = missing.filter(f => f.status === "pending_review").length;
                const ignored = missing.filter(f => f.status === "reviewed_no_action").length;
                return `${total} missing values: ${fixed} imputed, ${pending} pending, ${ignored} kept blank.`;
              })()}
            </div>
            {clampedAfterMissing > clampedBeforeMissing &&
              afterMetrics.missing_count <= beforeMetrics.missing_count &&
              afterMetrics.total_rows < beforeMetrics.total_rows && (
                <div className="text-[10px] text-amber-500 mt-2 leading-relaxed font-sans" id="denominator-change-note">
                  Ratio changed because {beforeMetrics.total_rows - afterMetrics.total_rows} rows were removed during cleanup — the underlying missing-value count is unchanged (still {afterMetrics.missing_count}).
                </div>
              )}
          </div>
          <div className="flex items-center justify-between border-t border-slate-800/60 pt-3 mt-3">
            <span className="text-xs text-slate-500 font-mono uppercase tracking-wider">Before</span>
            <span className="text-xs text-slate-300 font-semibold font-mono">{clampedBeforeMissing.toFixed(1)}% <span className="text-slate-500 font-normal">({beforeMetrics.missing_count} of {beforeMetrics.total_rows * beforeMetrics.total_cols} cells)</span></span>
          </div>
          <div className="absolute top-4 right-4 text-slate-800/10 pointer-events-none">
            <HelpCircle className="w-12 h-12" />
          </div>
        </div>

        {/* Duplicates card */}
        <div className="bg-slate-900 border border-slate-800 rounded-xl p-6 shadow-xl relative overflow-hidden flex flex-col justify-between min-h-[11rem] h-auto">
          <div>
            <span className="text-slate-500 text-xs uppercase font-mono tracking-wider font-semibold">Duplicate Rows</span>
            <h3 className="text-xl sm:text-2xl font-bold text-slate-100 mt-2">
              {(afterMetrics.total_rows > 0 ? ((afterMetrics.duplicate_rows / afterMetrics.total_rows) * 100) : 0).toFixed(1)}%
              <span className="block mt-1 text-slate-400 text-[11px] font-normal">({afterMetrics.duplicate_rows} of {afterMetrics.total_rows} rows)</span>
            </h3>
            <div className="text-[10px] text-slate-400 mt-2 leading-relaxed font-sans">
              {(() => {
                const dups = findings.filter(f => f.issue_type === "duplicate");
                const total = dups.length;
                const fixed = dups.filter(f => f.status === "auto_applied").length;
                const pending = dups.filter(f => f.status === "pending_review").length;
                const ignored = dups.filter(f => f.status === "reviewed_no_action").length;
                return `${total} duplicate copies: ${fixed} removed, ${pending} pending, ${ignored} kept.`;
              })()}
            </div>
          </div>
          <div className="flex items-center justify-between border-t border-slate-800/60 pt-3 mt-3">
            <span className="text-xs text-slate-500 font-mono uppercase tracking-wider">Before</span>
            <span className="text-xs text-slate-300 font-semibold font-mono">
              {(beforeMetrics.total_rows > 0 ? ((beforeMetrics.duplicate_rows / beforeMetrics.total_rows) * 100) : 0).toFixed(1)}% <span className="text-slate-500 font-normal">({beforeMetrics.duplicate_rows} of {beforeMetrics.total_rows} rows)</span>
            </span>
          </div>
          <div className="absolute top-4 right-4 text-slate-800/10 pointer-events-none">
            <Layers className="w-12 h-12" />
          </div>
        </div>

        {/* Outliers card */}
        <div className="bg-slate-900 border border-slate-800 rounded-xl p-6 shadow-xl relative overflow-hidden flex flex-col justify-between min-h-[11rem] h-auto">
          <div>
            <span className="text-slate-500 text-xs uppercase font-mono tracking-wider font-semibold">Outliers Cap/Fix</span>
            <h3 className="text-xl sm:text-2xl font-bold text-slate-100 mt-2">
              {(afterMetrics.total_rows > 0 ? ((afterMetrics.outliers_flagged / afterMetrics.total_rows) * 100) : 0).toFixed(1)}%
              <span className="block mt-1 text-slate-400 text-[11px] font-normal">({afterMetrics.outliers_flagged} of {afterMetrics.total_rows} rows)</span>
            </h3>
            <div className="text-[10px] text-slate-400 mt-2 leading-relaxed font-sans">
              {(() => {
                const outliers = findings.filter(f => f.issue_type === "outlier");
                const total = outliers.length;
                const fixed = outliers.filter(f => f.status === "auto_applied").length;
                const pending = outliers.filter(f => f.status === "pending_review").length;
                const ignored = outliers.filter(f => f.status === "reviewed_no_action").length;
                return `${total} outliers: ${fixed} fixed, ${pending} pending review, ${ignored} ignored.`;
              })()}
            </div>
          </div>
          <div className="flex items-center justify-between border-t border-slate-800/60 pt-3 mt-3">
            <span className="text-xs text-slate-500 font-mono uppercase tracking-wider">Before</span>
            <span className="text-xs text-slate-300 font-semibold font-mono">{(beforeMetrics.total_rows > 0 ? ((beforeMetrics.outliers_flagged / beforeMetrics.total_rows) * 100) : 0).toFixed(1)}% <span className="text-slate-500 font-normal">({beforeMetrics.outliers_flagged} of {beforeMetrics.total_rows} rows)</span></span>
          </div>
          <div className="absolute top-4 right-4 text-slate-800/10 pointer-events-none">
            <AlertTriangle className="w-12 h-12" />
          </div>
        </div>

        {/* Rule violations card */}
        <div className="bg-slate-900 border border-slate-800 rounded-xl p-6 shadow-xl relative overflow-hidden flex flex-col justify-between min-h-[11rem] h-auto">
          <div>
            <span className="text-slate-500 text-xs uppercase font-mono tracking-wider font-semibold">Rule Violations</span>
            <h3 className="text-xl sm:text-2xl font-bold text-slate-100 mt-2">
              {(afterMetrics.total_rows > 0 ? ((afterMetrics.rule_violations / afterMetrics.total_rows) * 100) : 0).toFixed(1)}%
              <span className="block mt-1 text-slate-400 text-[11px] font-normal">({afterMetrics.rule_violations} of {afterMetrics.total_rows} rows)</span>
            </h3>
            <div className="text-[10px] text-slate-400 mt-2 leading-relaxed font-sans">
              {(() => {
                const rules = findings.filter(f => ["rule_violation", "invalid_format", "cross_field_mismatch"].includes(f.issue_type));
                const total = rules.length;
                const fixed = rules.filter(f => f.status === "auto_applied").length;
                const pending = rules.filter(f => f.status === "pending_review").length;
                const ignored = rules.filter(f => f.status === "reviewed_no_action").length;
                return `${total} violations: ${fixed} resolved, ${pending} pending, ${ignored} ignored.`;
              })()}
            </div>
          </div>
          <div className="flex items-center justify-between border-t border-slate-800/60 pt-3 mt-3">
            <span className="text-xs text-slate-500 font-mono uppercase tracking-wider">Before</span>
            <span className="text-xs text-slate-300 font-semibold font-mono">{(beforeMetrics.total_rows > 0 ? ((beforeMetrics.rule_violations / beforeMetrics.total_rows) * 100) : 0).toFixed(1)}% <span className="text-slate-500 font-normal">({beforeMetrics.rule_violations} of {beforeMetrics.total_rows} rows)</span></span>
          </div>
          <div className="absolute top-4 right-4 text-slate-800/10 pointer-events-none">
            <FileCheck className="w-12 h-12" />
          </div>
        </div>
      </div>
      
      {/* Charts section */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
        <div className="bg-slate-900 border border-slate-800 rounded-xl p-5 shadow-xl">
          <div ref={issueChartRef}></div>
        </div>
        <div className="bg-slate-900 border border-slate-800 rounded-xl p-5 shadow-xl">
          <div ref={confChartRef}></div>
        </div>
      </div>
    </div>
  );
}
