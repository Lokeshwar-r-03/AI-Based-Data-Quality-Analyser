import React, { useState, useMemo, useEffect, useRef } from "react";
import {
  X, Check, ChevronDown, ChevronUp, ChevronsUpDown, Search,
  Filter, SlidersHorizontal, AlertTriangle, CheckCircle2, XCircle,
  Sparkles, Code, ArrowRight, RotateCcw, Eye, ShieldAlert,
  FileWarning, Copy, Layers, FileX, ChevronRight, Database,
  BarChart3, Activity, Pencil, MessageSquare, Zap, Shield,
  TrendingUp, GitBranch, Wrench, FileSpreadsheet, FileJson, FileText, Trash2
} from "lucide-react";
import { approveFinding, rejectFinding, revertFinding, API_BASE_URL } from "../api/client";
import ImputationSelector from "./ImputationSelector";
import AuditPreviewTable from "./AuditPreviewTable";

// ─── Helpers ───────────────────────────────────────────────────────────
const formatIssueType = (issue) =>
  issue.split("_").map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join(" ");

const getDetectionMethod = (f) => {
  if (!f || f._clean) return "—";
  const { stat_score = 0, ml_score = 0, rule_score = 0, rule_violation } = f;
  if (rule_violation) return "Rule-Based";
  const max = Math.max(stat_score, ml_score, rule_score);
  if (max === 0) return "Rule-Based";
  if (max === ml_score) return "Isolation Forest";
  if (max === stat_score) return "Z-Score";
  return "Rule-Based";
};

// Returns array of all methods that contributed (score > 0)
const getActiveDetectionMethods = (f) => {
  if (!f || f._clean) return [];
  const methods = [];
  if (f.stat_score > 0) methods.push({ name: "Z-Score", score: f.stat_score, icon: TrendingUp, color: "#3B82F6" });
  if (f.ml_score > 0) methods.push({ name: "Isolation Forest", score: f.ml_score, icon: GitBranch, color: "#8B5CF6" });
  if (f.rule_score > 0 || f.rule_violation) methods.push({ name: "Rule-Based", score: f.rule_score, icon: Shield, color: "#F59E0B" });
  if (methods.length === 0) methods.push({ name: "Rule-Based", score: 0, icon: Shield, color: "#F59E0B" });
  return methods;
};

// Derive a human-readable suggested fix from the finding data
const getSuggestedFix = (f) => {
  if (!f) return { action: "Flag for manual review", detail: "Review this data point manually" };
  const action = f.ai_recommended_action || "flag_for_review";
  const map = {
    impute: { action: "Replace with median", detail: "Impute this missing/anomalous value with the column median to maintain statistical consistency" },
    drop: { action: "Remove row", detail: "Drop this entire row from the dataset as it contains irrecoverable data quality issues" },
    cap: { action: "Cap to boundary", detail: "Winsorize this outlier value to the nearest acceptable boundary (IQR fence)" },
    correct_formula: { action: "Apply formula correction", detail: "Recalculate this cell using the correct cross-field formula" },
    normalize_format: { action: "Normalize format", detail: "Standardize this value to match the expected column format" },
    flag_for_review: { action: "Flag for manual review", detail: "This finding requires human judgment — review the context before deciding" },
    keep_no_action: { action: "Keep as-is", detail: "No action recommended — the value appears acceptable despite being flagged" },
  };
  return map[action] || { action: formatIssueType(action), detail: "Review the suggested correction before applying" };
};

const getConfidencePercent = (f) => {
  if (!f || f._clean) return 0;
  return Math.round((f.confidence || 0) * 100);
};

const isEmailColumn = (col) => {
  return col && col.toLowerCase().includes("email");
};

const validateEmail = (email) => {
  return /\S+@\S+\.\S+/.test(email);
};

const ISSUE_COLORS = {
  outlier: { bg: "#FFF7ED", text: "#C2410C", border: "#FDBA74", icon: AlertTriangle },
  missing_value: { bg: "#FEF2F2", text: "#B91C1C", border: "#FCA5A5", icon: FileX },
  duplicate: { bg: "#F0FDF4", text: "#15803D", border: "#86EFAC", icon: Copy },
  invalid_format: { bg: "#FDF4FF", text: "#7E22CE", border: "#D8B4FE", icon: FileWarning },
  rule_violation: { bg: "#FFF1F2", text: "#BE123C", border: "#FDA4AF", icon: ShieldAlert },
  cross_field_mismatch: { bg: "#FFFBEB", text: "#A16207", border: "#FDE68A", icon: Layers },
  clean: { bg: "#F0FDF4", text: "#166534", border: "#BBF7D0", icon: CheckCircle2 },
};

const DETECTION_METHODS = ["Z-Score", "IQR", "Isolation Forest", "Rule-Based"];

// ─── Component ─────────────────────────────────────────────────────────
export default function DataCleaningReview({ findings, analysisId, dataset, onFindingsUpdated, onNavigateToQueue, refreshTrigger }) {
  // ── State ──
  const [drawerFinding, setDrawerFinding] = useState(null);
  const [actionLoading, setActionLoading] = useState({});
  const [sortBy, setSortBy] = useState("confidence");
  const [sortOrder, setSortOrder] = useState("desc");
  const [searchTerm, setSearchTerm] = useState("");
  const [showCleanRows, setShowCleanRows] = useState(false);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [editMode, setEditMode] = useState(false);
  const [editInput, setEditInput] = useState("");
  const [explainingId, setExplainingId] = useState(null);
  const [showChoicesForMissing, setShowChoicesForMissing] = useState(false);
  const [showBlockedModal, setShowBlockedModal] = useState(false);
  const drawerRef = useRef(null);

  const [selectedCategory, setSelectedCategory] = useState("all");
  const [imputationPreviews, setImputationPreviews] = useState(null);

  const triggerRefresh = () => {
    if (onFindingsUpdated) onFindingsUpdated();
  };

  useEffect(() => {
    const fetchImputationPreviews = async () => {
      try {
        const res = await fetch(`${API_BASE_URL}/api/analyses/${analysisId}/imputation-previews`, { credentials: "include" });
        if (res.ok) {
          const data = await res.json();
          setImputationPreviews(data);
        }
      } catch (err) {
        console.error("Failed to load imputation previews:", err);
      }
    };
    if (analysisId) {
      fetchImputationPreviews();
    }
  }, [analysisId, refreshTrigger]);

  const handleBatchImpute = async (column, method, value = undefined) => {
    if (!drawerFinding) return;
    setActionLoading((p) => ({ ...p, [drawerFinding.id]: true }));
    try {
      const res = await fetch(`${API_BASE_URL}/api/analyses/${analysisId}/impute-column`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ column, method, value }),
        credentials: "include"
      });
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.detail || "Batch imputation failed");
      }
      triggerRefresh();
      setDrawerFinding(null);
    } catch (err) {
      alert(err.message || "Failed to run batch imputation");
    } finally {
      setActionLoading((p) => ({ ...p, [drawerFinding.id]: false }));
    }
  };

  useEffect(() => {
    setShowChoicesForMissing(false);
  }, [drawerFinding]);

  const unresolvedMissing = findings.filter(
    (f) => f.issue_type === "missing_value" && f.status === "pending_review"
  );

  const handleExportClick = (e) => {
    if (unresolvedMissing.length > 0) {
      e.preventDefault();
      setShowBlockedModal(true);
    }
  };

  // ── Filters ──
  const [filterIssueTypes, setFilterIssueTypes] = useState([]);
  const [filterColumns, setFilterColumns] = useState([]);
  const [filterConfRange, setFilterConfRange] = useState([0, 100]);
  const [filterMethods, setFilterMethods] = useState([]);
  const [filterStatus, setFilterStatus] = useState("all");

  // ── Derived Data ──
  const uniqueColumns = useMemo(() => {
    const cols = new Set();
    findings.forEach((f) => {
      if (f.column !== "ALL_COLUMNS") cols.add(f.column);
    });
    return Array.from(cols).sort();
  }, [findings]);

  const issueTypeCounts = useMemo(() => {
    const counts = {};
    findings.forEach((f) => {
      counts[f.issue_type] = (counts[f.issue_type] || 0) + 1;
    });
    return counts;
  }, [findings]);

  const allIssueTypes = useMemo(() => Object.keys(issueTypeCounts).sort(), [issueTypeCounts]);

  // Build augmented rows (findings + optional clean rows)
  const allRows = useMemo(() => {
    const flaggedRowIndices = new Set(findings.map((f) => f.row_index));
    const rows = findings.map((f) => ({ ...f, _clean: false }));

    if (showCleanRows && dataset?.row_count) {
      for (let i = 0; i < dataset.row_count; i++) {
        if (!flaggedRowIndices.has(i)) {
          rows.push({
            id: `clean-${i}`,
            row_index: i,
            column: "—",
            issue_type: "clean",
            confidence: 0,
            stat_score: 0,
            ml_score: 0,
            rule_score: 0,
            rule_violation: false,
            status: "clean",
            _clean: true,
          });
        }
      }
    }
    return rows;
  }, [findings, showCleanRows, dataset]);

  // Filter + Sort
  const filteredRows = useMemo(() => {
    let rows = allRows;

    // Search
    if (searchTerm) {
      const term = searchTerm.toLowerCase();
      rows = rows.filter(
        (r) =>
          r.column.toLowerCase().includes(term) ||
          formatIssueType(r.issue_type).toLowerCase().includes(term) ||
          String(r.row_index).includes(term)
      );
    }

    // Selected category filter
    if (selectedCategory !== "all") {
      if (selectedCategory === "resolve_queue") {
        rows = rows.filter(r => r.status === "pending_review");
      } else if (selectedCategory === "rule_violation") {
        rows = rows.filter(r => ["rule_violation", "invalid_format", "cross_field_mismatch"].includes(r.issue_type));
      } else {
        rows = rows.filter(r => r.issue_type === selectedCategory);
      }
    }

    // Issue type filter
    if (filterIssueTypes.length > 0) {
      rows = rows.filter((r) => filterIssueTypes.includes(r.issue_type));
    }

    // Column filter
    if (filterColumns.length > 0) {
      rows = rows.filter((r) => filterColumns.includes(r.column) || r.column === "ALL_COLUMNS");
    }

    // Confidence range
    rows = rows.filter((r) => {
      const pct = getConfidencePercent(r);
      return pct >= filterConfRange[0] && pct <= filterConfRange[1];
    });

    // Detection method
    if (filterMethods.length > 0) {
      rows = rows.filter((r) => {
        if (r._clean) return filterMethods.includes("—");
        return filterMethods.includes(getDetectionMethod(r));
      });
    }

    // Status
    if (filterStatus !== "all") {
      rows = rows.filter((r) => r.status === filterStatus);
    }

    // Sort
    rows.sort((a, b) => {
      let cmp = 0;
      if (sortBy === "confidence") cmp = (a.confidence || 0) - (b.confidence || 0);
      else if (sortBy === "row_index") cmp = a.row_index - b.row_index;
      else if (sortBy === "column") cmp = a.column.localeCompare(b.column);
      else if (sortBy === "issue_type") cmp = a.issue_type.localeCompare(b.issue_type);
      else if (sortBy === "status") cmp = (a.status || "").localeCompare(b.status || "");
      return sortOrder === "asc" ? cmp : -cmp;
    });

    return rows;
  }, [allRows, searchTerm, filterIssueTypes, filterColumns, filterConfRange, filterMethods, filterStatus, sortBy, sortOrder]);

  // ── Handlers ──
  const handleSort = (field) => {
    if (sortBy === field) setSortOrder(sortOrder === "asc" ? "desc" : "asc");
    else { setSortBy(field); setSortOrder("desc"); }
  };

  const clearFilters = () => {
    setFilterIssueTypes([]);
    setFilterColumns([]);
    setFilterConfRange([0, 100]);
    setFilterMethods([]);
    setFilterStatus("all");
    setSearchTerm("");
  };

  const hasActiveFilters =
    filterIssueTypes.length > 0 || filterColumns.length > 0 ||
    filterConfRange[0] !== 0 || filterConfRange[1] !== 100 ||
    filterMethods.length > 0 || filterStatus !== "all" || searchTerm;

  const [currentPage, setCurrentPage] = useState(1);
  const [rowsPerPage, setRowsPerPage] = useState(25);

  useEffect(() => {
    setCurrentPage(1);
  }, [filterIssueTypes, filterColumns, filterConfRange, filterMethods, filterStatus, searchTerm, selectedCategory, rowsPerPage]);

  const paginatedRows = useMemo(() => {
    return filteredRows.slice(
      (currentPage - 1) * rowsPerPage,
      currentPage * rowsPerPage
    );
  }, [filteredRows, currentPage, rowsPerPage]);

  const handleApprove = async (findingId, customValue = undefined, customAction = undefined) => {
    setActionLoading((p) => ({ ...p, [findingId]: true }));
    try {
      let payload = null;
      if (customAction) {
        payload = { action: customAction };
      } else if (customValue !== undefined) {
        payload = { action: "MANUAL_EDIT", value: customValue };
      }
      await approveFinding(analysisId, findingId, payload);
      triggerRefresh();
      if (drawerFinding?.id === findingId) setDrawerFinding(null);
    } catch (err) { alert(err.message || "Failed to approve"); }
    finally { setActionLoading((p) => ({ ...p, [findingId]: false })); }
  };

  const handleReject = async (findingId) => {
    setActionLoading((p) => ({ ...p, [findingId]: true }));
    try {
      await rejectFinding(analysisId, findingId);
      triggerRefresh();
      if (drawerFinding?.id === findingId) setDrawerFinding(null);
    } catch (err) { alert(err.message || "Failed to reject"); }
    finally { setActionLoading((p) => ({ ...p, [findingId]: false })); }
  };

  const handleRevert = async (findingId) => {
    setActionLoading((p) => ({ ...p, [findingId]: true }));
    try {
      await revertFinding(analysisId, findingId);
      triggerRefresh();
      if (drawerFinding?.id === findingId) setDrawerFinding(null);
    } catch (err) { alert(err.message || "Failed to revert"); }
    finally { setActionLoading((p) => ({ ...p, [findingId]: false })); }
  };

  // Close drawer on Escape
  useEffect(() => {
    const onKey = (e) => {
      if (e.target.tagName === "INPUT" || e.target.tagName === "TEXTAREA" || e.target.isContentEditable) {
        return;
      }
      if (e.key === "Escape") setDrawerFinding(null);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  // Fetch AI explanation dynamically when drawer opens without one
  useEffect(() => {
    if (drawerFinding && !drawerFinding.ai_explanation && !drawerFinding._clean) {
      const fetchExplanation = async () => {
        setExplainingId(drawerFinding.id);
        try {
          const res = await fetch(`${API_BASE_URL}/api/findings/${drawerFinding.id}/explain`, {
            method: "POST",
          });
          if (res.ok) {
            const data = await res.json();
            setDrawerFinding(prev => {
              if (prev && prev.id === drawerFinding.id) {
                return { 
                  ...prev, 
                  ai_explanation: data.ai_explanation,
                  ai_recommended_action: data.ai_recommended_action,
                  ai_resolution: data.ai_resolution
                };
              }
              return prev;
            });
            triggerRefresh();
          }
        } catch (err) {
          console.error("Failed to fetch explanation:", err);
        } finally {
          setExplainingId(null);
        }
      };
      fetchExplanation();
    }
  }, [drawerFinding]);

  // Toggle multiselect helpers
  const toggleFilter = (arr, setArr, val) => {
    setArr(arr.includes(val) ? arr.filter((v) => v !== val) : [...arr, val]);
  };

  // Sort indicator
  const SortIcon = ({ field }) => {
    if (sortBy !== field) return <ChevronsUpDown className="w-3 h-3 ml-1 opacity-30" />;
    return sortOrder === "asc"
      ? <ChevronUp className="w-3 h-3 ml-1 text-blue-600" />
      : <ChevronDown className="w-3 h-3 ml-1 text-blue-600" />;
  };

  // Confidence chip
  const ConfidenceChip = ({ value, isClean }) => {
    if (isClean) return <span className="dcr-chip dcr-chip-green">Clean</span>;
    const pct = Math.round(value * 100);
    let cls = "dcr-chip-green";
    if (pct >= 80) cls = "dcr-chip-red";
    else if (pct >= 50) cls = "dcr-chip-amber";
    return <span className={`dcr-chip ${cls}`}>{pct}%</span>;
  };

  // Issue type chip
  const IssueChip = ({ type }) => {
    const config = ISSUE_COLORS[type] || ISSUE_COLORS.clean;
    const Icon = config.icon;
    return (
      <span
        className="dcr-issue-chip"
        style={{ background: config.bg, color: config.text, borderColor: config.border }}
      >
        <Icon className="w-3 h-3" />
        {formatIssueType(type)}
      </span>
    );
  };

  // Status label
  const StatusLabel = ({ row }) => {
    if (row._clean || row.status === "clean") {
      return <span className="dcr-status dcr-status-green">Clean</span>;
    }
    const isManual = ["MANUAL_EDIT", "manual_override", "manual", "impute_mean", "impute_median", "impute_mode", "leave_blank"].includes(row.action_taken);
    if (isManual) {
      return <span className="dcr-status dcr-status-green">Manually edited</span>;
    }
    if (row.status === "auto_applied") {
      return <span className="dcr-status dcr-status-yellow">Auto-fixed</span>;
    }
    if (row.status === "pending_review") {
      return <span className="dcr-status dcr-status-red">Resolve Queue</span>;
    }
    if (row.status === "reviewed_no_action") {
      return <span className="dcr-status dcr-status-gray">Ignored</span>;
    }
    return <span className="dcr-status dcr-status-gray">{row.status}</span>;
  };

  // ── Render ──
  return (
    <div className="dcr-root">
      {/* ═══ TOP BAR ═══ */}
      <div className="dcr-topbar">
        <div className="dcr-topbar-left">
          <div className="dcr-topbar-icon">
            <Database className="w-5 h-5" />
          </div>
          <div>
            <h2 className="dcr-topbar-title">{dataset?.filename || "Dataset"}</h2>
            <p className="dcr-topbar-subtitle">
              {dataset?.row_count?.toLocaleString() || 0} rows · {dataset?.column_count || 0} columns
            </p>
          </div>
        </div>

        <div className="dcr-topbar-badges">
          {/* Total issues badge */}
          <div className="dcr-badge dcr-badge-issues">
            <Activity className="w-3.5 h-3.5" />
            <span className="dcr-badge-count">{findings.length}</span>
            <span>issues found</span>
          </div>

          {/* Issue type badges */}
          {Object.entries(issueTypeCounts).map(([type, count]) => {
            const config = ISSUE_COLORS[type] || ISSUE_COLORS.clean;
            return (
              <div
                key={type}
                className="dcr-badge"
                style={{ background: config.bg, color: config.text, borderColor: config.border }}
              >
                <span className="dcr-badge-label">{formatIssueType(type)}:</span>
                <span className="dcr-badge-count">{count}</span>
              </div>
            );
          })}
        </div>


      </div>

      {/* Quality progress bar */}
      <div className="dcr-progress-bar">
        <div
          className="dcr-progress-fill"
          style={{
            width: `${dataset?.row_count ? ((dataset.row_count - findings.length) / dataset.row_count * 100) : 100}%`,
          }}
        />
        <div
          className="dcr-progress-issue"
          style={{
            width: `${dataset?.row_count ? (findings.length / dataset.row_count * 100) : 0}%`,
          }}
        />
      </div>

      {/* ═══ MAIN LAYOUT ═══ */}
      <div className="dcr-layout">
        {/* ── Left Sidebar ── */}
        <aside className={`dcr-sidebar ${sidebarCollapsed ? "dcr-sidebar-collapsed" : ""}`}>
          <div className="dcr-sidebar-header">
            <div className="dcr-sidebar-title-row">
              <SlidersHorizontal className="w-4 h-4" />
              {!sidebarCollapsed && <span>Filters</span>}
            </div>
            <button
              className="dcr-sidebar-toggle"
              onClick={() => setSidebarCollapsed(!sidebarCollapsed)}
              title={sidebarCollapsed ? "Expand filters" : "Collapse filters"}
            >
              <ChevronRight className={`w-4 h-4 transition-transform ${sidebarCollapsed ? "" : "rotate-180"}`} />
            </button>
          </div>

          {!sidebarCollapsed && (
            <div className="dcr-sidebar-body">
              {/* Clear filters */}
              {hasActiveFilters && (
                <button className="dcr-clear-btn" onClick={clearFilters}>
                  <RotateCcw className="w-3 h-3" />
                  Clear All Filters
                </button>
              )}

              {/* Issue Type filter */}
              <div className="dcr-filter-section">
                <h4 className="dcr-filter-label">Issue Type</h4>
                <div className="dcr-filter-options">
                  {allIssueTypes.map((type) => (
                    <label key={type} className="dcr-checkbox-label">
                      <input
                        type="checkbox"
                        checked={filterIssueTypes.includes(type)}
                        onChange={() => toggleFilter(filterIssueTypes, setFilterIssueTypes, type)}
                        className="dcr-checkbox"
                      />
                      <span className="dcr-checkbox-text">
                        {formatIssueType(type)}
                        <span className="dcr-filter-count">({issueTypeCounts[type] || 0})</span>
                      </span>
                    </label>
                  ))}
                  {showCleanRows && (
                    <label className="dcr-checkbox-label">
                      <input
                        type="checkbox"
                        checked={filterIssueTypes.includes("clean")}
                        onChange={() => toggleFilter(filterIssueTypes, setFilterIssueTypes, "clean")}
                        className="dcr-checkbox"
                      />
                      <span className="dcr-checkbox-text">Clean ✓</span>
                    </label>
                  )}
                </div>
              </div>

              {/* Column filter */}
              <div className="dcr-filter-section">
                <h4 className="dcr-filter-label">Column</h4>
                <div className="dcr-filter-options dcr-filter-scroll">
                  {uniqueColumns.map((col) => (
                    <label key={col} className="dcr-checkbox-label">
                      <input
                        type="checkbox"
                        checked={filterColumns.includes(col)}
                        onChange={() => toggleFilter(filterColumns, setFilterColumns, col)}
                        className="dcr-checkbox"
                      />
                      <span className="dcr-checkbox-text">{col}</span>
                    </label>
                  ))}
                </div>
              </div>

              {/* Confidence Range */}
              <div className="dcr-filter-section">
                <h4 className="dcr-filter-label">
                  Confidence Range
                  <span className="dcr-filter-range-label">{filterConfRange[0]}–{filterConfRange[1]}</span>
                </h4>
                <div className="dcr-range-inputs">
                  <input
                    type="range"
                    min="0"
                    max="100"
                    value={filterConfRange[0]}
                    onChange={(e) => setFilterConfRange([Math.min(+e.target.value, filterConfRange[1]), filterConfRange[1]])}
                    className="dcr-range"
                  />
                  <input
                    type="range"
                    min="0"
                    max="100"
                    value={filterConfRange[1]}
                    onChange={(e) => setFilterConfRange([filterConfRange[0], Math.max(+e.target.value, filterConfRange[0])])}
                    className="dcr-range"
                  />
                </div>
              </div>

              {/* Detection Method */}
              <div className="dcr-filter-section">
                <h4 className="dcr-filter-label">Detection Method</h4>
                <div className="dcr-filter-options">
                  {DETECTION_METHODS.map((method) => (
                    <label key={method} className="dcr-checkbox-label">
                      <input
                        type="checkbox"
                        checked={filterMethods.includes(method)}
                        onChange={() => toggleFilter(filterMethods, setFilterMethods, method)}
                        className="dcr-checkbox"
                      />
                      <span className="dcr-checkbox-text">{method}</span>
                    </label>
                  ))}
                </div>
              </div>

              {/* Status filter */}
              <div className="dcr-filter-section">
                <h4 className="dcr-filter-label">Status</h4>
                <div className="dcr-filter-options">
                  {[
                    { value: "all", label: "All" },
                    { value: "pending_review", label: "Pending Review" },
                    { value: "auto_applied", label: "Auto-Fixed" },
                    { value: "reviewed_no_action", label: "Ignored" },
                  ].map((opt) => (
                    <label key={opt.value} className="dcr-radio-label">
                      <input
                        type="radio"
                        name="status-filter"
                        checked={filterStatus === opt.value}
                        onChange={() => setFilterStatus(opt.value)}
                        className="dcr-radio"
                      />
                      <span className="dcr-checkbox-text">{opt.label}</span>
                    </label>
                  ))}
                </div>
              </div>

              {/* Show clean rows toggle */}
              <div className="dcr-filter-section">
                <label className="dcr-toggle-label">
                  <div className={`dcr-toggle ${showCleanRows ? "dcr-toggle-on" : ""}`}
                    onClick={() => setShowCleanRows(!showCleanRows)}
                  >
                    <div className="dcr-toggle-knob" />
                  </div>
                  <span>Show clean rows</span>
                </label>
              </div>
            </div>
          )}
        </aside>

        {/* ── Main Table Area ── */}
        <div className="dcr-main">
          {/* Sub-tabs / Filter Chips */}
          <div className="flex gap-2 pb-3 mb-4 text-xs font-mono border-b border-slate-800">
            {[
              { id: "all", label: "All Issues", count: findings.length },
              { id: "resolve_queue", label: "Resolve Queue", count: findings.filter(f => f.status === "pending_review").length },
              { id: "missing_value", label: "Missing Values", count: findings.filter(f => f.issue_type === "missing_value").length },
              { id: "duplicate", label: "Duplicate Rows", count: findings.filter(f => f.issue_type === "duplicate").length },
              { id: "rule_violation", label: "Rule Violations", count: findings.filter(f => ["rule_violation", "invalid_format", "cross_field_mismatch"].includes(f.issue_type)).length },
              { id: "outlier", label: "Outliers", count: findings.filter(f => f.issue_type === "outlier").length }
            ].map(tab => (
              <button
                key={tab.id}
                onClick={() => setSelectedCategory(tab.id)}
                className={`px-3 py-1.5 rounded-lg font-bold border transition-all cursor-pointer flex items-center gap-2 ${
                  selectedCategory === tab.id
                    ? "bg-blue-500/10 border-blue-500/30 text-blue-400"
                    : "bg-slate-900/40 border-slate-850 text-slate-400 hover:text-slate-200 hover:border-slate-700"
                }`}
              >
                <span>{tab.label}</span>
                <span className={`px-1.5 py-0.5 rounded text-[10px] ${
                  selectedCategory === tab.id ? "bg-blue-500/20 text-blue-405" : "bg-slate-850 text-slate-500"
                }`}>{tab.count}</span>
              </button>
            ))}
          </div>

          {/* Search bar */}
          <div className="dcr-search-bar">
            <div className="dcr-search-input-wrapper">
              <Search className="w-4 h-4 dcr-search-icon" />
              <input
                type="text"
                placeholder="Search by row ID, column, or issue type..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="dcr-search-input"
              />
              {searchTerm && (
                <button onClick={() => setSearchTerm("")} className="dcr-search-clear">
                  <X className="w-3.5 h-3.5" />
                </button>
              )}
            </div>
            <div className="dcr-search-meta">
              <span>{filteredRows.length} of {allRows.length} rows</span>
              {hasActiveFilters && (
                <button className="dcr-search-clear-filters" onClick={clearFilters}>
                  <Filter className="w-3 h-3" />
                  Clear filters
                </button>
              )}
            </div>
          </div>

          {/* Data Table */}
          <div className="dcr-table-wrapper">
            {filteredRows.length === 0 ? (
              <div className="dcr-empty">
                <ShieldAlert className="w-12 h-12 dcr-empty-icon" />
                <h3>No rows match the current filters</h3>
                <p>Try adjusting your filter criteria or clearing all filters.</p>
                <button className="dcr-empty-btn" onClick={clearFilters}>Clear All Filters</button>
              </div>
            ) : (
              <table className="dcr-table">
                <thead>
                  <tr>
                    <th onClick={() => handleSort("row_index")} className="dcr-th dcr-th-sortable">
                      <span>Row ID</span><SortIcon field="row_index" />
                    </th>
                    <th onClick={() => handleSort("column")} className="dcr-th dcr-th-sortable">
                      <span>Column Name</span><SortIcon field="column" />
                    </th>
                    <th className="dcr-th">Current Value</th>
                    <th onClick={() => handleSort("issue_type")} className="dcr-th dcr-th-sortable">
                      <span>Issue Type</span><SortIcon field="issue_type" />
                    </th>
                    <th onClick={() => handleSort("confidence")} className="dcr-th dcr-th-sortable">
                      <span>Confidence</span><SortIcon field="confidence" />
                    </th>
                    <th className="dcr-th">Detection Method</th>
                    <th onClick={() => handleSort("status")} className="dcr-th dcr-th-sortable">
                      <span>Status</span><SortIcon field="status" />
                    </th>
                    <th className="dcr-th dcr-th-actions">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {paginatedRows.map((row) => {
                    const isSelected = drawerFinding?.id === row.id;
                    return (
                      <tr
                        key={row.id}
                        className={`dcr-tr ${isSelected ? "dcr-tr-selected" : ""} ${row._clean ? "dcr-tr-clean" : ""}`}
                        onClick={() => !row._clean && setDrawerFinding(row)}
                      >
                        <td className="dcr-td dcr-td-mono">{row.row_index}</td>
                        <td className="dcr-td dcr-td-col">
                          {row.column === "ALL_COLUMNS" ? "Full Row" : row.column}
                        </td>
                        <td className="dcr-td dcr-td-mono max-w-[120px] truncate" title={row.status === "auto_applied" ? row.after_value : row.before_value}>
                          {((row.status === "auto_applied" ? row.after_value : row.before_value) === "" || (row.status === "auto_applied" ? row.after_value : row.before_value) === null) ? <em className="text-slate-650">empty</em> : String(row.status === "auto_applied" ? row.after_value : row.before_value)}
                        </td>
                        <td className="dcr-td">
                          <IssueChip type={row.issue_type} />
                        </td>
                        <td className="dcr-td">
                          <ConfidenceChip value={row.confidence} isClean={row._clean} />
                        </td>
                        <td className="dcr-td dcr-td-method">{getDetectionMethod(row)}</td>
                        <td className="dcr-td">
                          <StatusLabel row={row} />
                        </td>
                        <td className="dcr-td dcr-td-actions" onClick={(e) => e.stopPropagation()}>
                          {!row._clean && row.status === "pending_review" ? (
                            <div className="dcr-action-btns">
                              <button
                                className="dcr-btn-approve"
                                onClick={() => handleApprove(row.id)}
                                disabled={actionLoading[row.id]}
                                title="Approve fix"
                              >
                                <Check className="w-3.5 h-3.5" />
                              </button>
                              <button
                                className="dcr-btn-reject"
                                onClick={() => handleReject(row.id)}
                                disabled={actionLoading[row.id]}
                                title="Reject / Ignore"
                              >
                                <X className="w-3.5 h-3.5" />
                              </button>
                            </div>
                          ) : !row._clean ? (
                            <button
                              className="dcr-btn-view"
                              onClick={() => setDrawerFinding(row)}
                              title="View details"
                            >
                              <Eye className="w-3.5 h-3.5" />
                            </button>
                          ) : (
                            <span className="dcr-clean-label">
                              <CheckCircle2 className="w-3.5 h-3.5" />
                            </span>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            )}
            <div className="dcr-pagination flex flex-col sm:flex-row items-center justify-between border-t border-slate-850 pt-4 mt-4 text-xs font-mono text-slate-400 px-2 gap-3 select-none">
              <div className="flex items-center gap-2">
                <span>Show</span>
                <select 
                  value={rowsPerPage} 
                  onChange={(e) => {
                    setRowsPerPage(Number(e.target.value));
                    setCurrentPage(1);
                  }}
                  className="bg-slate-900 border border-slate-800 rounded px-2 py-1 text-slate-200 outline-none focus:border-blue-500 cursor-pointer"
                >
                  {[10, 25, 50, 100].map(sz => (
                    <option key={sz} value={sz}>{sz}</option>
                  ))}
                </select>
                <span>issues per page</span>
              </div>
              
              <span>
                Showing {filteredRows.length === 0 ? 0 : (currentPage - 1) * rowsPerPage + 1}–{Math.min(filteredRows.length, currentPage * rowsPerPage)} of {filteredRows.length} issues
              </span>
              
              <div className="flex items-center gap-3">
                <span className="text-[10px] text-slate-500">Page {currentPage} of {Math.max(1, Math.ceil(filteredRows.length / rowsPerPage))}</span>
                <div className="flex gap-2">
                  <button
                    disabled={currentPage === 1}
                    onClick={() => setCurrentPage(prev => Math.max(prev - 1, 1))}
                    className="px-3 py-1.5 bg-slate-900 border border-slate-800 rounded disabled:opacity-40 cursor-pointer text-slate-350 hover:text-slate-100 disabled:cursor-not-allowed"
                  >
                    Previous
                  </button>
                  <button
                    disabled={currentPage * rowsPerPage >= filteredRows.length}
                    onClick={() => setCurrentPage(prev => prev + 1)}
                    className="px-3 py-1.5 bg-slate-900 border border-slate-800 rounded disabled:opacity-40 cursor-pointer text-slate-350 hover:text-slate-100 disabled:cursor-not-allowed"
                  >
                    Next
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* ═══ DETAIL DRAWER ═══ */}
      {drawerFinding && !drawerFinding._clean && (() => {
        const confPct = getConfidencePercent(drawerFinding);
        const confColor = confPct >= 80 ? "#DC2626" : confPct >= 50 ? "#D97706" : "#16A34A";
        const confBg = confPct >= 80 ? "#FEF2F2" : confPct >= 50 ? "#FFFBEB" : "#F0FDF4";
        const confLabel = confPct >= 80 ? "High Confidence" : confPct >= 50 ? "Medium Confidence" : "Low Confidence";
        const issueConfig = ISSUE_COLORS[drawerFinding.issue_type] || ISSUE_COLORS.clean;
        const IssueIcon = issueConfig.icon;
        const activeMethods = getActiveDetectionMethods(drawerFinding);
        const suggestedFix = getSuggestedFix(drawerFinding);
        const hasDeterministicFix = suggestedFix && suggestedFix.action !== "Flag for manual review";
        const colName = drawerFinding.column === "ALL_COLUMNS" ? "Full Row" : drawerFinding.column;

        return (
          <>
            <div className="dcr-drawer-overlay" onClick={() => { setDrawerFinding(null); setEditMode(false); }} />
            <div className="dcr-drawer" ref={drawerRef}>

              {/* ── Drawer Header ── */}
              <div className="dd-header">
                <div className="dd-header-top">
                  <div
                    className="dd-severity-badge"
                    style={{ background: issueConfig.bg, color: issueConfig.text, borderColor: issueConfig.border }}
                  >
                    <IssueIcon className="w-3.5 h-3.5" />
                    {formatIssueType(drawerFinding.issue_type)}
                  </div>
                  <button className="dd-close" onClick={() => { setDrawerFinding(null); setEditMode(false); }}>
                    <X className="w-4.5 h-4.5" />
                  </button>
                </div>
                <div className="dd-header-info">
                  <h3 className="dd-col-name">{colName}</h3>
                  <span className="dd-row-id">Row #{drawerFinding.row_index}</span>
                </div>
                {/* Original → Repaired values inline */}
                <div className="dd-header-values">
                  <div 
                    className="dd-val-pill dd-val-original cursor-pointer hover:bg-slate-800"
                    onClick={() => {
                      setEditMode(true);
                      setEditInput("");
                      setShowChoicesForMissing(false);
                    }}
                  >
                    <span className="dd-val-label">Current</span>
                    <code>{drawerFinding.before_value === "" || drawerFinding.before_value === null ? "[Empty]" : drawerFinding.before_value}</code>
                  </div>
                  {drawerFinding.status === "auto_applied" && drawerFinding.after_value && (
                    <>
                      <ArrowRight className="w-4 h-4 dd-val-arrow" />
                      <div className="dd-val-pill dd-val-repaired">
                        <span className="dd-val-label">Fixed</span>
                        <code>{drawerFinding.after_value === "None" ? "[Dropped]" : drawerFinding.after_value}</code>
                      </div>
                    </>
                  )}
                </div>
              </div>

              {/* ── Drawer Body ── */}
              <div className="dd-body">

                {/* ━━ Confidence Score ━━ */}
                <div className="dd-confidence-card">
                  <div className="dd-conf-row">
                    <div className="dd-conf-number" style={{ color: confColor }}>
                      {confPct}
                    </div>
                    <div className="dd-conf-meta">
                      <span className="dd-conf-label" style={{ color: confColor }}>{confLabel}</span>
                      <span className="dd-conf-sublabel">out of 100</span>
                    </div>
                  </div>
                  <div className="dd-conf-bar-track">
                    <div
                      className="dd-conf-bar-fill"
                      style={{ width: `${confPct}%`, background: confColor }}
                    />
                  </div>
                </div>

                {/* ━━ Detected By — deterministic evidence tags ━━ */}
                <div className="dd-section dd-detected-by">
                  <div className="dd-section-label">
                    <Zap className="w-3.5 h-3.5" />
                    <span>Detected By</span>
                    <span className="dd-section-sublabel">Deterministic Pipeline</span>
                  </div>
                  <div className="dd-method-tags">
                    {activeMethods.map((m) => (
                      <div key={m.name} className="dd-method-tag" style={{ borderColor: m.color + '40', background: m.color + '08' }}>
                        <m.icon className="w-3.5 h-3.5" style={{ color: m.color }} />
                        <span className="dd-method-name">{m.name}</span>
                        <span className="dd-method-score" style={{ color: m.color }}>{m.score.toFixed(3)}</span>
                      </div>
                    ))}
                    {drawerFinding.rule_violation && (
                      <div className="dd-method-tag dd-method-violation">
                        <ShieldAlert className="w-3.5 h-3.5" />
                        <span className="dd-method-name">Hard Rule Violation</span>
                      </div>
                    )}
                  </div>
                  {/* Score breakdown bars */}
                  <div className="dd-score-bars">
                    <div className="dd-sbar-row">
                      <span className="dd-sbar-label">Statistical</span>
                      <div className="dd-sbar-track">
                        <div className="dd-sbar-fill" style={{ width: `${Math.min(drawerFinding.stat_score * 100, 100)}%`, background: '#3B82F6' }} />
                      </div>
                      <span className="dd-sbar-val">{drawerFinding.stat_score.toFixed(3)}</span>
                    </div>
                    <div className="dd-sbar-row">
                      <span className="dd-sbar-label">ML Model</span>
                      <div className="dd-sbar-track">
                        <div className="dd-sbar-fill" style={{ width: `${Math.min(drawerFinding.ml_score * 100, 100)}%`, background: '#8B5CF6' }} />
                      </div>
                      <span className="dd-sbar-val">{drawerFinding.ml_score.toFixed(3)}</span>
                    </div>
                    <div className="dd-sbar-row">
                      <span className="dd-sbar-label">Rule Engine</span>
                      <div className="dd-sbar-track">
                        <div className="dd-sbar-fill" style={{ width: `${Math.min(drawerFinding.rule_score * 100, 100)}%`, background: '#F59E0B' }} />
                      </div>
                      <span className="dd-sbar-val">{drawerFinding.rule_score.toFixed(3)}</span>
                    </div>
                  </div>
                </div>

                {/* ━━ AI Explanation — visually distinct from deterministic ━━ */}
                <div className="dd-section dd-ai-section">
                  <div className="dd-ai-label">
                    <div className="dd-ai-icon-wrap">
                      <Sparkles className="w-4 h-4" />
                    </div>
                    <div>
                      <span className="dd-ai-title">AI Explanation</span>
                      <span className="dd-ai-source">Generated by AI LLM</span>
                    </div>
                  </div>
                  {explainingId === drawerFinding.id ? (
                    <div className="dd-ai-loading">
                      <div className="dd-ai-loading-spinner" />
                      <span>Consulting AI to interpret this record...</span>
                    </div>
                  ) : (
                    <div className="dd-ai-body">
                      <p className="dd-ai-text">
                        {drawerFinding.ai_explanation || "No AI interpretation available. This finding was detected through deterministic statistical and rule-based methods. Review the detection scores above for context."}
                      </p>
                    </div>
                  )}
                  <div className="dd-ai-notice">
                    <MessageSquare className="w-3 h-3" />
                    <span>This explanation is AI-generated and may not be fully accurate. Verify with the deterministic evidence above.</span>
                  </div>
                </div>

                {/* ━━ Before vs After Comparison Card ━━ */}
                <div className="dd-section dd-comparison-section">
                  <div className="dd-section-label">
                    <SlidersHorizontal className="w-3.5 h-3.5 text-blue-500" />
                    <span>Value Comparison</span>
                  </div>
                  {!hasDeterministicFix && drawerFinding.status !== "auto_applied" ? (
                    <div className="bg-slate-950/40 border border-slate-800 rounded-xl p-4 text-center font-mono text-[11px] text-slate-450 leading-relaxed">
                      <p className="font-semibold text-slate-350">No automatic fix available — manual input required</p>
                      {drawerFinding.ai_resolution && (
                        <p className="text-[10.5px] text-slate-400 mt-1.5 font-sans italic">
                          "{drawerFinding.ai_resolution}"
                        </p>
                      )}
                    </div>
                  ) : (
                    <div className="dd-comparison-card">
                      <div 
                        className="dd-comp-col cursor-pointer hover:bg-slate-850"
                        onClick={() => {
                          setEditMode(true);
                          setEditInput("");
                          setShowChoicesForMissing(false);
                        }}
                      >
                        <span className="dd-comp-label">Before Preprocessing</span>
                        <div className="dd-comp-val dd-comp-val-before">
                          {drawerFinding.before_value === "" || drawerFinding.before_value === null ? (
                            <span className="dd-val-empty">[Empty]</span>
                          ) : (
                            drawerFinding.before_value
                          )}
                        </div>
                      </div>
                      <div className="dd-comp-arrow-wrap">
                        <ArrowRight className="w-5 h-5 text-slate-400" />
                      </div>
                      <div className="dd-comp-col">
                        <span className="dd-comp-label">After Preprocessing (Proposed)</span>
                        <div className={`dd-comp-val dd-comp-val-after ${drawerFinding.status === "auto_applied" ? "dd-comp-val-applied" : ""}`}>
                          {editMode && drawerFinding.issue_type === "missing_value" ? (
                            editInput || <span className="dd-val-empty">[Empty]</span>
                          ) : (
                            drawerFinding.after_value === "None" || drawerFinding.after_value === null || drawerFinding.after_value === "" ? (
                              drawerFinding.ai_recommended_action === "drop" || getSuggestedFix(drawerFinding).action === "Remove row" ? (
                                <span className="dd-val-dropped">[Row Dropped]</span>
                              ) : (
                                <span className="dd-val-empty">[Empty]</span>
                              )
                            ) : (
                              drawerFinding.after_value
                            )
                          )}
                        </div>
                      </div>
                    </div>
                  )}
                </div>

                {/* ━━ Suggested Fix ━━ */}
                <div className="dd-section dd-fix-section">
                  <div className="dd-section-label">
                    <Wrench className="w-3.5 h-3.5" />
                    <span>Suggested Fix</span>
                    <span className="dd-section-sublabel">Not auto-applied</span>
                  </div>
                  <div className="dd-fix-card">
                    <div className="dd-fix-action">{suggestedFix.action}</div>
                    <p className="dd-fix-detail">
                      {drawerFinding.ai_resolution || suggestedFix.detail}
                    </p>
                  </div>
                </div>

                {/* Decision Block for Ambiguous Rule Violations */}
                {drawerFinding.issue_type === "rule_violation" && !hasDeterministicFix && drawerFinding.status === "pending_review" && (
                  <div className="dd-section bg-slate-950/45 border border-amber-500/20 rounded-xl p-4.5 space-y-3 mt-4 text-xs font-mono">
                    <div className="flex items-center gap-1.5 text-[11px] text-amber-450 font-bold uppercase tracking-wider select-none">
                      <AlertTriangle className="w-3.5 h-3.5" />
                      <span>Manual Resolution Options</span>
                    </div>
                    <p className="text-slate-400 font-sans leading-relaxed">
                      This rule violation has no deterministic correction. Choose how to resolve it:
                    </p>
                    <div className="flex flex-col sm:flex-row gap-2 pt-1.5">
                      <button
                        className="px-3 py-2 bg-slate-800 hover:bg-slate-700 text-slate-200 rounded-lg font-semibold cursor-pointer border border-slate-750 flex-1 text-center"
                        onClick={() => handleReject(drawerFinding.id)}
                      >
                        Keep As-Is
                      </button>
                      <button
                        className="px-3 py-2 bg-blue-600 hover:bg-blue-500 text-slate-100 rounded-lg font-semibold cursor-pointer flex-1 text-center"
                        onClick={() => {
                          setEditMode(true);
                          setEditInput(drawerFinding.before_value || "");
                        }}
                      >
                        Correct Value
                      </button>
                      <button
                        className="px-3 py-2 bg-rose-600 hover:bg-rose-500 text-slate-100 rounded-lg font-semibold cursor-pointer flex-1 text-center"
                        onClick={() => handleApprove(drawerFinding.id, undefined, "drop")}
                      >
                        Remove Row
                      </button>
                    </div>
                  </div>
                )}

                {/* ━━ Edit Value (conditional) ━━ */}
                {editMode && (
                  <div className="dd-section dd-edit-section">
                    <div className="dd-section-label">
                      <Pencil className="w-3.5 h-3.5" />
                      <span>Edit Value</span>
                    </div>
                    <div className="dd-edit-row">
                      <input
                        type="text"
                        className="dd-edit-input"
                        value={editInput}
                        onChange={(e) => setEditInput(e.target.value)}
                        placeholder={drawerFinding.issue_type === "missing_value" ? "Enter the correct value..." : "Enter corrected value..."}
                        autoFocus
                      />
                      <button
                        className="dd-edit-apply"
                        onClick={() => {
                          if (drawerFinding.issue_type === "missing_value") {
                            handleApprove(drawerFinding.id, editInput, "MANUAL_EDIT");
                          } else {
                            handleApprove(drawerFinding.id, editInput);
                          }
                          setEditMode(false);
                        }}
                        disabled={actionLoading[drawerFinding.id]}
                      >
                        Apply
                      </button>
                      <button className="dd-edit-cancel" onClick={() => setEditMode(false)}>Cancel</button>
                    </div>
                    {/* Email validation warning */}
                    {isEmailColumn(drawerFinding.column) && editInput && !validateEmail(editInput) && (
                      <p className="text-amber-500 text-[10.5px] mt-1.5 flex items-center gap-1 font-sans">
                        <AlertTriangle className="w-3.5 h-3.5 shrink-0" />
                        <span>Value does not look like a valid email address.</span>
                      </p>
                    )}
                  </div>
                )}
              </div>

              {/* ── Drawer Footer — action buttons ── */}
              <div className="dd-footer">
                <button
                  className="dd-action-btn dd-btn-reject"
                  onClick={() => handleReject(drawerFinding.id)}
                  disabled={actionLoading[drawerFinding.id] || (drawerFinding.status !== "pending_review" && drawerFinding.status !== "auto_applied")}
                  title="Reject this issue — mark as not a problem"
                >
                  <X className="w-4 h-4" />
                  <span>Reject</span>
                </button>
                {drawerFinding.status === "pending_review" && (
                  <button
                    className="dd-action-btn dd-btn-drop"
                    onClick={() => handleApprove(drawerFinding.id, undefined, "drop")}
                    disabled={actionLoading[drawerFinding.id]}
                    title="Drop this entire row from the dataset"
                  >
                    <Trash2 className="w-4 h-4" />
                    <span>Drop Row</span>
                  </button>
                )}
                <button
                  className="dd-action-btn dd-btn-edit"
                  onClick={() => {
                    setEditMode(!editMode);
                    setEditInput(drawerFinding.status === "auto_applied" ? (drawerFinding.after_value || "") : (drawerFinding.before_value || ""));
                  }}
                  disabled={actionLoading[drawerFinding.id]}
                  title="Manually edit the value"
                >
                  <Pencil className="w-4 h-4" />
                  <span>Edit Value</span>
                </button>
                {hasDeterministicFix && (
                  <button
                    className="dd-action-btn dd-btn-accept"
                    onClick={() => {
                      if (editMode && editInput) {
                        handleApprove(drawerFinding.id, editInput, "MANUAL_EDIT");
                      } else {
                        handleApprove(drawerFinding.id);
                      }
                    }}
                    disabled={actionLoading[drawerFinding.id] || drawerFinding.status !== "pending_review"}
                    title="Accept the suggested fix"
                  >
                    <Check className="w-4 h-4" />
                    <span>Accept Fix</span>
                  </button>
                )}
                {(drawerFinding.status === "auto_applied" || drawerFinding.status === "reviewed_no_action") && (
                  <button
                    className="dd-action-btn dd-btn-revert"
                    onClick={() => handleRevert(drawerFinding.id)}
                    disabled={actionLoading[drawerFinding.id]}
                    title="Revert to original pre-preprocessing value"
                  >
                    <RotateCcw className="w-4 h-4" />
                    <span>Revert</span>
                  </button>
                )}
              </div>
            </div>
          </>
        );
      })()}

      {/* Final Cleaned Dataset Preview */}
      <div className="mt-8 px-6 pb-6 select-none">
        <AuditPreviewTable 
          analysisId={analysisId} 
          refreshTrigger={refreshTrigger} 
        />
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

      {/* Scoped Styles */}
      <style>{`
        /* ─── ROOT & RESET ─── */
        .dcr-root {
          background: #F8FAFC;
          border-radius: 16px;
          overflow: hidden;
          font-family: 'Inter', -apple-system, BlinkMacSystemFont, sans-serif;
          color: #1E293B;
          min-height: 600px;
          border: 1px solid #E2E8F0;
        }

        /* ─── TOP BAR ─── */
        .dcr-topbar {
          background: #FFFFFF;
          border-bottom: 1px solid #E2E8F0;
          padding: 16px 24px;
          display: flex;
          align-items: center;
          justify-content: space-between;
          flex-wrap: wrap;
          gap: 16px;
        }
        .dcr-topbar-right {
          display: flex;
          align-items: center;
          gap: 12px;
        }
        .dcr-export-group {
          display: flex;
          align-items: center;
          gap: 6px;
          background: #F1F5F9;
          padding: 3px;
          border-radius: 8px;
          border: 1px solid #E2E8F0;
        }
        .dcr-export-label {
          font-size: 10px;
          font-weight: 700;
          color: #64748B;
          text-transform: uppercase;
          font-family: 'JetBrains Mono', monospace;
          margin-left: 6px;
          margin-right: 4px;
        }
        .dcr-export-btn {
          display: inline-flex;
          align-items: center;
          gap: 5px;
          font-size: 11px;
          font-weight: 600;
          padding: 6px 12px;
          border-radius: 6px;
          color: #475569;
          background: white;
          border: 1px solid #E2E8F0;
          text-decoration: none;
          cursor: pointer;
          transition: all 0.15s;
        }
        .dcr-export-btn:hover {
          color: #1E293B;
          background: #F8FAFC;
          border-color: #CBD5E1;
        }
        .dcr-export-excel:hover {
          color: #15803D;
          border-color: #86EFAC;
          background: #F0FDF4;
        }
        .dcr-export-json:hover {
          color: #7E22CE;
          border-color: #D8B4FE;
          background: #FDF4FF;
        }
        .dcr-export-pdf:hover {
          color: #B91C1C;
          border-color: #FCA5A5;
          background: #FEF2F2;
        }
        .dcr-topbar-left {
          display: flex;
          align-items: center;
          gap: 12px;
        }
        .dcr-topbar-icon {
          width: 40px;
          height: 40px;
          background: linear-gradient(135deg, #3B82F6, #6366F1);
          color: white;
          border-radius: 10px;
          display: flex;
          align-items: center;
          justify-content: center;
          flex-shrink: 0;
        }
        .dcr-topbar-title {
          font-size: 16px;
          font-weight: 700;
          color: #0F172A;
          margin: 0;
          line-height: 1.3;
        }
        .dcr-topbar-subtitle {
          font-size: 12px;
          color: #64748B;
          margin: 0;
          font-weight: 500;
        }
        .dcr-topbar-badges {
          display: flex;
          align-items: center;
          gap: 8px;
          flex-wrap: wrap;
        }
        .dcr-badge {
          display: inline-flex;
          align-items: center;
          gap: 5px;
          font-size: 11px;
          font-weight: 600;
          padding: 4px 10px;
          border-radius: 8px;
          border: 1px solid;
          white-space: nowrap;
        }
        .dcr-badge-issues {
          background: #EFF6FF;
          color: #1D4ED8;
          border-color: #93C5FD;
        }
        .dcr-badge-label { font-weight: 500; }
        .dcr-badge-count { font-weight: 800; font-variant-numeric: tabular-nums; }

        /* ─── PROGRESS BAR ─── */
        .dcr-progress-bar {
          display: flex;
          height: 4px;
          background: #F1F5F9;
        }
        .dcr-progress-fill {
          background: linear-gradient(90deg, #22C55E, #4ADE80);
          transition: width 0.6s ease;
        }
        .dcr-progress-issue {
          background: linear-gradient(90deg, #F59E0B, #EF4444);
          transition: width 0.6s ease;
        }

        /* ─── LAYOUT ─── */
        .dcr-layout {
          display: flex;
          min-height: 540px;
        }

        /* ─── SIDEBAR ─── */
        .dcr-sidebar {
          width: 260px;
          min-width: 260px;
          background: #FFFFFF;
          border-right: 1px solid #E2E8F0;
          display: flex;
          flex-direction: column;
          transition: all 0.25s ease;
          overflow: hidden;
        }
        .dcr-sidebar-collapsed {
          width: 48px;
          min-width: 48px;
        }
        .dcr-sidebar-header {
          display: flex;
          align-items: center;
          justify-content: space-between;
          padding: 14px 16px;
          border-bottom: 1px solid #F1F5F9;
          gap: 8px;
        }
        .dcr-sidebar-title-row {
          display: flex;
          align-items: center;
          gap: 8px;
          font-size: 13px;
          font-weight: 700;
          color: #334155;
          text-transform: uppercase;
          letter-spacing: 0.05em;
          white-space: nowrap;
        }
        .dcr-sidebar-toggle {
          background: none;
          border: 1px solid #E2E8F0;
          border-radius: 6px;
          padding: 4px;
          cursor: pointer;
          color: #94A3B8;
          display: flex;
          align-items: center;
          justify-content: center;
          transition: all 0.15s;
          flex-shrink: 0;
        }
        .dcr-sidebar-toggle:hover {
          background: #F1F5F9;
          color: #475569;
        }
        .dcr-sidebar-body {
          padding: 12px 16px;
          overflow-y: auto;
          flex: 1;
          display: flex;
          flex-direction: column;
          gap: 18px;
        }

        /* ─── FILTERS ─── */
        .dcr-clear-btn {
          display: flex;
          align-items: center;
          gap: 6px;
          font-size: 11px;
          font-weight: 600;
          color: #3B82F6;
          background: #EFF6FF;
          border: 1px solid #BFDBFE;
          border-radius: 6px;
          padding: 6px 10px;
          cursor: pointer;
          transition: all 0.15s;
          width: 100%;
          justify-content: center;
        }
        .dcr-clear-btn:hover { background: #DBEAFE; }
        .dcr-filter-section { display: flex; flex-direction: column; gap: 8px; }
        .dcr-filter-label {
          font-size: 10px;
          font-weight: 700;
          color: #64748B;
          text-transform: uppercase;
          letter-spacing: 0.08em;
          display: flex;
          align-items: center;
          justify-content: space-between;
        }
        .dcr-filter-range-label {
          font-size: 11px;
          font-weight: 600;
          color: #3B82F6;
          letter-spacing: normal;
          text-transform: none;
        }
        .dcr-filter-options {
          display: flex;
          flex-direction: column;
          gap: 4px;
        }
        .dcr-filter-scroll { max-height: 120px; overflow-y: auto; }
        .dcr-checkbox-label {
          display: flex;
          align-items: center;
          gap: 8px;
          padding: 4px 6px;
          border-radius: 6px;
          cursor: pointer;
          transition: background 0.1s;
          font-size: 12px;
        }
        .dcr-checkbox-label:hover { background: #F8FAFC; }
        .dcr-radio-label {
          display: flex;
          align-items: center;
          gap: 8px;
          padding: 4px 6px;
          border-radius: 6px;
          cursor: pointer;
          transition: background 0.1s;
          font-size: 12px;
        }
        .dcr-radio-label:hover { background: #F8FAFC; }
        .dcr-checkbox {
          width: 14px;
          height: 14px;
          accent-color: #3B82F6;
          cursor: pointer;
          flex-shrink: 0;
        }
        .dcr-radio {
          width: 14px;
          height: 14px;
          accent-color: #3B82F6;
          cursor: pointer;
          flex-shrink: 0;
        }
        .dcr-checkbox-text {
          color: #475569;
          font-weight: 500;
          display: flex;
          align-items: center;
          gap: 4px;
        }
        .dcr-filter-count {
          color: #94A3B8;
          font-size: 10px;
          font-weight: 600;
        }
        .dcr-range-inputs {
          display: flex;
          flex-direction: column;
          gap: 4px;
        }
        .dcr-range {
          width: 100%;
          accent-color: #3B82F6;
          height: 4px;
          cursor: pointer;
        }

        /* Toggle switch */
        .dcr-toggle-label {
          display: flex;
          align-items: center;
          gap: 10px;
          font-size: 12px;
          font-weight: 500;
          color: #475569;
          cursor: pointer;
        }
        .dcr-toggle {
          width: 36px;
          height: 20px;
          background: #CBD5E1;
          border-radius: 10px;
          position: relative;
          transition: background 0.2s;
          cursor: pointer;
          flex-shrink: 0;
        }
        .dcr-toggle-on { background: #3B82F6; }
        .dcr-toggle-knob {
          width: 16px;
          height: 16px;
          background: white;
          border-radius: 50%;
          position: absolute;
          top: 2px;
          left: 2px;
          transition: transform 0.2s;
          box-shadow: 0 1px 3px rgba(0,0,0,0.15);
        }
        .dcr-toggle-on .dcr-toggle-knob { transform: translateX(16px); }

        /* ─── MAIN AREA ─── */
        .dcr-main {
          flex: 1;
          display: flex;
          flex-direction: column;
          min-width: 0;
          overflow: hidden;
        }

        /* ─── SEARCH BAR ─── */
        .dcr-search-bar {
          padding: 12px 20px;
          background: #FFFFFF;
          border-bottom: 1px solid #F1F5F9;
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 16px;
          flex-wrap: wrap;
        }
        .dcr-search-input-wrapper {
          position: relative;
          flex: 1;
          min-width: 200px;
          max-width: 400px;
        }
        .dcr-search-icon {
          position: absolute;
          left: 10px;
          top: 50%;
          transform: translateY(-50%);
          color: #94A3B8;
        }
        .dcr-search-input {
          width: 100%;
          padding: 8px 32px 8px 34px;
          border: 1px solid #E2E8F0;
          border-radius: 8px;
          font-size: 13px;
          color: #1E293B;
          background: #F8FAFC;
          outline: none;
          transition: all 0.15s;
          font-family: inherit;
        }
        .dcr-search-input:focus {
          border-color: #3B82F6;
          background: white;
          box-shadow: 0 0 0 3px rgba(59, 130, 246, 0.1);
        }
        .dcr-search-input::placeholder { color: #94A3B8; }
        .dcr-search-clear {
          position: absolute;
          right: 8px;
          top: 50%;
          transform: translateY(-50%);
          background: none;
          border: none;
          color: #94A3B8;
          cursor: pointer;
          padding: 2px;
          display: flex;
        }
        .dcr-search-clear:hover { color: #64748B; }
        .dcr-search-meta {
          display: flex;
          align-items: center;
          gap: 12px;
          font-size: 12px;
          color: #94A3B8;
          font-weight: 500;
          white-space: nowrap;
        }
        .dcr-search-clear-filters {
          display: flex;
          align-items: center;
          gap: 4px;
          font-size: 11px;
          color: #3B82F6;
          background: none;
          border: none;
          cursor: pointer;
          font-weight: 600;
          padding: 0;
        }
        .dcr-search-clear-filters:hover { text-decoration: underline; }

        /* ─── TABLE ─── */
        .dcr-table-wrapper {
          flex: 1;
          overflow: auto;
          background: #FFFFFF;
        }
        .dcr-table {
          width: 100%;
          border-collapse: collapse;
          font-size: 13px;
        }
        .dcr-th {
          padding: 10px 14px;
          font-size: 11px;
          font-weight: 700;
          color: #64748B;
          text-transform: uppercase;
          letter-spacing: 0.06em;
          background: #F8FAFC;
          border-bottom: 2px solid #E2E8F0;
          white-space: nowrap;
          text-align: left;
          position: sticky;
          top: 0;
          z-index: 5;
        }
        .dcr-th-sortable {
          cursor: pointer;
          user-select: none;
          display: table-cell;
        }
        .dcr-th-sortable > span { display: inline; }
        .dcr-th-sortable:hover { color: #334155; background: #F1F5F9; }
        .dcr-th-sortable svg { display: inline-block; vertical-align: middle; }
        .dcr-th-actions { text-align: center; width: 80px; }
        .dcr-tr {
          border-bottom: 1px solid #F1F5F9;
          transition: background 0.1s;
          cursor: pointer;
        }
        .dcr-tr:hover { background: #F8FAFC; }
        .dcr-tr-selected {
          background: #EFF6FF !important;
          border-left: 3px solid #3B82F6;
        }
        .dcr-tr-clean { opacity: 0.65; }
        .dcr-tr-clean:hover { opacity: 1; }
        .dcr-td {
          padding: 10px 14px;
          vertical-align: middle;
          color: #334155;
        }
        .dcr-td-mono {
          font-family: 'JetBrains Mono', monospace;
          font-size: 12px;
          color: #64748B;
          font-weight: 600;
        }
        .dcr-td-col {
          font-weight: 600;
          color: #1E293B;
          max-width: 150px;
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
        }
        .dcr-td-method {
          font-size: 12px;
          color: #64748B;
          font-weight: 500;
        }
        .dcr-td-actions { text-align: center; }

        /* ─── CHIPS ─── */
        .dcr-chip {
          display: inline-flex;
          align-items: center;
          padding: 2px 10px;
          border-radius: 100px;
          font-size: 11px;
          font-weight: 700;
          font-variant-numeric: tabular-nums;
          letter-spacing: 0.02em;
        }
        .dcr-chip-red {
          background: #FEF2F2;
          color: #DC2626;
          border: 1px solid #FECACA;
        }
        .dcr-chip-amber {
          background: #FFFBEB;
          color: #D97706;
          border: 1px solid #FDE68A;
        }
        .dcr-chip-green {
          background: #F0FDF4;
          color: #16A34A;
          border: 1px solid #BBF7D0;
        }
        .dcr-issue-chip {
          display: inline-flex;
          align-items: center;
          gap: 5px;
          padding: 3px 10px;
          border-radius: 6px;
          font-size: 11px;
          font-weight: 600;
          border: 1px solid;
          white-space: nowrap;
        }

        /* ─── STATUS ─── */
        .dcr-status {
          display: inline-block;
          padding: 2px 8px;
          border-radius: 4px;
          font-size: 10px;
          font-weight: 700;
          text-transform: uppercase;
          letter-spacing: 0.06em;
        }
        .dcr-status-green { background: #DCFCE7; color: #166534; }
        .dcr-status-amber { background: #FEF3C7; color: #92400E; }
        .dcr-status-yellow { background: #FEF3C7; color: #92400E; }
        .dcr-status-red { background: #FEE2E2; color: #991B1B; }
        .dcr-status-gray { background: #F1F5F9; color: #64748B; }

        /* ─── ACTION BUTTONS ─── */
        .dcr-action-btns { display: flex; align-items: center; gap: 4px; justify-content: center; }
        .dcr-btn-approve {
          width: 28px;
          height: 28px;
          background: #22C55E;
          color: white;
          border: none;
          border-radius: 6px;
          display: flex;
          align-items: center;
          justify-content: center;
          cursor: pointer;
          transition: all 0.15s;
        }
        .dcr-btn-approve:hover { background: #16A34A; transform: scale(1.05); }
        .dcr-btn-approve:disabled { opacity: 0.5; cursor: default; transform: none; }
        .dcr-btn-reject {
          width: 28px;
          height: 28px;
          background: #F1F5F9;
          color: #64748B;
          border: 1px solid #E2E8F0;
          border-radius: 6px;
          display: flex;
          align-items: center;
          justify-content: center;
          cursor: pointer;
          transition: all 0.15s;
        }
        .dcr-btn-reject:hover { background: #E2E8F0; color: #334155; transform: scale(1.05); }
        .dcr-btn-reject:disabled { opacity: 0.5; cursor: default; transform: none; }
        .dcr-btn-view {
          background: none;
          border: 1px solid #E2E8F0;
          border-radius: 6px;
          padding: 4px 8px;
          color: #64748B;
          cursor: pointer;
          display: flex;
          align-items: center;
          justify-content: center;
          transition: all 0.15s;
        }
        .dcr-btn-view:hover { background: #F1F5F9; color: #334155; }
        .dcr-clean-label { color: #22C55E; display: flex; justify-content: center; }

        /* ─── EMPTY STATE ─── */
        .dcr-empty {
          padding: 60px 20px;
          text-align: center;
          color: #94A3B8;
        }
        .dcr-empty-icon { margin: 0 auto 16px; color: #CBD5E1; }
        .dcr-empty h3 { font-size: 16px; font-weight: 600; color: #475569; margin: 0 0 6px; }
        .dcr-empty p { font-size: 13px; margin: 0 0 16px; }
        .dcr-empty-btn {
          display: inline-flex;
          align-items: center;
          gap: 6px;
          background: #3B82F6;
          color: white;
          border: none;
          border-radius: 8px;
          padding: 8px 16px;
          font-size: 13px;
          font-weight: 600;
          cursor: pointer;
        }
        .dcr-empty-btn:hover { background: #2563EB; }

        /* ─── DRAWER ─── */
        .dcr-drawer-overlay {
          position: fixed;
          inset: 0;
          background: rgba(15, 23, 42, 0.35);
          backdrop-filter: blur(2px);
          z-index: 90;
          animation: dcr-fade-in 0.2s ease;
        }
        .dcr-drawer {
          position: fixed;
          top: 0;
          right: 0;
          bottom: 0;
          width: 520px;
          max-width: 92vw;
          background: #FFFFFF;
          box-shadow: -12px 0 40px rgba(0,0,0,0.1), -2px 0 8px rgba(0,0,0,0.05);
          z-index: 100;
          display: flex;
          flex-direction: column;
          animation: dcr-slide-in 0.3s cubic-bezier(0.16, 1, 0.3, 1);
          overflow: hidden;
        }
        @keyframes dcr-slide-in {
          from { transform: translateX(100%); }
          to { transform: translateX(0); }
        }
        @keyframes dcr-fade-in {
          from { opacity: 0; }
          to { opacity: 1; }
        }

        /* ── Drawer Header ── */
        .dd-header {
          padding: 20px 24px 16px;
          border-bottom: 1px solid #E2E8F0;
          background: #FAFBFC;
        }
        .dd-header-top {
          display: flex;
          align-items: center;
          justify-content: space-between;
          margin-bottom: 10px;
        }
        .dd-severity-badge {
          display: inline-flex;
          align-items: center;
          gap: 6px;
          padding: 5px 12px;
          border-radius: 8px;
          font-size: 12px;
          font-weight: 700;
          border: 1.5px solid;
          letter-spacing: 0.01em;
        }
        .dd-close {
          background: none;
          border: 1px solid #E2E8F0;
          border-radius: 8px;
          padding: 6px;
          color: #94A3B8;
          cursor: pointer;
          display: flex;
          transition: all 0.15s;
        }
        .dd-close:hover { background: #F1F5F9; color: #475569; }
        .dd-header-info {
          display: flex;
          align-items: baseline;
          gap: 10px;
          margin-bottom: 12px;
        }
        .dd-col-name {
          font-size: 20px;
          font-weight: 800;
          color: #0F172A;
          margin: 0;
          letter-spacing: -0.01em;
        }
        .dd-row-id {
          font-size: 13px;
          font-weight: 600;
          color: #94A3B8;
          font-family: 'JetBrains Mono', monospace;
        }
        .dd-header-values {
          display: flex;
          align-items: center;
          gap: 8px;
          flex-wrap: wrap;
        }
        .dd-val-pill {
          display: flex;
          flex-direction: column;
          gap: 2px;
          padding: 6px 12px;
          border-radius: 8px;
          border: 1px solid;
          min-width: 0;
        }
        .dd-val-pill code {
          font-family: 'JetBrains Mono', monospace;
          font-size: 12px;
          font-weight: 600;
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
          max-width: 160px;
          display: block;
        }
        .dd-val-label {
          font-size: 9px;
          font-weight: 700;
          text-transform: uppercase;
          letter-spacing: 0.08em;
          color: #94A3B8;
        }
        .dd-val-original { border-color: #FECACA; background: #FEF2F2; }
        .dd-val-original code { color: #DC2626; }
        .dd-val-repaired { border-color: #BBF7D0; background: #F0FDF4; }
        .dd-val-repaired code { color: #16A34A; }
        .dd-val-arrow { color: #CBD5E1; flex-shrink: 0; }

        /* ── Drawer Body ── */
        .dd-body {
          flex: 1;
          overflow-y: auto;
          padding: 20px 24px;
          display: flex;
          flex-direction: column;
          gap: 16px;
        }

        /* ── Confidence Card ── */
        .dd-confidence-card {
          padding: 16px;
          background: #FAFBFC;
          border: 1px solid #E2E8F0;
          border-radius: 12px;
          flex-shrink: 0;
        }
        .dd-conf-row {
          display: flex;
          align-items: baseline;
          gap: 12px;
          margin-bottom: 10px;
        }
        .dd-conf-number {
          font-size: 48px;
          font-weight: 900;
          font-family: 'JetBrains Mono', monospace;
          line-height: 1;
          letter-spacing: -0.03em;
        }
        .dd-conf-meta {
          display: flex;
          flex-direction: column;
          gap: 1px;
        }
        .dd-conf-label {
          font-size: 13px;
          font-weight: 700;
          letter-spacing: 0.01em;
        }
        .dd-conf-sublabel {
          font-size: 11px;
          color: #94A3B8;
          font-weight: 500;
        }
        .dd-conf-bar-track {
          width: 100%;
          height: 6px;
          background: #E2E8F0;
          border-radius: 3px;
          overflow: hidden;
        }
        .dd-conf-bar-fill {
          height: 100%;
          border-radius: 3px;
          transition: width 0.5s ease;
          min-width: 3px;
        }

        /* ── Generic Section ── */
        .dd-section {
          border: 1px solid #E2E8F0;
          border-radius: 12px;
          padding: 14px 16px;
          background: #FFFFFF;
          flex-shrink: 0;
        }
        .dd-section-label {
          display: flex;
          align-items: center;
          gap: 6px;
          font-size: 11px;
          font-weight: 700;
          color: #475569;
          text-transform: uppercase;
          letter-spacing: 0.06em;
          margin-bottom: 10px;
        }
        .dd-section-sublabel {
          font-size: 10px;
          font-weight: 500;
          color: #94A3B8;
          text-transform: none;
          letter-spacing: normal;
          margin-left: auto;
        }

        /* ── Detected By ── */
        .dd-detected-by {
          background: #FAFBFC;
        }
        .dd-method-tags {
          display: flex;
          flex-wrap: wrap;
          gap: 6px;
          margin-bottom: 14px;
        }
        .dd-method-tag {
          display: inline-flex;
          align-items: center;
          gap: 6px;
          padding: 5px 10px;
          border-radius: 8px;
          border: 1.5px solid;
          font-size: 12px;
          background: white;
        }
        .dd-method-name {
          font-weight: 600;
          color: #334155;
        }
        .dd-method-score {
          font-family: 'JetBrains Mono', monospace;
          font-size: 10px;
          font-weight: 700;
        }
        .dd-method-violation {
          border-color: #FECACA;
          background: #FEF2F2;
        }
        .dd-method-violation .dd-method-name { color: #DC2626; }
        .dd-method-violation svg { color: #DC2626; }

        /* Score bars */
        .dd-score-bars {
          display: flex;
          flex-direction: column;
          gap: 6px;
          padding-top: 10px;
          border-top: 1px solid #F1F5F9;
        }
        .dd-sbar-row {
          display: flex;
          align-items: center;
          gap: 8px;
        }
        .dd-sbar-label {
          font-size: 11px;
          font-weight: 600;
          color: #64748B;
          min-width: 72px;
        }
        .dd-sbar-track {
          flex: 1;
          height: 5px;
          background: #E2E8F0;
          border-radius: 3px;
          overflow: hidden;
        }
        .dd-sbar-fill {
          height: 100%;
          border-radius: 3px;
          transition: width 0.4s ease;
          min-width: 2px;
        }
        .dd-sbar-val {
          font-family: 'JetBrains Mono', monospace;
          font-size: 10px;
          font-weight: 700;
          color: #94A3B8;
          min-width: 38px;
          text-align: right;
        }

        /* ── AI Explanation ── */
        .dd-ai-section {
          border: 1.5px solid #C7D2FE;
          background: linear-gradient(135deg, #EEF2FF 0%, #F5F3FF 100%);
          position: relative;
          overflow: hidden;
        }
        .dd-ai-section::before {
          content: '';
          position: absolute;
          top: -40px;
          right: -40px;
          width: 120px;
          height: 120px;
          background: radial-gradient(circle, rgba(99,102,241,0.06) 0%, transparent 70%);
          pointer-events: none;
        }
        .dd-ai-label {
          display: flex;
          align-items: center;
          gap: 10px;
          margin-bottom: 12px;
        }
        .dd-ai-icon-wrap {
          width: 32px;
          height: 32px;
          background: linear-gradient(135deg, #6366F1, #8B5CF6);
          border-radius: 8px;
          display: flex;
          align-items: center;
          justify-content: center;
          color: white;
          flex-shrink: 0;
        }
        .dd-ai-title {
          display: block;
          font-size: 13px;
          font-weight: 700;
          color: #312E81;
        }
        .dd-ai-source {
          display: block;
          font-size: 10px;
          font-weight: 500;
          color: #6366F1;
          letter-spacing: 0.02em;
        }
        .dd-ai-body {
          background: rgba(255,255,255,0.7);
          border: 1px solid #DDD6FE;
          border-radius: 10px;
          padding: 14px 16px;
          margin-bottom: 10px;
        }
        .dd-ai-text {
          font-size: 13px;
          line-height: 1.7;
          color: #334155;
          margin: 0;
        }
        .dd-ai-notice {
          display: flex;
          align-items: flex-start;
          gap: 6px;
          font-size: 10px;
          color: #6366F1;
          font-weight: 500;
          opacity: 0.8;
        }
        .dd-ai-notice svg { margin-top: 1px; flex-shrink: 0; }

        /* AI Loading animation styles */
        .dd-ai-loading {
          display: flex;
          align-items: center;
          gap: 12px;
          padding: 16px;
          background: rgba(99, 102, 241, 0.05);
          border: 1.5px dashed #C7D2FE;
          border-radius: 10px;
          color: #6366F1;
          font-size: 12px;
          font-weight: 500;
          margin-bottom: 10px;
          animation: pulse 2s infinite ease-in-out;
        }
        .dd-ai-loading-spinner {
          width: 16px;
          height: 16px;
          border: 2px solid #C7D2FE;
          border-top-color: #6366F1;
          border-radius: 50%;
          animation: spin 1.2s infinite linear;
        }

        /* Value Comparison styles */
        .dd-comparison-section {
          background: #FAFBFC;
          border: 1px solid #E2E8F0;
        }
        .dd-comparison-card {
          display: flex;
          align-items: center;
          gap: 12px;
          background: #FFFFFF;
          border: 1px solid #E2E8F0;
          border-radius: 10px;
          padding: 14px 16px;
        }
        .dd-comp-col {
          flex: 1;
          display: flex;
          flex-direction: column;
          gap: 6px;
        }
        .dd-comp-label {
          font-size: 9px;
          font-weight: 700;
          color: #64748B;
          text-transform: uppercase;
          letter-spacing: 0.05em;
        }
        .dd-comp-val {
          font-size: 13px;
          font-weight: 600;
          font-family: 'JetBrains Mono', monospace;
          padding: 8px 12px;
          border-radius: 8px;
          min-height: 36px;
          display: flex;
          align-items: center;
          word-break: break-all;
        }
        .dd-comp-val-before {
          background: #FFF5F5;
          border: 1px solid #FEE2E2;
          color: #C53030;
        }
        .dd-comp-val-after {
          background: #F0FDF4;
          border: 1px solid #DCFCE7;
          color: #15803D;
        }
        .dd-comp-val-applied {
          border-style: solid;
          background: #DCFCE7;
        }
        .dd-comp-arrow-wrap {
          display: flex;
          align-items: center;
          justify-content: center;
          flex-shrink: 0;
        }
        .dd-val-empty {
          color: #94A3B8;
          font-style: italic;
          font-weight: 500;
        }
        .dd-val-dropped {
          color: #BE123C;
          font-weight: 700;
          text-transform: uppercase;
          font-size: 11px;
        }

        @keyframes spin {
          0% { transform: rotate(0deg); }
          100% { transform: rotate(360deg); }
        }

        /* ── Suggested Fix ── */
        .dd-fix-section { background: #FAFBFC; }
        .dd-fix-card {
          background: #F0FDF4;
          border: 1px solid #BBF7D0;
          border-radius: 10px;
          padding: 12px 16px;
        }
        .dd-fix-action {
          font-size: 14px;
          font-weight: 700;
          color: #166534;
          margin-bottom: 4px;
        }
        .dd-fix-detail {
          font-size: 12px;
          line-height: 1.5;
          color: #475569;
          margin: 0;
        }

        /* ── Imputation Section ── */
        .dd-impute-section {
          background: #EEF2F6;
          border-color: #CBD5E1;
        }
        .dd-impute-options {
          display: flex;
          flex-direction: column;
          gap: 8px;
          margin-top: 8px;
        }
        .dd-impute-btn {
          display: flex;
          align-items: center;
          justify-content: center;
          padding: 10px 16px;
          background: #FFFFFF;
          border: 1px solid #CBD5E1;
          color: #334155;
          font-size: 12px;
          font-weight: 600;
          border-radius: 8px;
          cursor: pointer;
          transition: all 0.15s;
        }
        .dd-impute-btn:hover {
          background: #F8FAFC;
          color: #0F172A;
          border-color: #94A3B8;
          box-shadow: 0 1px 3px rgba(0,0,0,0.05);
        }
        .dd-impute-btn:active {
          transform: scale(0.98);
        }

        /* ── Edit Value ── */
        .dd-edit-section { background: #FFFBEB; border-color: #FDE68A; }
        .dd-edit-row {
          display: flex;
          align-items: center;
          gap: 8px;
        }
        .dd-edit-input {
          flex: 1;
          padding: 8px 12px;
          border: 1px solid #E2E8F0;
          border-radius: 8px;
          font-size: 13px;
          font-family: 'JetBrains Mono', monospace;
          color: #1E293B;
          background: white;
          outline: none;
          transition: all 0.15s;
        }
        .dd-edit-input:focus {
          border-color: #3B82F6;
          box-shadow: 0 0 0 3px rgba(59,130,246,0.1);
        }
        .dd-edit-apply {
          padding: 8px 14px;
          background: #3B82F6;
          color: white;
          border: none;
          border-radius: 8px;
          font-size: 12px;
          font-weight: 700;
          cursor: pointer;
          transition: all 0.15s;
          white-space: nowrap;
        }
        .dd-edit-apply:hover { background: #2563EB; }
        .dd-edit-apply:disabled { opacity: 0.5; cursor: default; }
        .dd-edit-cancel {
          padding: 8px 12px;
          background: none;
          color: #64748B;
          border: 1px solid #E2E8F0;
          border-radius: 8px;
          font-size: 12px;
          font-weight: 600;
          cursor: pointer;
          transition: all 0.15s;
          white-space: nowrap;
        }
        .dd-edit-cancel:hover { background: #F1F5F9; }

        /* ── Drawer Footer — 3 Action Buttons ── */
        .dd-footer {
          padding: 16px 24px;
          border-top: 1px solid #E2E8F0;
          background: #FAFBFC;
          display: flex;
          align-items: center;
          gap: 8px;
        }
        .dd-action-btn {
          flex: 1;
          display: flex;
          align-items: center;
          justify-content: center;
          gap: 6px;
          padding: 10px 12px;
          border-radius: 10px;
          font-size: 13px;
          font-weight: 700;
          cursor: pointer;
          transition: all 0.15s;
          border: none;
        }
        .dd-action-btn:disabled {
          opacity: 0.45;
          cursor: default;
          transform: none !important;
        }
        .dd-action-btn:not(:disabled):hover { transform: translateY(-1px); }
        .dd-action-btn:not(:disabled):active { transform: translateY(0); }

        .dd-btn-reject {
          background: #F1F5F9;
          color: #475569;
          border: 1px solid #E2E8F0;
        }
        .dd-btn-reject:not(:disabled):hover { background: #FEF2F2; color: #DC2626; border-color: #FECACA; }

        .dd-btn-drop {
          background: #FEF2F2;
          color: #DC2626;
          border: 1px solid #FEE2E2;
        }
        .dd-btn-drop:not(:disabled):hover { background: #FEE2E2; border-color: #FCA5A5; }

        .dd-btn-edit {
          background: #FFFBEB;
          color: #92400E;
          border: 1px solid #FDE68A;
        }
        .dd-btn-edit:not(:disabled):hover { background: #FEF3C7; border-color: #FCD34D; }

        .dd-btn-accept {
          background: linear-gradient(135deg, #22C55E, #16A34A);
          color: white;
          box-shadow: 0 2px 8px rgba(34,197,94,0.3);
        }
        .dd-btn-accept:not(:disabled):hover {
          background: linear-gradient(135deg, #16A34A, #15803D);
          box-shadow: 0 4px 12px rgba(34,197,94,0.4);
        }

        /* ─── RESPONSIVE ─── */
        @media (max-width: 768px) {
          .dcr-layout { flex-direction: column; }
          .dcr-sidebar {
            width: 100% !important;
            min-width: 100% !important;
            border-right: none;
            border-bottom: 1px solid #E2E8F0;
          }
          .dcr-sidebar-body { max-height: 300px; }
          .dcr-drawer { width: 100%; max-width: 100%; }
          .dcr-topbar { flex-direction: column; align-items: flex-start; }
          .dd-header-values { flex-direction: column; }
          .dd-conf-number { font-size: 36px; }
          .dd-footer { flex-direction: column; }
          .dd-action-btn { width: 100%; }
          .dd-edit-row { flex-direction: column; }
          .dd-edit-input { width: 100%; }
        }
      `}</style>
    </div>
  );
}
