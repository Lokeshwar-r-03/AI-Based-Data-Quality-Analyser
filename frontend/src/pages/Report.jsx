import React, { useEffect, useState } from "react";
import { Download, ShieldCheck, UserCheck, Cpu, Search, Calendar, FileSpreadsheet, FileJson, FileText, Printer, ArrowRight, AlertTriangle } from "lucide-react";
import { fetchReport, getDownloadUrl } from "../api/client";
import AuditPreviewTable from "./AuditPreviewTable";

export default function Report({ analysisId, dataset, findings, onNavigateToQueue, refreshTrigger }) {
  const [reportData, setReportData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [searchTerm, setSearchTerm] = useState("");
  const [selectedFilter, setSelectedFilter] = useState("all"); // all, system, human
  const [showBlockedModal, setShowBlockedModal] = useState(false);
  const [showCalculation, setShowCalculation] = useState(false);

  const unresolvedMissing = findings ? findings.filter(
    (f) => f.issue_type === "missing_value" && f.status === "pending_review"
  ) : [];

  const handleDownloadClick = (e) => {
    if (unresolvedMissing.length > 0) {
      e.preventDefault();
      setShowBlockedModal(true);
    } else {
      window.location.href = getDownloadUrl(analysisId);
    }
  };

  useEffect(() => {
    const loadReport = async () => {
      try {
        const data = await fetchReport(analysisId);
        setReportData(data);
      } catch (err) {
        setError(err.message || "Failed to load audit trail report");
      } finally {
        setLoading(false);
      }
    };
    loadReport();
  }, [analysisId, refreshTrigger]);

  const handleExportJSON = () => {
    if (!reportData) return;
    const dataStr = "data:text/json;charset=utf-8," + encodeURIComponent(JSON.stringify(reportData, null, 2));
    const downloadAnchor = document.createElement('a');
    downloadAnchor.setAttribute("href", dataStr);
    downloadAnchor.setAttribute("download", `datasetiq_report_${analysisId}.json`);
    document.body.appendChild(downloadAnchor);
    downloadAnchor.click();
    downloadAnchor.remove();
  };

  const handleExportCSV = () => {
    const auditLog = reportData?.audit_log || [];
    if (!reportData) return;
    if (auditLog.length === 0) return;
    
    const afterMetrics = reportData.after_metrics || {};
    
    const metadata = [
      `# DATA QUALITY REPORT - ${reportData.filename || "dataset"}`,
      `# Data Quality Score (After Cleaning): ${reportData.quality_score_after?.toFixed(2)}%`,
      `# Data Quality Score (Before Cleaning): ${reportData.quality_score_before?.toFixed(2)}%`,
      `# Formula: ${afterMetrics.formula || ""}`,
      `# Weights: Missing=20% | Duplicate=20% | Outlier=20% | Rule=40%`,
      `#`
    ];
    
    const headers = ["Applied At", "Changed By", "Action Taken", "Before Value", "After Value", "Reasoning"];
    const rows = auditLog.map(log => [
      new Date(log.applied_at).toLocaleString(),
      log.changed_by,
      log.action_taken,
      log.before_value || "",
      log.after_value || "",
      log.reasoning || ""
    ]);
    
    const mainContent = [headers, ...rows]
      .map(e => e.map(val => `"${val.toString().replace(/"/g, '""')}"`).join(","))
      .join("\n");
      
    const csvContent = [...metadata, mainContent].join("\n");
    
    const dataStr = "data:text/csv;charset=utf-8," + encodeURIComponent(csvContent);
    const downloadAnchor = document.createElement('a');
    downloadAnchor.setAttribute("href", dataStr);
    downloadAnchor.setAttribute("download", `datasetiq_audit_log_${analysisId}.csv`);
    document.body.appendChild(downloadAnchor);
    downloadAnchor.click();
    downloadAnchor.remove();
  };

  if (loading) {
    return (
      <div className="py-20 text-center text-slate-500 flex flex-col items-center justify-center gap-2 font-mono text-xs select-none">
        <div className="w-6 h-6 border-2 border-blue-500 border-t-transparent rounded-full animate-spin"></div>
        <span>GENERATING COMPLIANCE AUDIT TRAIL REPORT...</span>
      </div>
    );
  }

  if (error) {
    return (
      <div className="py-10 text-center text-red-500 bg-red-950/15 border border-red-900/40 rounded-xl p-6 font-mono text-xs">
        <h4 className="font-bold text-sm mb-2">AUDIT LOAD ERROR</h4>
        <p>{error}</p>
      </div>
    );
  }

  const auditLog = reportData.audit_log || [];

  // Filter audit log
  const filteredLogs = auditLog.filter(log => {
    const matchesSearch = log.action_taken.toLowerCase().includes(searchTerm.toLowerCase()) ||
                          log.reasoning.toLowerCase().includes(searchTerm.toLowerCase());
                           
    if (!matchesSearch) return false;
    
    if (selectedFilter === "all") return true;
    if (selectedFilter === "system") return log.changed_by === "system";
    if (selectedFilter === "human") return log.changed_by === "human";
    return true;
  });

  return (
    <div className="space-y-6 py-2 select-none">
      {/* Top Banner and Download */}
      <div className="bg-slate-900 border border-slate-800 rounded-xl p-5 shadow-xl flex flex-col sm:flex-row sm:items-center justify-between gap-5">
        <div className="flex items-center gap-4">
          <div className="p-3 bg-emerald-500/5 text-emerald-400 border border-emerald-500/20 rounded-lg shrink-0">
            <ShieldCheck className="w-7 h-7" />
          </div>
          <div className="space-y-0.5">
            <h3 className="text-base font-bold text-slate-100 font-mono tracking-tight">Data Quality Report</h3>
            <p className="text-slate-400 text-xs font-mono">
              Data Quality Score: <span className="text-emerald-450 font-bold">{reportData.quality_score_after.toFixed(1)}%</span> (was {reportData.quality_score_before.toFixed(1)}%)
            </p>
            <button
              onClick={() => setShowCalculation(!showCalculation)}
              className="text-blue-400 hover:text-blue-300 text-[10.5px] font-mono flex items-center gap-1 mt-1 transition-colors bg-transparent border-0 cursor-pointer p-0 focus:outline-none"
            >
              <span>{showCalculation ? "Hide Formula Breakdown" : "How is this calculated?"}</span>
            </button>
          </div>
        </div>
        
        <button
          onClick={handleDownloadClick}
          className="bg-emerald-600 hover:bg-emerald-500 active:scale-95 transition-all text-slate-950 px-5 py-2.5 rounded-lg flex items-center justify-center gap-2 text-xs font-extrabold shadow-md cursor-pointer border-0"
        >
          <FileSpreadsheet className="w-4 h-4" />
          <span>Download Cleaned File</span>
        </button>
      </div>

      {showCalculation && (() => {
        const afterMetrics = reportData.after_metrics || {};
        return (
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
        );
      })()}

      {/* Filter and Export Action Bar */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div className="flex flex-wrap bg-slate-900 border border-slate-850 rounded-lg p-0.5 text-xs font-mono">
          <button
            onClick={() => setSelectedFilter("all")}
            className={`px-3 py-1.5 rounded transition-all ${selectedFilter === "all" ? "bg-slate-800 text-slate-200" : "text-slate-500 hover:text-slate-350"}`}
          >
            All Updates ({auditLog.length})
          </button>
          <button
            onClick={() => setSelectedFilter("system")}
            className={`px-3 py-1.5 rounded transition-all ${selectedFilter === "system" ? "bg-slate-800 text-slate-200" : "text-slate-500 hover:text-slate-350"}`}
          >
            System Fixed ({auditLog.filter(l => l.changed_by === "system").length})
          </button>
          <button
            onClick={() => setSelectedFilter("human")}
            className={`px-3 py-1.5 rounded transition-all ${selectedFilter === "human" ? "bg-slate-800 text-slate-200" : "text-slate-500 hover:text-slate-350"}`}
          >
            User Approved ({auditLog.filter(l => l.changed_by === "human").length})
          </button>
        </div>

        <div className="flex items-center gap-2">
          {/* Search bar */}
          <div className="relative md:w-56">
            <Search className="w-4 h-4 text-slate-600 absolute left-3 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              placeholder="Search audit trail..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="w-full bg-slate-900 border border-slate-800 rounded-lg pl-9 pr-3 py-1.5 text-slate-100 text-xs font-mono focus:outline-none focus:border-blue-500 placeholder-slate-650"
            />
          </div>

          <div className="flex items-center gap-2 select-none">
            <button
              onClick={handleExportCSV}
              className="flex items-center gap-1.5 px-2.5 py-1.5 bg-slate-900 border border-slate-800 hover:bg-slate-800 text-slate-300 hover:text-slate-100 rounded-lg font-semibold text-[10.5px] font-mono transition-all cursor-pointer"
              title="Export as CSV"
            >
              <FileSpreadsheet className="w-3.5 h-3.5" />
              <span>Export CSV</span>
            </button>
            <button
              onClick={handleExportJSON}
              className="flex items-center gap-1.5 px-2.5 py-1.5 bg-slate-900 border border-slate-800 hover:bg-slate-800 text-slate-300 hover:text-slate-100 rounded-lg font-semibold text-[10.5px] font-mono transition-all cursor-pointer"
              title="Export as JSON"
            >
              <FileJson className="w-3.5 h-3.5" />
              <span>Export JSON</span>
            </button>
            <button
              onClick={() => window.print()}
              className="flex items-center gap-1.5 px-2.5 py-1.5 bg-slate-900 border border-slate-800 hover:bg-slate-800 text-slate-300 hover:text-slate-100 rounded-lg font-semibold text-[10.5px] font-mono transition-all cursor-pointer"
              title="Print Audit Report [PDF]"
            >
              <Printer className="w-3.5 h-3.5" />
              <span>Print</span>
            </button>
          </div>
        </div>
      </div>

      {/* Desktop Audit Log Table */}
      <div className="hidden md:block bg-slate-900 border border-slate-800 rounded-xl shadow-xl overflow-hidden print:border-none print:shadow-none">
        {filteredLogs.length === 0 ? (
          <div className="py-16 text-center text-slate-550 font-mono text-xs select-none">
            <Calendar className="w-10 h-10 text-slate-800 mx-auto mb-2" />
            <p className="font-semibold text-slate-400">No audit trail records found.</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs font-mono">
              <thead>
                <tr className="border-b border-slate-800 text-slate-500 select-none">
                  <th className="py-3 px-5">Timestamp</th>
                  <th className="py-3 px-3">Operator</th>
                  <th className="py-3 px-3">Action</th>
                  <th className="py-3 px-3">Value Transition</th>
                  <th className="py-3 px-5">Repair Trace Reasoning</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800/30 text-slate-300">
                {filteredLogs.map((log) => {
                  const dateStr = new Date(log.applied_at).toLocaleString();
                  const isHuman = log.changed_by === "human";
                  
                  return (
                    <tr key={log.id} className="hover:bg-slate-950/10 transition-colors">
                      <td className="py-3 px-5 text-slate-500 text-[10px]">{dateStr}</td>
                      <td className="py-3 px-3">
                        {isHuman ? (
                          <span className="inline-flex items-center gap-1 text-amber-450 bg-amber-500/5 border border-amber-500/10 px-2.5 py-0.5 rounded text-[9px] font-bold">
                            <UserCheck className="w-3 h-3" /> USER
                          </span>
                        ) : (
                          <span className="inline-flex items-center gap-1 text-blue-450 bg-blue-500/5 border border-blue-500/10 px-2.5 py-0.5 rounded text-[9px] font-bold">
                            <Cpu className="w-3 h-3" /> SYSTEM
                          </span>
                        )}
                      </td>
                      <td className="py-3 px-3 font-semibold text-slate-200 uppercase text-[10px] tracking-wider">
                        {log.action_taken}
                      </td>
                      <td className="py-3 px-3 max-w-[200px] truncate">
                        {log.action_taken === "drop" ? (
                          <span className="text-red-400 bg-red-950/20 px-2 py-0.5 rounded text-[10px]">Dropped Row</span>
                        ) : (
                          <div className="flex items-center gap-1.5">
                            <span className="text-red-450 line-through truncate max-w-[80px]" title={log.before_value}>
                              {log.before_value === "" ? "empty" : log.before_value}
                            </span>
                            <ArrowRight className="w-3 h-3 text-slate-600 shrink-0" />
                            <span className="text-emerald-405 font-semibold truncate max-w-[80px]" title={log.after_value}>
                              {log.after_value === "" ? "empty" : log.after_value}
                            </span>
                          </div>
                        )}
                      </td>
                      <td className="py-3 px-5 text-slate-450 text-[11px] leading-normal max-w-sm">
                        {log.reasoning}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Mobile Card-based Layout (Avoids horizontal scroll overflow) */}
      <div className="block md:hidden space-y-4">
        {filteredLogs.length === 0 ? (
          <div className="py-16 text-center text-slate-550 font-mono text-xs select-none">
            <Calendar className="w-10 h-10 text-slate-800 mx-auto mb-2" />
            <p>No audit trail records found.</p>
          </div>
        ) : (
          filteredLogs.map((log) => {
            const dateStr = new Date(log.applied_at).toLocaleString();
            const isHuman = log.changed_by === "human";
            
            return (
              <div key={log.id} className="bg-slate-900 border border-slate-800 rounded-xl p-4 space-y-3 font-mono text-xs">
                
                {/* Meta row */}
                <div className="flex items-center justify-between text-[10px] select-none">
                  <span className="text-slate-500">{dateStr}</span>
                  {isHuman ? (
                    <span className="inline-flex items-center gap-1 text-amber-450 bg-amber-500/5 border border-amber-500/10 px-2 py-0.5 rounded text-[9px] font-bold">
                      <UserCheck className="w-3 h-3" /> USER
                    </span>
                  ) : (
                    <span className="inline-flex items-center gap-1 text-blue-450 bg-blue-500/5 border border-blue-500/10 px-2.5 py-0.5 rounded text-[9px] font-bold">
                      <Cpu className="w-3 h-3" /> SYSTEM
                    </span>
                  )}
                </div>

                {/* Transition row */}
                <div className="flex items-baseline justify-between border-t border-slate-850 pt-2.5">
                  <span className="font-semibold text-slate-100 uppercase tracking-wider text-[10px]">{log.action_taken}</span>
                  
                  {log.action_taken === "drop" ? (
                    <span className="text-red-400 bg-red-950/20 px-1.5 py-0.5 rounded text-[10px]">Dropped Row</span>
                  ) : (
                    <div className="flex items-center gap-1 text-[10px]">
                      <span className="text-red-450 line-through truncate max-w-[60px]">{log.before_value === "" ? "empty" : log.before_value}</span>
                      <ArrowRight className="w-3 h-3 text-slate-650 shrink-0" />
                      <span className="text-emerald-455 font-semibold truncate max-w-[60px]">{log.after_value === "" ? "empty" : log.after_value}</span>
                    </div>
                  )}
                </div>

                {/* Reason row */}
                <div className="border-t border-slate-850 pt-2 text-[10px] text-slate-450 leading-relaxed">
                  <span className="text-slate-600 font-semibold block text-[9px] uppercase mb-0.5 select-none">Repair Reason</span>
                  {log.reasoning}
                </div>

              </div>
            );
          })
        )}
      </div>

      {/* Final Cleaned Dataset Preview */}
      <div className="mt-6">
        <AuditPreviewTable analysisId={analysisId} refreshTrigger={refreshTrigger} />
      </div>

      {/* Export Blocked Modal */}
      {showBlockedModal && (
        <div className="fixed inset-0 bg-slate-950/80 backdrop-blur-sm flex items-center justify-center z-50 p-4 font-mono text-xs text-slate-100">
          <div className="bg-slate-900 border border-red-500/30 rounded-xl p-6 max-w-md w-full shadow-2xl space-y-6">
            <div className="flex items-start gap-3 text-red-500">
              <AlertTriangle className="w-8 h-8 shrink-0" />
              <div className="space-y-1">
                <h4 className="text-sm font-bold text-slate-100 uppercase">Export Blocked</h4>
                <p className="text-slate-400 text-xs leading-relaxed">
                  {unresolvedMissing.length} missing values are still unresolved before you can export.
                </p>
              </div>
            </div>

            <div className="bg-slate-950/50 border border-slate-800 rounded-lg p-3 max-h-40 overflow-y-auto space-y-1.5">
              {unresolvedMissing.map((f) => (
                <div key={f.id} className="flex justify-between text-[11px] text-slate-450 border-b border-slate-900 pb-1.5 last:border-0 last:pb-0">
                  <span>Column: <strong className="text-slate-350">{f.column}</strong></span>
                  <span>Row Index: <strong className="text-slate-350">{f.row_index}</strong></span>
                </div>
              ))}
            </div>

            <div className="flex justify-end gap-3 pt-2">
              <button 
                className="px-4 py-2 bg-slate-800 hover:bg-slate-700 text-slate-450 rounded-lg font-semibold transition-all cursor-pointer"
                onClick={() => setShowBlockedModal(false)}
              >
                Cancel
              </button>
              <button 
                className="px-4 py-2 bg-blue-600 hover:bg-blue-500 text-slate-100 rounded-lg font-bold transition-all cursor-pointer"
                onClick={() => {
                  setShowBlockedModal(false);
                  onNavigateToQueue();
                }}
              >
                Resolve Now
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
