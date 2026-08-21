import React, { useState, useEffect, useRef } from "react";
import { Check, X, ShieldCheck, Sparkles, Code, Info, Pencil, AlertTriangle, Trash2 } from "lucide-react";
import { approveFinding, rejectFinding } from "../api/client";

export default function ReviewQueue({ findings, analysisId, onFindingsUpdated, queueFilter, onClearFilter }) {
  const [activeIndex, setActiveIndex] = useState(0);
  const [actionLoading, setActionLoading] = useState({});
  const [expandedId, setExpandedId] = useState(null);
  const [editMode, setEditMode] = useState(false);
  const [editInput, setEditInput] = useState("");
  const [showChoicesForMissing, setShowChoicesForMissing] = useState(false);
  const rowRefs = useRef([]);
  const editInputRef = useRef(null);

  // Filter for pending review findings
  const queueItems = findings.filter((f) => {
    if (queueFilter === "unresolved_missing") {
      return f.issue_type === "missing_value" && f.status === "pending_review";
    }
    return f.status === "pending_review";
  });

  const activeItem = queueItems[activeIndex];
  const hasDeterministicFix = activeItem && activeItem.after_value && activeItem.after_value !== "Flagged for manual review — awaiting user input";

  // Sync index boundary when queue items change
  useEffect(() => {
    if (activeIndex >= queueItems.length) {
      setActiveIndex(Math.max(0, queueItems.length - 1));
    }
  }, [queueItems.length, activeIndex]);

  // Reset edit states when index changes
  useEffect(() => {
    setEditMode(false);
    setEditInput("");
    setShowChoicesForMissing(false);
  }, [activeIndex]);

  // Keyboard navigation listeners
  useEffect(() => {
    const handleKeyDown = (e) => {
      if (queueItems.length === 0) return;

      const activeItem = queueItems[activeIndex];
      if (!activeItem) return;

      const hasDeterministicFix = activeItem.after_value && activeItem.after_value !== "Flagged for manual review — awaiting user input";

      if (e.target.tagName === "INPUT" || e.target.tagName === "TEXTAREA" || e.target.isContentEditable) {
        if (e.key === "Enter") {
          e.preventDefault();
          if (editInput.trim()) {
            handleApprove(activeItem.id, editInput);
          }
        } else if (e.key === "Escape") {
          e.preventDefault();
          setEditMode(false);
          setEditInput("");
        }
        return;
      }

      if (e.key === "ArrowDown") {
        e.preventDefault();
        const nextIdx = Math.min(activeIndex + 1, queueItems.length - 1);
        setActiveIndex(nextIdx);
        setExpandedId(queueItems[nextIdx].id);
        scrollRowIntoView(nextIdx);
      } else if (e.key === "ArrowUp") {
        e.preventDefault();
        const prevIdx = Math.max(activeIndex - 1, 0);
        setActiveIndex(prevIdx);
        setExpandedId(queueItems[prevIdx].id);
        scrollRowIntoView(prevIdx);
      } else if (e.key === "Enter" || e.key.toLowerCase() === "a") {
        e.preventDefault();
        if (editMode && editInput) {
          handleApprove(activeItem.id, editInput);
        } else if (activeItem.issue_type === "missing_value" && !editInput) {
          setShowChoicesForMissing(true);
        } else if (!hasDeterministicFix && !editInput) {
          setEditMode(true);
          setEditInput("");
        } else {
          handleApprove(activeItem.id);
        }
      } else if (e.key === "Escape" || e.key.toLowerCase() === "r") {
        e.preventDefault();
        handleReject(activeItem.id);
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [activeIndex, queueItems, editMode, editInput]);

  // Automatically expand the active row's trace details
  useEffect(() => {
    if (queueItems.length > 0 && queueItems[activeIndex]) {
      setExpandedId(queueItems[activeIndex].id);
    } else {
      setExpandedId(null);
    }
  }, [activeIndex, queueItems.length]);

  const scrollRowIntoView = (idx) => {
    const ref = rowRefs.current[idx];
    if (ref) {
      ref.scrollIntoView({ behavior: "smooth", block: "nearest" });
    }
  };

  const handleApprove = async (findingId, customValue = undefined, customAction = undefined) => {
    if (actionLoading[findingId]) return;
    setActionLoading((prev) => ({ ...prev, [findingId]: true }));
    try {
      let payload = null;
      if (customAction) {
        payload = { action: customAction };
      } else if (customValue !== undefined) {
        payload = { action: "MANUAL_EDIT", value: customValue };
      }
      await approveFinding(analysisId, findingId, payload);
      onFindingsUpdated();
      setEditMode(false);
      setEditInput("");
      setShowChoicesForMissing(false);
    } catch (err) {
      alert(err.message || "Failed to approve recommended action");
    } finally {
      setActionLoading((prev) => ({ ...prev, [findingId]: false }));
    }
  };

  const isEmailColumn = (col) => {
    return col && col.toLowerCase().includes("email");
  };

  const validateEmail = (email) => {
    return /\S+@\S+\.\S+/.test(email);
  };

  const handleReject = async (findingId) => {
    if (actionLoading[findingId]) return;
    setActionLoading((prev) => ({ ...prev, [findingId]: true }));
    try {
      await rejectFinding(analysisId, findingId);
      onFindingsUpdated();
    } catch (err) {
      alert(err.message || "Failed to reject recommended action");
    } finally {
      setActionLoading((prev) => ({ ...prev, [findingId]: false }));
    }
  };

  const formatIssueType = (issue) => {
    return issue.split("_").map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join(" ");
  };

  if (queueItems.length === 0) {
    return (
      <div className="bg-slate-900 border border-slate-800 rounded-xl p-16 text-center shadow-xl max-w-2xl mx-auto my-8">
        <div className="w-16 h-16 bg-emerald-500/10 text-emerald-400 rounded-full flex items-center justify-center mx-auto mb-6 border border-emerald-500/20">
          <ShieldCheck className="w-8 h-8" />
        </div>
        <h3 className="text-xl font-bold text-slate-100 font-mono tracking-tight mb-2">Resolve Queue Clear</h3>
        <p className="text-slate-450 text-sm max-w-md mx-auto">
          All medium-confidence anomalies have been triaged. The dataset is structurally clean and ready for export.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-6 py-2">
      {/* queueFilter banner */}
      {queueFilter === "unresolved_missing" && (
        <div className="bg-blue-950/20 border border-blue-900/30 rounded-xl p-3.5 flex items-center justify-between text-xs font-mono text-blue-400 select-none">
          <span>Displaying only unresolved missing values to allow certified export.</span>
          <button 
            onClick={onClearFilter}
            className="text-blue-400 hover:text-blue-200 underline font-semibold cursor-pointer"
          >
            Show full queue
          </button>
        </div>
      )}

      {/* Keyboard Helper Banner */}
      <div className="bg-slate-900/60 border border-slate-800 rounded-xl p-3.5 flex flex-wrap items-center justify-between gap-4 text-xs font-mono text-slate-400 select-none">
        <div className="flex items-center gap-2">
          <Code className="w-4 h-4 text-blue-500" />
          <span>Active Queue Triage Controls:</span>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <span className="bg-slate-950 border border-slate-800 px-2 py-0.5 rounded text-slate-350">
            <kbd>↑</kbd>/<kbd>↓</kbd> Navigate
          </span>
          <span className="bg-slate-950 border border-slate-800 px-2 py-0.5 rounded text-emerald-400 font-bold">
            <kbd>Enter</kbd> or <kbd>A</kbd> Approve
          </span>
          <span className="bg-slate-950 border border-slate-800 px-2 py-0.5 rounded text-slate-400">
            <kbd>Esc</kbd> or <kbd>R</kbd> Reject
          </span>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
        {/* Left: Queue List */}
        <div className="lg:col-span-5 space-y-3 max-h-[600px] overflow-y-auto pr-1">
          {queueItems.map((f, idx) => {
            const isActive = activeIndex === idx;
            const colName = f.column === "ALL_COLUMNS" ? "Full Row" : f.column;

            return (
              <div
                key={f.id}
                ref={(el) => (rowRefs.current[idx] = el)}
                onClick={() => {
                  setActiveIndex(idx);
                  setExpandedId(f.id);
                }}
                className={`border rounded-xl p-4 transition-all duration-150 cursor-pointer relative overflow-hidden select-none ${
                  isActive
                    ? "bg-slate-900 border-blue-500 shadow-lg shadow-blue-500/5 ring-1 ring-blue-500/50"
                    : "bg-slate-900/50 border-slate-800 hover:border-slate-700"
                }`}
                tabIndex={0}
                onFocus={() => setActiveIndex(idx)}
                aria-label={`Anomaly in column ${colName}, row ${f.row_index}`}
              >
                <div className="flex items-start justify-between gap-4">
                  <div className="space-y-1">
                    <div className="flex items-center gap-2">
                      <span className="font-mono text-sm font-semibold text-slate-100 truncate max-w-[140px] md:max-w-none">
                        {colName}
                      </span>
                      <span className="font-mono text-xs text-slate-500 bg-slate-950 px-2 py-0.5 rounded">
                        r{f.row_index}
                      </span>
                    </div>
                    <div className="text-slate-400 text-xs font-semibold">
                      {formatIssueType(f.issue_type)}
                    </div>
                  </div>

                  <div className="flex items-center gap-3">
                    <span className="font-mono font-bold text-xs bg-amber-500/10 text-amber-400 border border-amber-500/20 px-2.5 py-0.5 rounded-full">
                      {(f.confidence * 100).toFixed(0)}%
                    </span>
                    
                    <div className="flex items-center gap-1.5" onClick={(e) => e.stopPropagation()}>
                      <button
                        onClick={() => handleApprove(f.id)}
                        disabled={actionLoading[f.id]}
                        className="w-7 h-7 bg-green-500 hover:bg-green-600 active:scale-90 text-white rounded-lg flex items-center justify-center transition-all disabled:opacity-50"
                        title="Approve [Enter/A]"
                      >
                        {actionLoading[f.id] ? (
                          <div className="w-3.5 h-3.5 border border-white border-t-transparent rounded-full animate-spin"></div>
                        ) : (
                          <Check className="w-4 h-4" />
                        )}
                      </button>
                      <button
                        onClick={() => handleReject(f.id)}
                        disabled={actionLoading[f.id]}
                        className="w-7 h-7 bg-slate-800 hover:bg-slate-700 active:scale-90 text-slate-400 hover:text-slate-100 rounded-lg flex items-center justify-center transition-all border border-slate-700 disabled:opacity-50"
                        title="Reject [Esc/R]"
                      >
                        {actionLoading[f.id] ? (
                          <div className="w-3.5 h-3.5 border border-slate-500 border-t-transparent rounded-full animate-spin"></div>
                        ) : (
                          <X className="w-4 h-4" />
                        )}
                      </button>
                    </div>
                  </div>
                </div>

                {isActive && (
                  <div className="absolute left-0 top-0 bottom-0 w-1 bg-blue-500"></div>
                )}
              </div>
            );
          })}
        </div>

        {/* Right: Focused Signature Details Drawer */}
        <div className="lg:col-span-7 bg-slate-900 border border-slate-800 rounded-xl p-5 shadow-xl min-h-[460px] flex flex-col">
          {expandedId && queueItems[activeIndex] ? (
            <div className="space-y-6 flex-1 flex flex-col justify-between">
              {/* Header Info */}
              <div className="border-b border-slate-800 pb-4">
                <div className="flex items-baseline justify-between mb-1">
                  <h4 className="text-base font-bold text-slate-100 font-mono flex items-center gap-2">
                    <span>{queueItems[activeIndex].column === "ALL_COLUMNS" ? "Full Row Check" : queueItems[activeIndex].column}</span>
                    <span className="text-slate-500 text-xs font-normal font-mono">Row Index: {queueItems[activeIndex].row_index}</span>
                  </h4>
                  <span className="font-mono text-xs text-amber-400 font-semibold bg-amber-500/5 border border-amber-500/20 px-3 py-1 rounded-full">
                    Confidence: {(queueItems[activeIndex].confidence * 100).toFixed(0)}%
                  </span>
                </div>
                <p className="text-slate-400 text-xs">
                  Issue Type: <span className="font-semibold text-slate-300">{formatIssueType(queueItems[activeIndex].issue_type)}</span>
                </p>
              </div>

              {/* Core Signature Element split layout */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-5 flex-1 py-2">
                
                {/* Left Drawer Block: AI Reasoning */}
                <div className="bg-slate-950 border border-blue-900/10 rounded-xl p-4 space-y-3 relative overflow-hidden flex flex-col">
                  <div className="flex items-center gap-1.5 text-xs text-blue-400 font-semibold uppercase tracking-wider select-none">
                    <Sparkles className="w-4 h-4 text-blue-500" />
                    <span>AI Interpretation</span>
                  </div>
                  
                  <div className="flex-1 flex flex-col justify-between space-y-4">
                    <p className="text-slate-300 text-xs leading-relaxed italic">
                      "{queueItems[activeIndex].ai_explanation || "No explanation trace returned. Using offline rule weights and statistical variance thresholds."}"
                    </p>
                    
                    <div className="border-t border-slate-900 pt-3">
                      <span className="text-slate-500 text-[10px] uppercase font-mono tracking-wider font-semibold block mb-0.5">Recommended Action</span>
                      <code className="text-blue-400 text-xs font-mono font-bold">
                        {queueItems[activeIndex].ai_recommended_action || "flag_for_review"}
                      </code>
                    </div>
                  </div>
                  
                  {/* Subtle AI branding indicator */}
                  <div className="absolute right-3 bottom-3 opacity-5 text-blue-500 select-none">
                    <Sparkles className="w-16 h-16" />
                  </div>
                </div>

                {/* Right Drawer Block: Code Trace */}
                <div className="bg-slate-950 border border-slate-800 rounded-xl p-4 flex flex-col font-mono">
                  <div className="flex items-center gap-1.5 text-xs text-slate-400 font-semibold uppercase tracking-wider border-b border-slate-900 pb-2 mb-3 select-none">
                    <Code className="w-4 h-4 text-slate-500" />
                    <span>Offline System Code Trace</span>
                  </div>

                  <div className="space-y-3 text-xs flex-1 flex flex-col justify-between">
                    <div className="space-y-2">
                      <div className="flex justify-between items-center">
                        <span className="text-slate-500">Stat Variance Score:</span>
                        <span className="text-slate-350 font-semibold">{queueItems[activeIndex].stat_score.toFixed(3)}</span>
                      </div>
                      <div className="flex justify-between items-center">
                        <span className="text-slate-500">Isolation Forest score:</span>
                        <span className="text-slate-350 font-semibold">{queueItems[activeIndex].ml_score.toFixed(3)}</span>
                      </div>
                      <div className="flex justify-between items-center">
                        <span className="text-slate-500">Logical Rule weight:</span>
                        <span className="text-slate-350 font-semibold">{queueItems[activeIndex].rule_score.toFixed(3)}</span>
                      </div>
                      <div className="flex justify-between items-center">
                        <span className="text-slate-500">Hard Rule Violation:</span>
                        <span className={queueItems[activeIndex].rule_violation ? "text-emerald-500 font-bold" : "text-slate-500"}>
                          {queueItems[activeIndex].rule_violation ? "TRUE (Floored)" : "FALSE"}
                        </span>
                      </div>
                    </div>

                    <div className="border-t border-slate-900 pt-3 space-y-2">
                      <div className="flex justify-between items-baseline">
                        <span className="text-slate-500">Original Cell Value:</span>
                        <code 
                          className="text-red-400 bg-red-950/20 px-2 py-0.5 rounded truncate max-w-[120px] cursor-pointer hover:bg-red-950/15" 
                          title="Click to edit value"
                          onClick={() => {
                            setEditMode(true);
                            setEditInput("");
                            setShowChoicesForMissing(false);
                          }}
                        >
                          {queueItems[activeIndex].before_value === "" || queueItems[activeIndex].before_value === null ? "[Empty]" : queueItems[activeIndex].before_value}
                        </code>
                      </div>
                      <div className="flex justify-between items-baseline">
                        <span className="text-slate-500">Proposed Cell Value:</span>
                        <code className="text-emerald-400 bg-emerald-950/20 px-2 py-0.5 rounded truncate max-w-[120px]">
                          {editMode ? (
                            editInput || <span className="opacity-50">[Empty]</span>
                          ) : (
                            queueItems[activeIndex].after_value || <span className="opacity-50">[Empty]</span>
                          )}
                        </code>
                      </div>
                    </div>
                  </div>
                </div>

              </div>

              {/* Edit Mode Inline Panel */}
              {editMode && (
                <div className="bg-slate-950 border border-slate-800 rounded-xl p-4 space-y-3 font-mono mt-3">
                  <div className="flex items-center gap-1.5 text-xs text-blue-400 font-semibold uppercase tracking-wider select-none">
                    <Pencil className="w-4 h-4 text-blue-500" />
                    <span>Enter Correct Value</span>
                  </div>
                  <div className="flex gap-2">
                    <input
                      type="text"
                      ref={editInputRef}
                      className="bg-slate-900 border border-slate-800 rounded px-3 py-1.5 text-slate-100 text-xs flex-1 focus:outline-none focus:border-blue-500 font-mono"
                      value={editInput}
                      onChange={(e) => setEditInput(e.target.value)}
                      placeholder="Enter the correct value..."
                      autoFocus
                    />
                    <button
                      className="px-3 py-1.5 bg-blue-600 hover:bg-blue-500 text-slate-100 rounded text-xs font-semibold cursor-pointer"
                      onClick={() => {
                        if (editInput.trim()) {
                          handleApprove(queueItems[activeIndex].id, editInput);
                        }
                      }}
                      disabled={!editInput.trim()}
                    >
                      Apply
                    </button>
                    <button 
                      className="px-3 py-1.5 bg-slate-800 hover:bg-slate-700 text-slate-400 rounded text-xs cursor-pointer" 
                      onClick={() => {
                        setEditMode(false);
                        setEditInput("");
                      }}
                    >
                      Cancel
                    </button>
                  </div>
                  {/* Email validation warning */}
                  {isEmailColumn(queueItems[activeIndex].column) && editInput && !validateEmail(editInput) && (
                    <p className="text-amber-500 text-[10.5px] font-sans flex items-center gap-1 mt-1">
                      <AlertTriangle className="w-3.5 h-3.5 shrink-0" />
                      <span>Value does not look like a valid email address.</span>
                    </p>
                  )}
                </div>
              )}

              {/* Choices Resolution Block */}
              {showChoicesForMissing && queueItems[activeIndex].issue_type === "missing_value" && (
                <div className="bg-slate-950 border border-amber-500/25 rounded-xl p-4 space-y-3 font-mono mt-3">
                  <div className="flex items-center gap-1.5 text-xs text-amber-400 font-semibold uppercase tracking-wider select-none">
                    <AlertTriangle className="w-4 h-4 text-amber-500" />
                    <span>Resolve Missing Value</span>
                  </div>
                  <p className="text-slate-350 text-xs font-sans leading-relaxed">
                    No custom value was entered. Choose how to handle this blank cell:
                  </p>
                  <div className="flex flex-col sm:flex-row gap-2">
                    <button
                      className="px-3 py-1.5 bg-slate-800 hover:bg-slate-750 text-slate-205 rounded text-xs font-semibold cursor-pointer border border-slate-700"
                      onClick={() => {
                        setEditMode(true);
                        setShowChoicesForMissing(false);
                        setTimeout(() => {
                          if (editInputRef.current) editInputRef.current.focus();
                        }, 50);
                      }}
                    >
                      Enter value now
                    </button>
                    <button
                      className="px-3 py-1.5 bg-rose-600 hover:bg-rose-500 text-slate-100 rounded text-xs font-semibold cursor-pointer"
                      onClick={() => {
                        handleApprove(queueItems[activeIndex].id, undefined, "drop");
                      }}
                    >
                      Drop this row
                    </button>
                    <button
                      className="px-3 py-1.5 bg-slate-800 hover:bg-slate-750 text-slate-205 rounded text-xs font-semibold cursor-pointer border border-slate-700"
                      onClick={() => {
                        handleApprove(queueItems[activeIndex].id, undefined, "leave_blank");
                      }}
                    >
                      Leave blank and export anyway
                    </button>
                  </div>
                </div>
              )}

              {/* Action bar */}
              <div className="border-t border-slate-800 pt-4 flex items-center justify-between gap-4 mt-auto">
                <span className="text-slate-500 text-xs font-mono select-none">
                  Item {activeIndex + 1} of {queueItems.length}
                </span>

                <div className="flex items-center gap-3">
                  {!editMode && (
                    <button
                      onClick={() => {
                        setEditMode(true);
                        setEditInput("");
                        setShowChoicesForMissing(false);
                      }}
                      className="bg-slate-800 hover:bg-slate-700 active:scale-95 text-slate-300 hover:text-slate-100 px-4 py-2 rounded-lg border border-slate-700 text-xs font-semibold flex items-center gap-1.5 transition-all focus:outline-none focus:ring-2 focus:ring-slate-500 font-sans"
                    >
                      <Pencil className="w-4 h-4" />
                      <span>Edit Value</span>
                    </button>
                  )}

                  <button
                    onClick={() => handleApprove(queueItems[activeIndex].id, undefined, "drop")}
                    disabled={actionLoading[queueItems[activeIndex].id]}
                    className="bg-rose-950/20 hover:bg-rose-950/40 active:scale-95 text-rose-450 hover:text-rose-200 px-4 py-2 rounded-lg border border-rose-900/30 text-xs font-semibold flex items-center gap-1.5 transition-all disabled:opacity-50 focus:outline-none focus:ring-2 focus:ring-rose-550 font-sans"
                    title="Drop this entire row from the dataset"
                  >
                    <Trash2 className="w-4 h-4" />
                    <span>Drop Row</span>
                  </button>

                  <button
                    onClick={() => handleReject(queueItems[activeIndex].id)}
                    disabled={actionLoading[queueItems[activeIndex].id]}
                    className="bg-slate-800 hover:bg-slate-700 active:scale-95 text-slate-300 hover:text-slate-100 px-4 py-2 rounded-lg border border-slate-700 text-xs font-semibold flex items-center gap-1.5 transition-all disabled:opacity-50 focus:outline-none focus:ring-2 focus:ring-slate-500 font-sans"
                  >
                    <X className="w-4 h-4" />
                    <span>Reject [Esc]</span>
                  </button>

                  <button
                    onClick={() => {
                      if (editMode && editInput) {
                        handleApprove(queueItems[activeIndex].id, editInput);
                      } else if (queueItems[activeIndex].issue_type === "missing_value" && !editInput) {
                        setShowChoicesForMissing(true);
                      } else if (!hasDeterministicFix && !editInput) {
                        setEditMode(true);
                        setEditInput("");
                      } else {
                        handleApprove(queueItems[activeIndex].id);
                      }
                    }}
                    disabled={actionLoading[queueItems[activeIndex].id]}
                    className="bg-emerald-600 hover:bg-emerald-500 active:scale-95 text-slate-950 px-4 py-2 rounded-lg text-xs font-extrabold flex items-center gap-1.5 transition-all disabled:opacity-50 focus:outline-none focus:ring-2 focus:ring-emerald-500 font-sans"
                  >
                    <Check className="w-4 h-4 stroke-[3px]" />
                    <span>Approve [Enter]</span>
                  </button>
                </div>
              </div>
            </div>
          ) : (
            <div className="flex-1 flex flex-col items-center justify-center text-slate-500 font-mono text-xs">
              <span>Select an item in the queue to load traces</span>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
