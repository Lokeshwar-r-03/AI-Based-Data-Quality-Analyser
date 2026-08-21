import React, { useState } from "react";
import { Check, X, ShieldAlert, Sparkles, Filter, ChevronDown, ChevronUp, Search, ChevronsUpDown, Code } from "lucide-react";
import { approveFinding, rejectFinding } from "../api/client";

export default function Findings({ findings, analysisId, onFindingsUpdated }) {
  const [searchTerm, setSearchTerm] = useState("");
  const [selectedTab, setSelectedTab] = useState("all"); // review, applied, ignored, all
  const [expandedRow, setExpandedRow] = useState(null);
  const [actionLoading, setActionLoading] = useState({});
  const [sortBy, setSortBy] = useState("confidence"); // confidence, row_index, column, issue_type
  const [sortOrder, setSortOrder] = useState("desc"); // asc, desc

  const handleApprove = async (findingId, customAction = null) => {
    setActionLoading(prev => ({ ...prev, [findingId]: true }));
    try {
      await approveFinding(analysisId, findingId, customAction);
      onFindingsUpdated();
    } catch (err) {
      alert(err.message || "Failed to approve recommended correction");
    } finally {
      setActionLoading(prev => ({ ...prev, [findingId]: false }));
    }
  };

  const handleReject = async (findingId) => {
    setActionLoading(prev => ({ ...prev, [findingId]: true }));
    try {
      await rejectFinding(analysisId, findingId);
      onFindingsUpdated();
    } catch (err) {
      alert(err.message || "Failed to reject recommended correction");
    } finally {
      setActionLoading(prev => ({ ...prev, [findingId]: false }));
    }
  };

  const toggleExpand = (id) => {
    setExpandedRow(expandedRow === id ? null : id);
  };

  const handleSort = (field) => {
    if (sortBy === field) {
      setSortOrder(sortOrder === "asc" ? "desc" : "asc");
    } else {
      setSortBy(field);
      setSortOrder("desc");
    }
  };

  // Sort and filter findings
  const getSortedAndFilteredFindings = () => {
    // 1. Filter
    const filtered = findings.filter(f => {
      const colName = f.column === "ALL_COLUMNS" ? "Full Row" : f.column;
      const matchesSearch = colName.toLowerCase().includes(searchTerm.toLowerCase()) ||
                            f.issue_type.toLowerCase().includes(searchTerm.toLowerCase());
                            
      if (!matchesSearch) return false;
      
      if (selectedTab === "all") return true;
      if (selectedTab === "review") return f.status === "pending_review";
      if (selectedTab === "applied") return f.status === "auto_applied";
      if (selectedTab === "ignored") return f.status === "reviewed_no_action";
      return true;
    });

    // 2. Sort
    return filtered.sort((a, b) => {
      let comparison = 0;
      if (sortBy === "confidence") {
        comparison = a.confidence - b.confidence;
      } else if (sortBy === "row_index") {
        comparison = a.row_index - b.row_index;
      } else if (sortBy === "column") {
        comparison = a.column.localeCompare(b.column);
      } else if (sortBy === "issue_type") {
        comparison = a.issue_type.localeCompare(b.issue_type);
      }
      return sortOrder === "asc" ? comparison : -comparison;
    });
  };

  const sortedAndFiltered = getSortedAndFilteredFindings();

  const getConfidenceBadgeStyles = (conf, status) => {
    if (status === "auto_applied" || conf >= 0.85) {
      return "bg-emerald-500/10 text-emerald-400 border-emerald-500/20";
    }
    if (conf >= 0.40) {
      return "bg-amber-500/10 text-amber-400 border-amber-500/20";
    }
    return "bg-slate-800 text-slate-400 border-slate-700";
  };

  const getStatusLabelStyles = (status) => {
    if (status === "auto_applied") {
      return "text-emerald-400 bg-emerald-500/5 border-emerald-500/15";
    }
    if (status === "pending_review") {
      return "text-amber-400 bg-amber-500/5 border-amber-500/15";
    }
    return "text-slate-450 bg-slate-800/10 border-slate-800";
  };

  const formatIssueType = (issue) => {
    return issue.split("_").map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(" ");
  };

  const SortIndicator = ({ field }) => {
    if (sortBy !== field) return <ChevronsUpDown className="w-3.5 h-3.5 ml-1 opacity-40 shrink-0" />;
    return sortOrder === "asc" 
      ? <ChevronUp className="w-3.5 h-3.5 ml-1 text-blue-400 shrink-0" />
      : <ChevronDown className="w-3.5 h-3.5 ml-1 text-blue-400 shrink-0" />;
  };

  return (
    <div className="space-y-6 py-2 select-none">
      {/* Search & Filter Header Controls */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div className="flex items-center gap-2.5">
          <Filter className="w-4 h-4 text-slate-500" />
          <div className="flex bg-slate-900 border border-slate-850 rounded-lg p-0.5 text-xs font-mono">
            <button
              onClick={() => setSelectedTab("all")}
              className={`px-3 py-1.5 rounded transition-all ${selectedTab === "all" ? "bg-slate-800 text-slate-200" : "text-slate-500 hover:text-slate-350"}`}
            >
              All ({findings.length})
            </button>
            <button
              onClick={() => setSelectedTab("review")}
              className={`px-3 py-1.5 rounded transition-all ${selectedTab === "review" ? "bg-slate-800 text-slate-200" : "text-slate-500 hover:text-slate-350"}`}
            >
              Pending ({findings.filter(f => f.status === "pending_review").length})
            </button>
            <button
              onClick={() => setSelectedTab("applied")}
              className={`px-3 py-1.5 rounded transition-all ${selectedTab === "applied" ? "bg-slate-800 text-slate-200" : "text-slate-500 hover:text-slate-350"}`}
            >
              Auto-Fixed ({findings.filter(f => f.status === "auto_applied").length})
            </button>
            <button
              onClick={() => setSelectedTab("ignored")}
              className={`px-3 py-1.5 rounded transition-all ${selectedTab === "ignored" ? "bg-slate-800 text-slate-200" : "text-slate-500 hover:text-slate-350"}`}
            >
              Ignored ({findings.filter(f => f.status === "reviewed_no_action").length})
            </button>
          </div>
        </div>
        
        <div className="relative md:w-72">
          <Search className="w-4 h-4 text-slate-600 absolute left-3 top-1/2 -translate-y-1/2" />
          <input
            type="text"
            placeholder="Filter by column or issue..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="w-full bg-slate-900 border border-slate-800 rounded-lg pl-9 pr-3 py-2 text-slate-100 text-xs font-mono focus:outline-none focus:border-blue-500 placeholder-slate-650"
          />
        </div>
      </div>
      
      {/* Desktop Findings Table view */}
      <div className="hidden md:block bg-slate-900 border border-slate-800 rounded-xl shadow-xl overflow-hidden">
        {sortedAndFiltered.length === 0 ? (
          <div className="py-16 text-center text-slate-550 flex flex-col items-center justify-center gap-2 font-mono text-xs">
            <ShieldAlert className="w-10 h-10 text-slate-800" />
            <p className="font-semibold text-slate-400">No findings match this filter range.</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs font-mono">
              <thead>
                <tr className="border-b border-slate-800 text-slate-500 select-none">
                  <th className="py-3 px-5 w-8"></th>
                  <th className="py-3 px-3 cursor-pointer hover:text-slate-300 transition-colors" onClick={() => handleSort("row_index")}>
                    <div className="flex items-center">Row Index <SortIndicator field="row_index" /></div>
                  </th>
                  <th className="py-3 px-3 cursor-pointer hover:text-slate-300 transition-colors" onClick={() => handleSort("column")}>
                    <div className="flex items-center">Column <SortIndicator field="column" /></div>
                  </th>
                  <th className="py-3 px-3 cursor-pointer hover:text-slate-300 transition-colors" onClick={() => handleSort("issue_type")}>
                    <div className="flex items-center">Anomaly Class <SortIndicator field="issue_type" /></div>
                  </th>
                  <th className="py-3 px-3 cursor-pointer hover:text-slate-300 transition-colors" onClick={() => handleSort("confidence")}>
                    <div className="flex items-center">Confidence <SortIndicator field="confidence" /></div>
                  </th>
                  <th className="py-3 px-3 font-semibold text-slate-500">Status</th>
                  <th className="py-3 px-5 text-right font-semibold text-slate-500">Triage Action</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800/30">
                {sortedAndFiltered.map((f) => {
                  const isExpanded = expandedRow === f.id;
                  const colName = f.column === "ALL_COLUMNS" ? "Full Row" : f.column;
                  
                  return (
                    <React.Fragment key={f.id}>
                      <tr
                        onClick={() => toggleExpand(f.id)}
                        className={`hover:bg-slate-950/20 cursor-pointer transition-colors select-none ${isExpanded ? "bg-slate-950/20 border-b-transparent" : ""}`}
                      >
                        <td className="py-3.5 px-5 text-slate-650">
                          {isExpanded ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
                        </td>
                        <td className="py-3.5 px-3 text-slate-450">{f.row_index}</td>
                        <td className="py-3.5 px-3 font-semibold text-slate-200">{colName}</td>
                        <td className="py-3.5 px-3 text-slate-400">{formatIssueType(f.issue_type)}</td>
                        <td className="py-3.5 px-3">
                          <span className={`px-2 py-0.5 rounded border text-[10px] font-bold ${getConfidenceBadgeStyles(f.confidence, f.status)}`}>
                            {(f.confidence * 100).toFixed(0)}%
                          </span>
                        </td>
                        <td className="py-3.5 px-3">
                          <span className={`px-2 py-0.5 rounded border text-[9px] font-bold uppercase tracking-wider ${getStatusLabelStyles(f.status)}`}>
                            {f.status.replace("_", " ")}
                          </span>
                        </td>
                        <td className="py-3.5 px-5 text-right" onClick={(e) => e.stopPropagation()}>
                          {f.status === "pending_review" ? (
                            <div className="flex items-center justify-end gap-1.5">
                              <button
                                onClick={() => handleApprove(f.id)}
                                disabled={actionLoading[f.id]}
                                className="w-6 h-6 bg-green-500 hover:bg-green-600 text-slate-950 rounded flex items-center justify-center transition-all disabled:opacity-50"
                                title="Approve Recommendation"
                              >
                                <Check className="w-3.5 h-3.5 stroke-[2.5]" />
                              </button>
                              <button
                                onClick={() => handleReject(f.id)}
                                disabled={actionLoading[f.id]}
                                className="w-6 h-6 bg-slate-800 hover:bg-slate-700 text-slate-450 hover:text-slate-350 rounded flex items-center justify-center transition-all border border-slate-700 disabled:opacity-50"
                                title="Reject / Ignore Anomaly"
                              >
                                <X className="w-3.5 h-3.5" />
                              </button>
                            </div>
                          ) : (
                            <span className="text-[10px] text-slate-500 uppercase tracking-wider font-semibold pr-2 select-none">
                              {f.action_taken || "NONE"}
                            </span>
                          )}
                        </td>
                      </tr>
                      
                      {isExpanded && (
                        <tr>
                          <td colSpan="7" className="bg-slate-950/35 px-6 py-4.5 border-t border-slate-800/40">
                            {/* Core Signature Element Split Layout */}
                            <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
                              
                              {/* Left Panel: AI Interpretation */}
                              <div className="bg-slate-950 border border-blue-900/10 rounded-xl p-4.5 relative overflow-hidden flex flex-col justify-between min-h-[170px]">
                                <div className="space-y-3">
                                  <div className="flex items-center gap-1.5 text-[10px] text-blue-400 font-semibold uppercase tracking-wider select-none">
                                    <Sparkles className="w-3.5 h-3.5 text-blue-500" />
                                    <span>Generative Interpretation (AI LLM Theory)</span>
                                  </div>
                                  <p className="text-slate-300 text-xs leading-relaxed italic">
                                    "{f.ai_explanation || "No explanation trace returned. Using system core fallback heuristics."}"
                                  </p>
                                </div>
                                
                                <div className="border-t border-slate-900 pt-3 flex items-center justify-between text-[10px]">
                                  <div>
                                    <span className="text-slate-600 block">RECONSTRUCTED CAUSE</span>
                                    <span className="text-slate-400 font-semibold">{f.ai_explanation ? "Manual typo / entry error" : "Heuristic variance"}</span>
                                  </div>
                                  <div>
                                    <span className="text-slate-600 block">REPAIR ACTION</span>
                                    <span className="text-blue-400 font-bold">{f.ai_recommended_action || "flag_for_review"}</span>
                                  </div>
                                </div>

                                <div className="absolute right-3 bottom-3 opacity-[0.02] text-blue-500 pointer-events-none select-none">
                                  <Sparkles className="w-16 h-16" />
                                </div>
                              </div>
                              
                              {/* Right Panel: Offline System Code Trace */}
                              <div className="bg-slate-950 border border-slate-850 rounded-xl p-4.5 flex flex-col justify-between min-h-[170px]">
                                <div className="space-y-2">
                                  <div className="flex items-center gap-1.5 text-[10px] text-slate-500 font-semibold uppercase tracking-wider border-b border-slate-900 pb-1.5 mb-2.5 select-none">
                                    <Code className="w-3.5 h-3.5 text-slate-650" />
                                    <span>Offline System Code Trace</span>
                                  </div>
                                  
                                  <div className="grid grid-cols-2 gap-x-4 gap-y-1.5 text-[11px] text-slate-450">
                                    <div className="flex justify-between">
                                      <span>Stat Variance:</span>
                                      <span className="text-slate-350">{f.stat_score.toFixed(3)}</span>
                                    </div>
                                    <div className="flex justify-between">
                                      <span>ML Isolation:</span>
                                      <span className="text-slate-350">{f.ml_score.toFixed(3)}</span>
                                    </div>
                                    <div className="flex justify-between">
                                      <span>Rule Weight:</span>
                                      <span className="text-slate-350">{f.rule_score.toFixed(3)}</span>
                                    </div>
                                    <div className="flex justify-between">
                                      <span>Rule Violated:</span>
                                      <span className={f.rule_violation ? "text-emerald-500 font-bold" : "text-slate-550"}>
                                        {f.rule_violation ? "TRUE" : "FALSE"}
                                      </span>
                                    </div>
                                  </div>
                                </div>
                                
                                <div className="border-t border-slate-900 pt-3 flex items-center justify-between text-[10px]">
                                  <div>
                                    <span className="text-slate-600 block">ORIGINAL VALUE</span>
                                    <code className="text-red-400 bg-red-950/20 px-2 py-0.5 rounded truncate max-w-[120px]" title={f.before_value}>
                                      {f.before_value === "" ? "[Empty]" : f.before_value}
                                    </code>
                                  </div>
                                  {f.status === "auto_applied" && (
                                    <div>
                                      <span className="text-slate-600 block">REPAIRED VALUE</span>
                                      <code className="text-emerald-400 bg-emerald-950/20 px-2 py-0.5 rounded truncate max-w-[120px]" title={f.after_value}>
                                        {f.after_value === null || f.after_value === "None" ? "[Dropped]" : f.after_value}
                                      </code>
                                    </div>
                                  )}
                                </div>
                              </div>

                            </div>
                          </td>
                        </tr>
                      )}
                    </React.Fragment>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Mobile Card-based Layout (Collapses tables, avoids horizontal scrollbars) */}
      <div className="block md:hidden space-y-4">
        {sortedAndFiltered.length === 0 ? (
          <div className="py-16 text-center text-slate-550 font-mono text-xs select-none">
            <ShieldAlert className="w-10 h-10 text-slate-800 mx-auto mb-2" />
            <p>No findings match this filter.</p>
          </div>
        ) : (
          sortedAndFiltered.map((f) => {
            const isExpanded = expandedRow === f.id;
            const colName = f.column === "ALL_COLUMNS" ? "Full Row" : f.column;
            
            return (
              <div
                key={f.id}
                onClick={() => toggleExpand(f.id)}
                className={`bg-slate-900 border rounded-xl p-4 space-y-3 transition-colors ${
                  isExpanded ? "border-blue-500" : "border-slate-800"
                }`}
              >
                {/* Header Row */}
                <div className="flex items-start justify-between gap-4 font-mono">
                  <div className="space-y-1">
                    <div className="flex items-center gap-1.5">
                      <span className="text-slate-100 font-bold text-xs truncate max-w-[150px]">{colName}</span>
                      <span className="text-slate-500 text-[10px]">r{f.row_index}</span>
                    </div>
                    <div className="text-slate-450 text-[10px]">{formatIssueType(f.issue_type)}</div>
                  </div>

                  <span className={`px-2 py-0.5 rounded border text-[9px] font-bold ${getConfidenceBadgeStyles(f.confidence, f.status)}`}>
                    {(f.confidence * 100).toFixed(0)}%
                  </span>
                </div>

                {/* Subinfo Row */}
                <div className="flex items-center justify-between border-t border-slate-850 pt-2.5 text-[10px] font-mono select-none">
                  <span className={`px-2 py-0.5 rounded border text-[9px] font-bold uppercase tracking-wider ${getStatusLabelStyles(f.status)}`}>
                    {f.status.replace("_", " ")}
                  </span>

                  <div onClick={(e) => e.stopPropagation()}>
                    {f.status === "pending_review" ? (
                      <div className="flex items-center gap-2">
                        <button
                          onClick={() => handleApprove(f.id)}
                          disabled={actionLoading[f.id]}
                          className="w-7 h-7 bg-green-500 hover:bg-green-600 text-slate-950 rounded flex items-center justify-center transition-all disabled:opacity-50"
                        >
                          <Check className="w-4 h-4 stroke-[2.5]" />
                        </button>
                        <button
                          onClick={() => handleReject(f.id)}
                          disabled={actionLoading[f.id]}
                          className="w-7 h-7 bg-slate-800 hover:bg-slate-700 text-slate-400 hover:text-slate-100 rounded flex items-center justify-center transition-all border border-slate-700 disabled:opacity-50"
                        >
                          <X className="w-4 h-4" />
                        </button>
                      </div>
                    ) : (
                      <span className="text-[10px] text-slate-500 font-semibold uppercase tracking-wider">
                        Fix: {f.action_taken || "NONE"}
                      </span>
                    )}
                  </div>
                </div>

                {/* Mobile Drawer Expansion */}
                {isExpanded && (
                  <div className="border-t border-slate-850 pt-3 space-y-4 text-xs font-mono select-none" onClick={(e) => e.stopPropagation()}>
                    
                    {/* AI explanation */}
                    <div className="bg-slate-950 border border-blue-900/10 rounded-xl p-3.5 space-y-2">
                      <div className="flex items-center gap-1 text-[9px] text-blue-400 font-semibold uppercase tracking-wider">
                        <Sparkles className="w-3.5 h-3.5 text-blue-500" />
                        <span>AI Interpretation</span>
                      </div>
                      <p className="text-slate-355 text-[11px] leading-relaxed italic">
                        "{f.ai_explanation || "No explanation trace returned. Using system core fallback heuristics."}"
                      </p>
                    </div>

                    {/* Code metrics trace */}
                    <div className="bg-slate-950 border border-slate-850 rounded-xl p-3.5 space-y-2">
                      <div className="flex items-center gap-1 text-[9px] text-slate-500 font-semibold uppercase tracking-wider border-b border-slate-900 pb-1.5 mb-1 select-none">
                        <Code className="w-3.5 h-3.5 text-slate-650" />
                        <span>Code Trace</span>
                      </div>

                      <div className="space-y-1.5 text-[10px] text-slate-450">
                        <div className="flex justify-between">
                          <span>Stat Variance:</span>
                          <span>{f.stat_score.toFixed(3)}</span>
                        </div>
                        <div className="flex justify-between">
                          <span>ML Isolation:</span>
                          <span>{f.ml_score.toFixed(3)}</span>
                        </div>
                        <div className="flex justify-between">
                          <span>Rule Weight:</span>
                          <span>{f.rule_score.toFixed(3)}</span>
                        </div>
                        <div className="flex justify-between">
                          <span>Rule Violations:</span>
                          <span className={f.rule_violation ? "text-emerald-500 font-bold" : "text-slate-550"}>
                            {f.rule_violation ? "TRUE" : "FALSE"}
                          </span>
                        </div>
                        <div className="flex justify-between border-t border-slate-900 pt-2 text-[10px]">
                          <span>Original Value:</span>
                          <code className="text-red-400 bg-red-950/20 px-1 py-0.5 rounded truncate max-w-[120px]" title={f.before_value}>
                            {f.before_value === "" ? "[Empty]" : f.before_value}
                          </code>
                        </div>
                        {f.status === "auto_applied" && (
                          <div className="flex justify-between pt-1 text-[10px]">
                            <span>Corrected Value:</span>
                            <code className="text-emerald-400 bg-emerald-950/20 px-1 py-0.5 rounded truncate max-w-[120px]" title={f.after_value}>
                              {f.after_value === null || f.after_value === "None" ? "[Dropped]" : f.after_value}
                            </code>
                          </div>
                        )}
                      </div>
                    </div>

                  </div>
                )}
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}
