import React, { useState, useEffect } from "react";
import { fetchRecentAnalyses, deleteAnalysis } from "../api/client";
import {
  Clock,
  FileSpreadsheet,
  FileText,
  Trash2,
  ExternalLink,
  RotateCcw,
  Search,
  AlertTriangle,
  BarChart2,
  Calendar,
  Database,
} from "lucide-react";

export default function UploadHistory({ user, onRestoreAnalysis, showToast }) {
  const [analyses, setAnalyses] = useState([]);
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState("");
  const [deletingId, setDeletingId] = useState(null);
  const [confirmDeleteId, setConfirmDeleteId] = useState(null);
  const [restoringId, setRestoringId] = useState(null);

  const load = async () => {
    setLoading(true);
    try {
      const list = await fetchRecentAnalyses();
      setAnalyses(list);
    } catch (err) {
      console.error("Failed to fetch analyses:", err);
      showToast("Failed to load upload history", "error");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
  }, [user]);

  const handleDelete = async (id) => {
    setDeletingId(id);
    try {
      await deleteAnalysis(id);
      setAnalyses((prev) => prev.filter((a) => a.id !== id));
      showToast("Analysis deleted", "success");
    } catch (err) {
      showToast("Failed to delete analysis", "error");
    } finally {
      setDeletingId(null);
      setConfirmDeleteId(null);
    }
  };

  const handleRestore = async (analysis) => {
    setRestoringId(analysis.id);
    try {
      await onRestoreAnalysis(analysis);
    } catch (err) {
      showToast("Failed to restore analysis", "error");
    } finally {
      setRestoringId(null);
    }
  };

  const filtered = analyses.filter((a) =>
    (a.filename || "").toLowerCase().includes(searchTerm.toLowerCase())
  );

  const formatDate = (dateStr) => {
    if (!dateStr) return "—";
    const d = new Date(dateStr);
    return d.toLocaleDateString("en-US", {
      year: "numeric",
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  };

  const getScoreColor = (score) => {
    if (score === undefined || score === null) return "text-slate-400";
    if (score >= 90) return "text-emerald-400";
    if (score >= 70) return "text-amber-400";
    return "text-rose-400";
  };

  const getScoreBg = (score) => {
    if (score === undefined || score === null) return "bg-slate-800/40 border-slate-700/40";
    if (score >= 90) return "bg-emerald-500/10 border-emerald-500/20";
    if (score >= 70) return "bg-amber-500/10 border-amber-500/20";
    return "bg-rose-500/10 border-rose-500/20";
  };

  if (!user) {
    return (
      <div className="flex flex-col items-center justify-center py-24 gap-5 text-center">
        <div className="w-16 h-16 bg-slate-800/60 rounded-2xl flex items-center justify-center">
          <Clock className="w-7 h-7 text-slate-500" />
        </div>
        <div>
          <h2 className="text-base font-bold text-slate-200 font-mono">Sign In Required</h2>
          <p className="text-slate-500 text-xs mt-1.5 font-mono">
            Upload history is only available for signed-in users.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-5xl mx-auto py-6 px-4 space-y-6">
      {/* Page Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 bg-indigo-500/10 border border-indigo-500/20 rounded-xl flex items-center justify-center text-indigo-400">
            <Clock className="w-5 h-5" />
          </div>
          <div>
            <h1 className="text-base font-bold text-slate-100 font-mono tracking-tight">Upload History</h1>
            <p className="text-slate-500 text-[10px] font-mono uppercase tracking-wider">
              {analyses.length} saved analysis{analyses.length !== 1 ? "es" : ""}
            </p>
          </div>
        </div>

        {/* Search */}
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-slate-500 pointer-events-none" />
          <input
            type="text"
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            placeholder="Search by filename..."
            className="bg-slate-900 border border-slate-800 focus:border-blue-500/50 rounded-lg pl-8 pr-4 py-2 text-xs text-slate-200 placeholder-slate-600 font-mono focus:outline-none transition-all w-56"
            id="history-search"
          />
        </div>
      </div>

      {/* Content */}
      {loading ? (
        <div className="flex flex-col items-center justify-center py-20 gap-3">
          <div className="w-7 h-7 border-2 border-indigo-500 border-t-transparent rounded-full animate-spin" />
          <p className="text-slate-500 text-xs font-mono">Loading history...</p>
        </div>
      ) : filtered.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-20 gap-5 text-center">
          <div className="w-16 h-16 bg-slate-800/60 border border-slate-800 rounded-2xl flex items-center justify-center">
            <Database className="w-7 h-7 text-slate-600" />
          </div>
          <div>
            <h3 className="text-sm font-bold text-slate-300 font-mono">
              {searchTerm ? "No results found" : "No analyses yet"}
            </h3>
            <p className="text-slate-500 text-xs mt-1.5 font-mono">
              {searchTerm
                ? `No filenames match "${searchTerm}"`
                : "Upload a dataset and run an analysis to see it here."}
            </p>
          </div>
        </div>
      ) : (
        <div className="space-y-3">
          {filtered.map((analysis) => {
            const isDeleting = deletingId === analysis.id;
            const isRestoring = restoringId === analysis.id;
            const isConfirming = confirmDeleteId === analysis.id;
            const score = analysis.after_quality_score ?? analysis.quality_score;
            const isXlsx = (analysis.filename || "").endsWith(".xlsx");

            return (
              <div
                key={analysis.id}
                className="bg-slate-900 border border-slate-800 rounded-xl p-4 shadow-md hover:border-slate-700 transition-all group"
              >
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                  {/* Left: File info */}
                  <div className="flex items-start gap-3 min-w-0">
                    <div className="w-9 h-9 rounded-lg bg-slate-800/70 border border-slate-700/40 flex items-center justify-center text-brand-400 shrink-0 mt-0.5">
                      {isXlsx ? (
                        <FileSpreadsheet className="w-4.5 h-4.5" />
                      ) : (
                        <FileText className="w-4.5 h-4.5" />
                      )}
                    </div>
                    <div className="min-w-0 space-y-1">
                      <p className="text-sm font-bold text-slate-100 font-mono truncate">
                        {analysis.filename || "Untitled Dataset"}
                      </p>
                      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-[10px] text-slate-500 font-mono">
                        {analysis.rows !== undefined && (
                          <span className="flex items-center gap-1">
                            <BarChart2 className="w-3 h-3" />
                            {analysis.rows?.toLocaleString()} rows × {analysis.columns} cols
                          </span>
                        )}
                        <span className="flex items-center gap-1">
                          <Calendar className="w-3 h-3" />
                          {formatDate(analysis.created_at)}
                        </span>
                        <span className={`px-1.5 py-0.5 rounded font-bold text-[9px] uppercase tracking-wider ${
                          analysis.status === "completed"
                            ? "bg-emerald-500/10 text-emerald-400 border border-emerald-500/20"
                            : analysis.status === "failed"
                            ? "bg-rose-500/10 text-rose-400 border border-rose-500/20"
                            : "bg-amber-500/10 text-amber-400 border border-amber-500/20"
                        }`}>
                          {analysis.status || "unknown"}
                        </span>
                      </div>
                    </div>
                  </div>

                  {/* Right: Score + Actions */}
                  <div className="flex items-center gap-3 shrink-0 flex-wrap justify-end">
                    {/* Quality Score Badge */}
                    {score !== undefined && score !== null && (
                      <div className={`px-3 py-1.5 rounded-lg border font-mono text-center ${getScoreBg(score)}`}>
                        <p className="text-[8.5px] text-slate-500 uppercase tracking-wider font-bold">Quality</p>
                        <p className={`text-sm font-extrabold ${getScoreColor(score)}`}>
                          {typeof score === "number" ? score.toFixed(1) : score}%
                        </p>
                      </div>
                    )}

                    {/* Action Buttons */}
                    {isConfirming ? (
                      <div className="flex items-center gap-2">
                        <span className="text-[10px] text-rose-400 font-mono font-semibold">Confirm delete?</span>
                        <button
                          onClick={() => handleDelete(analysis.id)}
                          disabled={isDeleting}
                          className="px-2.5 py-1 rounded-lg text-[10px] font-bold bg-rose-600 hover:bg-rose-500 text-white transition-all disabled:opacity-50 cursor-pointer"
                        >
                          {isDeleting ? "Deleting..." : "Yes, Delete"}
                        </button>
                        <button
                          onClick={() => setConfirmDeleteId(null)}
                          className="px-2.5 py-1 rounded-lg text-[10px] font-semibold border border-slate-700 text-slate-400 hover:text-slate-200 hover:bg-slate-800 transition-all cursor-pointer"
                        >
                          Cancel
                        </button>
                      </div>
                    ) : (
                      <div className="flex items-center gap-2">
                        {analysis.status === "completed" && (
                          <button
                            onClick={() => handleRestore(analysis)}
                            disabled={isRestoring}
                            title="Open this analysis"
                            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[10px] font-bold bg-blue-600 hover:bg-blue-500 text-white transition-all active:scale-95 disabled:opacity-50 cursor-pointer shadow-sm"
                          >
                            {isRestoring ? (
                              <>
                                <span className="w-3 h-3 border-2 border-white border-t-transparent rounded-full animate-spin" />
                                <span>Opening...</span>
                              </>
                            ) : (
                              <>
                                <ExternalLink className="w-3 h-3" />
                                <span>Open</span>
                              </>
                            )}
                          </button>
                        )}
                        <button
                          onClick={() => setConfirmDeleteId(analysis.id)}
                          title="Delete this analysis"
                          className="w-7 h-7 flex items-center justify-center rounded-lg border border-slate-800 text-slate-500 hover:text-rose-400 hover:border-rose-500/30 hover:bg-rose-500/10 transition-all cursor-pointer"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    )}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
