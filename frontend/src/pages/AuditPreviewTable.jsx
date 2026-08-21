import React, { useEffect, useState } from "react";
import { API_BASE_URL } from "../api/client";

export default function AuditPreviewTable({ analysisId, refreshTrigger }) {
  const [previewData, setPreviewData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [page, setPage] = useState(1);
  const [limit, setLimit] = useState(25);
  const [totalRows, setTotalRows] = useState(0);

  const loadPreview = async () => {
    try {
      const res = await fetch(`${API_BASE_URL}/api/analyses/${analysisId}/preview?page=${page}&limit=${limit}`, { credentials: "include" });
      if (!res.ok) throw new Error("Failed to load dataset preview");
      const data = await res.json();
      setPreviewData(data);
      setTotalRows(data.total_rows || 0);
    } catch (err) {
      setError(err.message || "Failed to load preview");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (analysisId) {
      loadPreview();
    }
  }, [analysisId, refreshTrigger, page, limit]);

  if (loading) {
    return (
      <div className="py-12 text-center text-slate-500 font-mono text-[11px] select-none flex flex-col items-center justify-center gap-2 bg-slate-900/10 border border-slate-800/30 rounded-xl">
        <div className="w-5 h-5 border border-blue-500 border-t-transparent rounded-full animate-spin"></div>
        <span>COMPILING FILE PREVIEW DIFF...</span>
      </div>
    );
  }

  if (error || !previewData) {
    return (
      <div className="py-8 text-center text-red-500 bg-red-950/10 border border-red-900/30 rounded-xl p-4 font-mono text-[11px] select-none">
        {error || "Failed to load preview"}
      </div>
    );
  }

  const showFrom = totalRows === 0 ? 0 : (page - 1) * limit + 1;
  const showTo = Math.min(totalRows, page * limit);
  const totalPages = Math.max(1, Math.ceil(totalRows / limit));

  return (
    <div className="bg-slate-900 border border-slate-800 rounded-xl p-5 shadow-xl space-y-4">
      <div className="flex items-center justify-between border-b border-slate-800 pb-3">
        <div>
          <h3 className="text-sm font-bold text-slate-100 font-mono tracking-tight uppercase">Final Cleaned Dataset Preview</h3>
          <p className="text-slate-500 text-[11px] font-sans mt-0.5">
            Scroll horizontally to view columns. Changed cells are highlighted in emerald with edit trace tooltips.
          </p>
        </div>
        <span className="text-[10px] font-mono bg-slate-950 px-2 py-1 border border-slate-850 rounded text-slate-400">
          {totalRows} rows total
        </span>
      </div>

      <div className="overflow-x-auto border border-slate-850 rounded-lg">
        <table className="w-full text-left text-xs font-mono border-collapse">
          <thead>
            <tr className="border-b border-slate-800 bg-slate-950/30 text-slate-500 select-none">
              <th className="py-2.5 px-4 text-center border-r border-slate-800 w-12 text-[10px]">#</th>
              {previewData.columns.map((col, idx) => (
                <th key={idx} className="py-2.5 px-4 font-semibold text-slate-450 uppercase text-[10px] tracking-wider select-none">{col}</th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-800/30 text-slate-350 bg-slate-950/5">
            {previewData.rows.map((row, rowIdx) => (
              <tr key={rowIdx} className="hover:bg-slate-900/40 transition-colors">
                <td className="py-2 px-4 text-center border-r border-slate-800 text-[10px] text-slate-650 select-none font-bold bg-slate-950/20">{row.row_index}</td>
                {row.cells.map((cell, colIdx) => (
                  <td 
                    key={colIdx} 
                    className={`py-2 px-4 relative group transition-all duration-150 ${
                      cell.changed 
                        ? "bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 font-bold" 
                        : ""
                    }`}
                  >
                    <span>{cell.value === "" || cell.value === null ? "—" : String(cell.value)}</span>
                    {cell.changed && (
                      <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 hidden group-hover:block bg-slate-955 border border-slate-800 rounded-lg p-3 shadow-2xl z-[999] text-[10.5px] font-mono text-slate-300 pointer-events-none whitespace-nowrap leading-relaxed border-l-2 border-l-emerald-500">
                        <div className="flex gap-1.5"><span className="text-slate-500">Method:</span> <strong className="text-emerald-400 uppercase text-[9.5px] tracking-wide">{cell.method}</strong></div>
                        <div className="flex gap-1.5"><span className="text-slate-500">Original:</span> <span className="text-red-400 line-through">{cell.old_value === "" ? "[Empty]" : cell.old_value}</span></div>
                        <div className="flex gap-1.5"><span className="text-slate-500">Corrected:</span> <span className="text-emerald-400 font-extrabold">{cell.new_value === "" ? "[Empty]" : cell.new_value}</span></div>
                      </div>
                    )}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Pagination Controls */}
      <div className="flex flex-col sm:flex-row items-center justify-between border-t border-slate-850 pt-4 text-xs font-mono text-slate-400 gap-3 select-none">
        <div className="flex items-center gap-2">
          <span>Show</span>
          <select 
            value={limit} 
            onChange={(e) => {
              setLimit(Number(e.target.value));
              setPage(1);
            }}
            className="bg-slate-900 border border-slate-800 rounded px-2 py-1 text-slate-200 outline-none focus:border-blue-500 cursor-pointer"
          >
            {[10, 25, 50, 100].map(sz => (
              <option key={sz} value={sz}>{sz}</option>
            ))}
          </select>
          <span>rows per page</span>
        </div>

        <span>
          Showing {showFrom}–{showTo} of {totalRows} rows
        </span>

        <div className="flex items-center gap-3">
          <span className="text-[10px] text-slate-500">Page {page} of {totalPages}</span>
          <div className="flex gap-2">
            <button
              disabled={page === 1}
              onClick={() => setPage(prev => Math.max(prev - 1, 1))}
              className="px-3 py-1.5 bg-slate-900 border border-slate-800 rounded disabled:opacity-40 cursor-pointer text-slate-350 hover:text-slate-100 disabled:cursor-not-allowed"
            >
              Previous
            </button>
            <button
              disabled={page * limit >= totalRows}
              onClick={() => setPage(prev => prev + 1)}
              className="px-3 py-1.5 bg-slate-900 border border-slate-800 rounded disabled:opacity-40 cursor-pointer text-slate-350 hover:text-slate-100 disabled:cursor-not-allowed"
            >
              Next
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
