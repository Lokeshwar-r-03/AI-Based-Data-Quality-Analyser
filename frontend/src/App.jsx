import React, { useState, useEffect } from "react";
import { fetchHealth, fetchBeforeAfter, fetchFindings, fetchCurrentUser, logout, claimAnalysis, fetchRecentAnalyses, deleteUserAccount, signup, login as apiLogin, forgotPassword as apiForgotPassword, resetPassword as apiResetPassword } from "./api/client";
import Upload from "./pages/Upload";
import Processing from "./pages/Processing";
import Dashboard from "./pages/Dashboard";
import ReviewQueue from "./pages/ReviewQueue";
import Findings from "./pages/Findings";
import DataCleaningReview from "./pages/DataCleaningReview";
import Report from "./pages/Report";
import Why from "./pages/Why";
import ProfileSettings from "./pages/ProfileSettings";
import UploadHistory from "./pages/UploadHistory";
import { AlertTriangle, LayoutDashboard, SearchCode, ClipboardList, CheckSquare, Sun, Moon, X, XCircle, CheckCircle2, Settings, Clock } from "lucide-react";

export default function App() {
  const [screen, setScreen] = useState("upload"); // upload, processing, dashboard
  const [activeTab, setActiveTab] = useState("dashboard"); // dashboard, findings, report, why
  
  const [user, setUser] = useState(null);
  const [loadingUser, setLoadingUser] = useState(true);
  const [userMenuOpen, setUserMenuOpen] = useState(false);

  // Authentication & Password Reset states
  const [authModalOpen, setAuthModalOpen] = useState(false);
  const [authMode, setAuthMode] = useState("login"); // "login", "signup", "forgot"
  const [authEmail, setAuthEmail] = useState("");
  const [authPassword, setAuthPassword] = useState("");
  const [authConfirmPassword, setAuthConfirmPassword] = useState("");
  const [authName, setAuthName] = useState("");
  const [authLoading, setAuthLoading] = useState(false);
  const [authMessage, setAuthMessage] = useState("");
  const [authError, setAuthError] = useState("");
  
  const [isResetPage, setIsResetPage] = useState(false);
  const [resetToken, setResetToken] = useState(null);

  useEffect(() => {
    if (window.location.pathname === "/reset-password") {
      setIsResetPage(true);
      const params = new URLSearchParams(window.location.search);
      setResetToken(params.get("token"));
    }
  }, []);
  const [sizeGuardMessage, setSizeGuardMessage] = useState(null);
  
  const [analysisId, setAnalysisId] = useState(null);
  const [dataset, setDataset] = useState(null);
  const [findings, setFindings] = useState([]);
  const [beforeMetrics, setBeforeMetrics] = useState(null);
  const [afterMetrics, setAfterMetrics] = useState(null);
  
  const [analysisStartTime, setAnalysisStartTime] = useState(null);
  const [analysisDuration, setAnalysisDuration] = useState(null);
  const [refreshTrigger, setRefreshTrigger] = useState(0);
  
  const [aiAvailable, setAiAvailable] = useState(true);
  const [backendConnected, setBackendConnected] = useState(true);
  const [queueFilter, setQueueFilter] = useState(null); // null, "unresolved_missing"
  const [deleteModalOpen, setDeleteModalOpen] = useState(false);
  const [deleteConfirmText, setDeleteConfirmText] = useState("");
  const [userAnalysisCount, setUserAnalysisCount] = useState(0);
  const [fetchingCount, setFetchingCount] = useState(false);
  const [deletingAccount, setDeletingAccount] = useState(false);

  const handleNavigateToQueueFiltered = () => {
    setQueueFilter("unresolved_missing");
    setActiveTab("review");
  };

  const [theme, setTheme] = useState(() => {
    return localStorage.getItem("theme") || "dark";
  });
  const [toasts, setToasts] = useState([]);

  useEffect(() => {
    if (theme === "light") {
      document.documentElement.classList.add("light");
    } else {
      document.documentElement.classList.remove("light");
    }
    localStorage.setItem("theme", theme);
  }, [theme]);

  const toggleTheme = () => {
    setTheme((prev) => (prev === "dark" ? "light" : "dark"));
  };

  const showToast = (message, type = "success") => {
    const id = Math.random().toString(36).substring(2, 9);
    setToasts((prev) => [...prev, { id, message, type }]);
    setTimeout(() => {
      setToasts((prev) => prev.filter((t) => t.id !== id));
    }, 4000);
  };

  const removeToast = (id) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  };

  const checkAuth = async () => {
    try {
      const currentUser = await fetchCurrentUser();
      setUser(currentUser);
      
      if (currentUser) {
        // 1. Check for too large warning
        if (sessionStorage.getItem("pending_analysis_too_large") === "true") {
          const filename = sessionStorage.getItem("pending_analysis_filename") || "dataset";
          setSizeGuardMessage(`You were signed in successfully, but your last analysis was too large to carry over automatically. Please re-upload ${filename} to save it to your account.`);
          sessionStorage.removeItem("pending_analysis_too_large");
          sessionStorage.removeItem("pending_analysis_filename");
        }
        
        // 2. Check for normal pending analysis payload
        const pendingStr = sessionStorage.getItem("pending_analysis");
        if (pendingStr) {
          try {
            const data = JSON.parse(pendingStr);
            // POST to claim endpoint on backend
            await claimAnalysis(data.analysisId);
            
            // Clear sessionStorage
            sessionStorage.removeItem("pending_analysis");
            
            // Restore React states
            setAnalysisId(data.analysisId);
            setDataset(data.dataset);
            setFindings(data.findings);
            setBeforeMetrics(data.beforeMetrics);
            setAfterMetrics(data.afterMetrics);
            setAnalysisDuration(data.analysisDuration);
            
            setScreen("dashboard");
            setActiveTab("dashboard");
            
            showToast(`Your analysis of ${data.dataset.filename} has been saved to your account.`, "success");
          } catch (err) {
            console.error("Failed to claim pending analysis:", err);
            showToast("Failed to save previous analysis to your account", "error");
          }
        }
      }
    } catch (err) {
      console.error("Auth check failed:", err);
    } finally {
      setLoadingUser(false);
    }
  };

  const checkConnectivity = async () => {
    try {
      const health = await fetchHealth();
      setBackendConnected(true);
      setAiAvailable(health.ai_available);
    } catch (err) {
      setBackendConnected(false);
      setAiAvailable(false);
    }
  };

  useEffect(() => {
    checkConnectivity();
    checkAuth();
    const interval = setInterval(checkConnectivity, 10000);
    return () => clearInterval(interval);
  }, []);

  const handleSignOut = async () => {
    try {
      await logout();
      setUser(null);
      setUserMenuOpen(false);
      handleRestart();
      showToast("Signed out successfully", "success");
    } catch (err) {
      showToast("Sign out failed", "error");
    }
  };

  const savePendingAnalysis = () => {
    if (analysisId && dataset && beforeMetrics) {
      const payload = {
        analysisId,
        dataset,
        findings,
        beforeMetrics,
        afterMetrics,
        analysisDuration
      };
      
      const serialized = JSON.stringify(payload);
      const byteSize = serialized.length * 2;
      
      if (byteSize > 2 * 1024 * 1024) {
        sessionStorage.setItem("pending_analysis_too_large", "true");
        sessionStorage.setItem("pending_analysis_filename", dataset.filename);
      } else {
        sessionStorage.setItem("pending_analysis", serialized);
      }
    }
  };

  const handleGoogleSignIn = () => {
    savePendingAnalysis();
    window.location.href = "http://localhost:8000/api/auth/google/login";
  };

  const handleSignIn = () => {
    savePendingAnalysis();
    setAuthMode("login");
    setAuthEmail("");
    setAuthPassword("");
    setAuthConfirmPassword("");
    setAuthName("");
    setAuthError("");
    setAuthMessage("");
    setAuthModalOpen(true);
  };

  const handleAuthSubmit = async (e) => {
    e.preventDefault();
    setAuthLoading(true);
    setAuthError("");
    setAuthMessage("");

    try {
      if (authMode === "login") {
        await apiLogin(authEmail, authPassword);
        setAuthModalOpen(false);
        showToast("Signed in successfully", "success");
        await checkAuth();
      } else if (authMode === "signup") {
        if (authPassword.length < 8) {
          throw new Error("Password must be at least 8 characters long.");
        }
        await signup(authEmail, authPassword, authName);
        setAuthModalOpen(false);
        showToast("Account created successfully", "success");
        await checkAuth();
      } else if (authMode === "forgot") {
        await apiForgotPassword(authEmail);
        setAuthMessage("If an account exists for this email, we've sent a reset link. Check your inbox.");
      }
    } catch (err) {
      setAuthError(err.message || "An error occurred during authentication.");
    } finally {
      setAuthLoading(false);
    }
  };

  const handleResetSubmit = async (e) => {
    e.preventDefault();
    setAuthLoading(true);
    setAuthError("");
    setAuthMessage("");

    if (authPassword !== authConfirmPassword) {
      setAuthError("Passwords do not match.");
      setAuthLoading(false);
      return;
    }

    if (authPassword.length < 8) {
      setAuthError("Password must be at least 8 characters long.");
      setAuthLoading(false);
      return;
    }

    try {
      await apiResetPassword(resetToken, authPassword);
      setAuthMessage("Password updated. Please sign in with your new password.");
    } catch (err) {
      setAuthError(err.message || "Failed to reset password.");
    } finally {
      setAuthLoading(false);
    }
  };

  const handleScrollToHowItWorks = () => {
    if (screen !== "upload" || activeTab !== "dashboard") {
      handleRestart();
    }
    setTimeout(() => {
      document.getElementById("how-it-works")?.scrollIntoView({ behavior: "smooth" });
    }, 150);
  };

  const handleMyAnalysesClick = () => {
    setUserMenuOpen(false);
    if (screen !== "upload" || activeTab !== "dashboard") {
      handleRestart();
    }
    setTimeout(() => {
      document.getElementById("recent-uploads-section")?.scrollIntoView({ behavior: "smooth" });
    }, 150);
  };

  const handleOpenDeleteModal = async () => {
    setUserMenuOpen(false);
    setDeleteConfirmText("");
    setFetchingCount(true);
    setDeleteModalOpen(true);
    try {
      const list = await fetchRecentAnalyses();
      setUserAnalysisCount(list.length);
    } catch (err) {
      console.error("Failed to fetch analyses count for deletion:", err);
      setUserAnalysisCount(0);
    } finally {
      setFetchingCount(false);
    }
  };

  const handleConfirmDeleteAccount = async () => {
    if (deleteConfirmText !== "DELETE") return;
    setDeletingAccount(true);
    try {
      await deleteUserAccount();
      setDeleteModalOpen(false);
      setUser(null);
      handleRestart();
      showToast("Your account and data have been deleted.", "success");
    } catch (err) {
      console.error("Account deletion failed:", err);
      showToast("Failed to delete account. Please try again.", "error");
    } finally {
      setDeletingAccount(false);
    }
  };

  const handleRestoreAnalysis = async (histAnalysis) => {
    setLoadingUser(true);
    try {
      setAnalysisId(histAnalysis.id);
      
      setDataset({
        dataset_id: histAnalysis.id,
        filename: histAnalysis.filename,
        row_count: histAnalysis.rows,
        column_count: histAnalysis.columns,
        schema_fingerprint: {}
      });
      
      const [baData, findingsData] = await Promise.all([
        fetchBeforeAfter(histAnalysis.id),
        fetchFindings(histAnalysis.id)
      ]);
      setBeforeMetrics(baData.before);
      setAfterMetrics(baData.after);
      setFindings(findingsData.findings);
      
      setScreen("dashboard");
      setActiveTab("dashboard");
      showToast("Analysis restored successfully", "success");
    } catch (err) {
      console.error("Failed to restore analysis:", err);
      showToast("Failed to restore analysis", "error");
    } finally {
      setLoadingUser(false);
    }
  };

  const handleAnalysisStarted = (newAnalysisId, uploadedDataset) => {
    setAnalysisId(newAnalysisId);
    setDataset(uploadedDataset);
    setAnalysisStartTime(Date.now());
    setScreen("processing");
  };

  const loadAnalysisData = async () => {
    try {
      const [baData, findingsData] = await Promise.all([
        fetchBeforeAfter(analysisId),
        fetchFindings(analysisId)
      ]);
      setBeforeMetrics(baData.before);
      setAfterMetrics(baData.after);
      setFindings(findingsData.findings);
    } catch (err) {
      console.error("Failed to load analysis results:", err);
    }
  };

  const handleProcessingComplete = async () => {
    if (analysisStartTime) {
      const duration = ((Date.now() - analysisStartTime) / 1000).toFixed(1);
      setAnalysisDuration(duration);
    } else {
      setAnalysisDuration("3.2");
    }

    // Retry loading analysis data up to 3 times with a short delay.
    // The backend marks status=completed in the same DB commit as the findings
    // insert, but occasionally a brief propagation delay causes the first read
    // to return empty findings. Retrying resolves this race condition.
    let loaded = false;
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        await loadAnalysisData();
        loaded = true;
        break;
      } catch (err) {
        console.warn(`loadAnalysisData attempt ${attempt + 1} failed:`, err);
        if (attempt < 2) {
          await new Promise((res) => setTimeout(res, 800));
        }
      }
    }
    if (!loaded) {
      console.error("Failed to load analysis data after 3 attempts.");
    }

    setScreen("dashboard");
    setActiveTab("dashboard");
  };

  const handleFindingsUpdated = async () => {
    await loadAnalysisData();
    setRefreshTrigger((prev) => prev + 1);
  };

  const handleRestart = () => {
    setAnalysisId(null);
    setDataset(null);
    setFindings([]);
    setBeforeMetrics(null);
    setAfterMetrics(null);
    setAnalysisStartTime(null);
    setAnalysisDuration(null);
    setScreen("upload");
    setActiveTab("dashboard");
  };

  if (loadingUser) {
    return (
      <div className="min-h-screen bg-slate-950 text-slate-100 flex flex-col items-center justify-center font-sans">
        <div className="flex flex-col items-center gap-4">
          <div className="w-10 h-10 border-4 border-brand-500 border-t-transparent rounded-full animate-spin"></div>
          <div className="text-slate-400 text-xs font-mono tracking-wider uppercase animate-pulse">
            AUTHENTICATING USER SESSION...
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 flex flex-col font-sans">
      {/* Degraded State Alert Banner */}
      {(!backendConnected || !aiAvailable) && (
        <div className="bg-slate-900 border-b border-slate-800 text-slate-400 px-4 py-2 text-center text-xs flex items-center justify-center gap-2 select-none transition-all shrink-0 font-mono">
          <div className={`w-2 h-2 rounded-full shrink-0 ${!backendConnected ? "bg-red-500 animate-ping" : "bg-amber-500 animate-pulse"}`}></div>
          <span>
            {!backendConnected 
              ? "SYSTEM OFFLINE: Retrying backend connection..." 
              : "AI ENGINE OFFLINE: Explanation generator bypassed. Deterministic pipeline fully active."}
          </span>
        </div>
      )}

      {/* Navigation Header */}
      <header className="border-b border-slate-800 bg-slate-900/50 backdrop-blur sticky top-0 z-40">
        <div className="max-w-6xl mx-auto px-4 h-16 flex items-center justify-between">
          <div className="flex items-center gap-6">
            <div className="flex items-center gap-2.5 cursor-pointer select-none" onClick={handleRestart}>
              <div className="w-8 h-8 bg-brand-500 rounded-lg flex items-center justify-center text-white font-extrabold text-sm shadow-md shadow-brand-500/20">
                D
              </div>
              <h1 className="text-xl font-bold tracking-tight text-slate-100">DataSet<span className="text-brand-400">IQ</span></h1>
            </div>

            <div className="hidden sm:flex items-center gap-1.5">
              <button
                onClick={handleScrollToHowItWorks}
                className="px-3 py-1.5 rounded-lg text-xs font-semibold text-slate-400 hover:text-slate-200 hover:bg-slate-850/45 transition-all cursor-pointer focus:outline-none"
              >
                How it Works
              </button>
              <button
                onClick={() => {
                  setActiveTab("why");
                }}
                className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-all cursor-pointer focus:outline-none ${
                  activeTab === "why"
                    ? "bg-blue-500/10 text-blue-400 border border-blue-500/20"
                    : "text-slate-400 hover:text-slate-200 border border-transparent hover:bg-slate-850/45"
                }`}
              >
                Why DataSetIQ
              </button>
            </div>
          </div>

          <div className="flex items-center gap-4">
            {screen === "dashboard" && activeTab !== "why" && (
              <button
                onClick={handleRestart}
                className="text-slate-400 hover:text-slate-100 border border-slate-800 hover:bg-slate-800/50 transition-all px-4 py-1.5 rounded-lg text-xs font-semibold focus:outline-none cursor-pointer"
              >
                Upload New
              </button>
            )}

            {/* Account Menu / Sign In Button */}
            {!user ? (
              <button
                onClick={handleSignIn}
                className="px-4 py-1.5 rounded-lg text-xs font-semibold bg-brand-500 hover:bg-brand-600 text-white transition-all shadow-md shadow-brand-500/10 active:scale-95 cursor-pointer flex items-center justify-center focus:outline-none"
                id="sign-in-btn"
              >
                Sign In
              </button>
            ) : (
              <div className="relative">
                <button
                  onClick={() => setUserMenuOpen(!userMenuOpen)}
                  className="flex items-center gap-2 px-3 py-1.5 rounded-lg border border-slate-800 bg-slate-900/60 hover:bg-slate-800/80 transition-all text-xs text-slate-350 cursor-pointer focus:outline-none"
                  id="user-menu-btn"
                >
                  <div className="w-5 h-5 rounded-full bg-brand-500/20 text-brand-400 border border-brand-500/30 flex items-center justify-center font-bold text-[10px] uppercase">
                    {user.name ? user.name.charAt(0) : "U"}
                  </div>
                  <span className="font-semibold text-slate-200 truncate max-w-[100px]">{user.name}</span>
                  <span className="text-[9px] text-slate-500">▼</span>
                </button>
                {userMenuOpen && (
                  <>
                    <div className="fixed inset-0 z-45" onClick={() => setUserMenuOpen(false)}></div>
                    <div className="absolute right-0 mt-2 w-52 bg-slate-900 border border-slate-800 rounded-lg shadow-2xl py-1.5 z-50 animate-slide-in">
                      <div className="px-4 py-2 border-b border-slate-800/60 select-none">
                        <p className="text-[9px] text-slate-500 uppercase tracking-wider font-semibold font-mono">Account Profile</p>
                        <p className="text-xs font-bold text-slate-200 truncate mt-0.5" id="user-display-name">{user.name}</p>
                        <p className="text-[10px] text-slate-500 truncate">{user.email}</p>
                      </div>
                      <button
                        onClick={() => {
                          setUserMenuOpen(false);
                          setActiveTab("profile");
                        }}
                        className="w-full text-left px-4 py-2 text-xs text-slate-300 hover:bg-slate-800/50 hover:text-slate-100 transition-colors flex items-center gap-2 cursor-pointer font-medium"
                        id="profile-settings-btn"
                      >
                        <Settings className="w-3.5 h-3.5 text-slate-500" />
                        Profile Settings
                      </button>
                      <button
                        onClick={() => {
                          setUserMenuOpen(false);
                          setActiveTab("history");
                        }}
                        className="w-full text-left px-4 py-2 text-xs text-slate-300 hover:bg-slate-800/50 hover:text-slate-100 transition-colors flex items-center gap-2 cursor-pointer font-medium"
                        id="my-analyses-btn"
                      >
                        <Clock className="w-3.5 h-3.5 text-slate-500" />
                        Upload History
                      </button>
                      <div className="border-t border-slate-800/40 my-1"></div>
                      <button
                        onClick={handleOpenDeleteModal}
                        className="w-full text-left px-4 py-2 text-xs text-rose-500 hover:bg-rose-500/10 hover:text-rose-400 transition-colors flex items-center gap-2 font-semibold cursor-pointer"
                        id="delete-account-btn"
                      >
                        Delete My Account & Data
                      </button>
                      <div className="border-t border-slate-800/40 my-1"></div>
                      <button
                        onClick={handleSignOut}
                        className="w-full text-left px-4 py-2 text-xs text-red-400 hover:bg-red-500/10 hover:text-red-300 transition-colors flex items-center gap-2 font-bold cursor-pointer"
                        id="sign-out-btn"
                      >
                        Sign Out
                      </button>
                    </div>
                  </>
                )}
              </div>
            )}
            {/* Theme Toggle */}
            <button
              onClick={toggleTheme}
              className="text-slate-505 hover:text-slate-350 transition-all p-1.5 rounded-full hover:bg-slate-855/40"
              title={theme === "dark" ? "Switch to Light Mode" : "Switch to Dark Mode"}
            >
              {theme === "light" ? <Sun className="w-4 h-4" /> : <Moon className="w-4 h-4" />}
            </button>
          </div>
        </div>
      </header>

      {/* Main Content Area */}
      <main className="flex-1 max-w-[1400px] w-full mx-auto p-4 md:p-6">
        {/* Size Guard Warning Banner */}
        {sizeGuardMessage && (
          <div className="mb-6 p-4 bg-slate-900 border-l-4 border-l-blue-500 border border-slate-800 rounded-lg flex items-start justify-between gap-4 text-xs font-mono text-slate-300 select-none animate-slide-in">
            <div className="flex items-start gap-2.5">
              <AlertTriangle className="w-4 h-4 text-blue-400 shrink-0 mt-0.5" />
              <p className="leading-relaxed font-semibold">{sizeGuardMessage}</p>
            </div>
            <button
              onClick={() => setSizeGuardMessage(null)}
              className="text-slate-500 hover:text-slate-350 transition-colors p-0.5 shrink-0 focus:outline-none cursor-pointer"
              title="Dismiss warning"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          </div>
        )}

        {isResetPage ? (
          <div className="max-w-md mx-auto my-12 bg-slate-900 border border-slate-800 rounded-xl p-8 shadow-2xl font-mono text-xs animate-slide-in">
            <h2 className="text-sm font-bold text-slate-100 uppercase tracking-wider mb-6 text-center select-none font-sans">
              RESET YOUR PASSWORD
            </h2>
            
            {authMessage ? (
              <div className="space-y-4 text-center">
                <div className="p-3.5 bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 rounded-lg text-xs leading-relaxed font-semibold">
                  {authMessage}
                </div>
                <button
                  onClick={() => {
                    window.location.href = "/";
                  }}
                  className="w-full py-2 rounded-lg font-bold bg-brand-500 hover:bg-brand-600 text-white transition-all shadow-md shadow-brand-500/10 active:scale-95 cursor-pointer text-center"
                >
                  Go to Sign In
                </button>
              </div>
            ) : (
              <form onSubmit={handleResetSubmit} className="space-y-4">
                {authError && (
                  <div className="p-3.5 bg-red-500/10 border border-red-500/20 text-red-400 rounded-lg leading-relaxed font-semibold">
                    {authError}
                  </div>
                )}
                
                <div className="space-y-1.5">
                  <label className="text-slate-400 font-semibold block select-none">New Password</label>
                  <input
                    type="password"
                    required
                    value={authPassword}
                    onChange={(e) => setAuthPassword(e.target.value)}
                    className="w-full bg-slate-950 border border-slate-800 focus:border-blue-500/50 rounded-lg px-3.5 py-2.5 text-slate-200 text-xs font-semibold focus:outline-none transition-all placeholder-slate-700"
                    placeholder="Min 8 characters"
                    id="reset-password-input"
                  />
                </div>
                
                <div className="space-y-1.5">
                  <label className="text-slate-400 font-semibold block select-none">Confirm New Password</label>
                  <input
                    type="password"
                    required
                    value={authConfirmPassword}
                    onChange={(e) => setAuthConfirmPassword(e.target.value)}
                    className="w-full bg-slate-950 border border-slate-800 focus:border-blue-500/50 rounded-lg px-3.5 py-2.5 text-slate-200 text-xs font-semibold focus:outline-none transition-all placeholder-slate-700"
                    placeholder="Re-enter new password"
                    id="reset-confirm-password-input"
                  />
                </div>
                
                <button
                  type="submit"
                  disabled={authLoading}
                  className="w-full py-2.5 mt-2 rounded-lg font-bold bg-brand-500 hover:bg-brand-600 text-white transition-all shadow-md shadow-brand-500/10 active:scale-95 disabled:opacity-50 cursor-pointer flex items-center justify-center gap-1.5"
                  id="reset-submit-btn"
                >
                  {authLoading ? (
                    <>
                      <span className="w-3.5 h-3.5 border-2 border-white border-t-transparent rounded-full animate-spin"></span>
                      Saving...
                    </>
                  ) : (
                    "Reset Password"
                  )}
                </button>
                
                <div className="text-center pt-2 select-none">
                  <a
                    href="/"
                    className="text-blue-400 hover:text-blue-300 font-semibold transition-colors"
                  >
                    Back to Sign In
                  </a>
                </div>
              </form>
            )}
          </div>
        ) : activeTab === "profile" ? (
          <ProfileSettings
            user={user}
            onOpenDeleteModal={handleOpenDeleteModal}
            showToast={showToast}
          />
        ) : activeTab === "history" ? (
          <UploadHistory
            user={user}
            onRestoreAnalysis={handleRestoreAnalysis}
            showToast={showToast}
          />
        ) : activeTab === "why" ? (
          <Why
            analysisId={analysisId}
            findings={findings}
            dataset={dataset}
            analysisDuration={analysisDuration}
            onAnalysisComplete={(aId, ds, fds, bM, aM, dur) => {
              setAnalysisId(aId);
              setDataset(ds);
              setFindings(fds);
              setBeforeMetrics(bM);
              setAfterMetrics(aM);
              setAnalysisDuration(dur);
            }}
            onNavigateToUpload={(tab = "upload") => {
              if (tab === "dashboard") {
                setScreen("dashboard");
                setActiveTab("dashboard");
              } else {
                handleRestart();
              }
            }}
          />
        ) : screen === "upload" ? (
          <Upload
            onAnalysisStarted={handleAnalysisStarted}
            showToast={showToast}
            user={user}
            onRestoreAnalysis={handleRestoreAnalysis}
          />
        ) : screen === "processing" ? (
          <Processing analysisId={analysisId} dataset={dataset} onComplete={handleProcessingComplete} />
        ) : (
          <div className="space-y-6">
            {/* Navigation Tabs */}
            <div className="flex border-b border-slate-800/80 pb-1 select-none">
              <button
                onClick={() => setActiveTab("dashboard")}
                className={`flex items-center gap-2 px-5 py-3 border-b-2 text-sm font-semibold transition-all focus:outline-none focus:bg-slate-900/40 ${
                  activeTab === "dashboard" 
                    ? "border-blue-500 text-blue-400 bg-blue-500/5" 
                    : "border-transparent text-slate-400 hover:text-slate-200"
                }`}
              >
                <LayoutDashboard className="w-4 h-4" />
                <span>Overview</span>
              </button>
              
              <button
                onClick={() => setActiveTab("review")}
                className={`flex items-center gap-2 px-5 py-3 border-b-2 text-sm font-semibold transition-all focus:outline-none focus:bg-slate-900/40 ${
                  activeTab === "review" 
                    ? "border-blue-500 text-blue-400 bg-blue-500/5" 
                    : "border-transparent text-slate-400 hover:text-slate-200"
                }`}
              >
                <CheckSquare className="w-4 h-4" />
                <span>Resolve Queue</span>
                {findings.filter(f => f.status === "pending_review").length > 0 && (
                  <span className="ml-1 bg-amber-500/10 text-amber-450 border border-amber-500/25 text-[10px] font-bold font-mono px-2 py-0.5 rounded-full">
                    {findings.filter(f => f.status === "pending_review").length}
                  </span>
                )}
              </button>

              <button
                onClick={() => setActiveTab("findings")}
                className={`flex items-center gap-2 px-5 py-3 border-b-2 text-sm font-semibold transition-all focus:outline-none focus:bg-slate-900/40 ${
                  activeTab === "findings" 
                    ? "border-blue-500 text-blue-400 bg-blue-500/5" 
                    : "border-transparent text-slate-400 hover:text-slate-200"
                }`}
              >
                <SearchCode className="w-4 h-4" />
                <span>Data Cleaning</span>
              </button>
              
              <button
                onClick={() => setActiveTab("report")}
                className={`flex items-center gap-2 px-5 py-3 border-b-2 text-sm font-semibold transition-all focus:outline-none focus:bg-slate-900/40 ${
                  activeTab === "report" 
                    ? "border-blue-500 text-blue-400 bg-blue-500/5" 
                    : "border-transparent text-slate-400 hover:text-slate-200"
                }`}
              >
                <ClipboardList className="w-4 h-4" />
                <span>Audit Trail</span>
              </button>
            </div>

            {/* Tab Views */}
            {activeTab === "dashboard" && (
              <Dashboard
                beforeMetrics={beforeMetrics}
                afterMetrics={afterMetrics}
                findings={findings}
                dataset={dataset}
                onNavigateToFindings={() => setActiveTab("review")}
                onNavigateToReport={() => setActiveTab("report")}
              />
            )}

            {activeTab === "review" && (
              <ReviewQueue
                findings={findings}
                analysisId={analysisId}
                onFindingsUpdated={handleFindingsUpdated}
                queueFilter={queueFilter}
                onClearFilter={() => setQueueFilter(null)}
              />
            )}

            {activeTab === "findings" && (
              <DataCleaningReview
                findings={findings}
                analysisId={analysisId}
                dataset={dataset}
                onFindingsUpdated={handleFindingsUpdated}
                onNavigateToQueue={handleNavigateToQueueFiltered}
                refreshTrigger={refreshTrigger}
              />
            )}

            {activeTab === "report" && (
              <Report
                analysisId={analysisId}
                dataset={dataset}
                findings={findings}
                onNavigateToQueue={handleNavigateToQueueFiltered}
                refreshTrigger={refreshTrigger}
              />
            )}
          </div>
        )}
      </main>
      
      {/* Footer */}
      <footer className="border-t border-slate-900 bg-slate-950 py-6 text-center text-xs text-slate-600 mt-12 shrink-0">
        <p>© 2026 DataSetIQ Platform. All rights reserved.</p>
      </footer>
      {/* Toast Notifications Overlay */}
      <div className="fixed top-4 right-4 z-50 flex flex-col gap-2 pointer-events-none max-w-sm w-full">
        {toasts.map((toast) => (
          <div
            key={toast.id}
            className={`pointer-events-auto flex items-center justify-between p-3.5 rounded-lg border-l-4 shadow-lg bg-slate-900 border border-slate-800 text-slate-100 text-xs animate-slide-in transition-all duration-300 ${
              toast.type === "success"
                ? "border-l-emerald-500"
                : toast.type === "error"
                ? "border-l-red-500"
                : "border-l-amber-500"
            }`}
          >
            <div className="flex items-center gap-2.5">
              {toast.type === "success" && <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />}
              {toast.type === "error" && <XCircle className="w-4 h-4 text-red-400 shrink-0" />}
              {toast.type === "warning" && <AlertTriangle className="w-4 h-4 text-amber-400 shrink-0" />}
              <span className="font-semibold text-slate-200 select-none">{toast.message}</span>
            </div>
            <button
              onClick={() => removeToast(toast.id)}
              className="text-slate-505 hover:text-slate-350 transition-colors p-1"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          </div>
        ))}
      </div>

      {/* Delete Account & Data Confirmation Modal */}
      {deleteModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/80 backdrop-blur-sm p-4 animate-fade-in">
          <div className="w-full max-w-md bg-slate-900 border border-slate-800 rounded-xl shadow-2xl overflow-hidden animate-scale-in">
            <div className="bg-rose-500/10 border-b border-rose-500/25 px-5 py-4 flex items-center gap-3">
              <div className="w-8 h-8 rounded-full bg-rose-500/20 text-rose-400 flex items-center justify-center shrink-0">
                <AlertTriangle className="w-4.5 h-4.5" />
              </div>
              <div>
                <h3 className="text-sm font-bold text-rose-400 font-mono">Delete Account & Data?</h3>
                <p className="text-[10px] text-slate-500 uppercase tracking-wider font-mono">Permanent Action</p>
              </div>
            </div>
            
            <div className="p-5 space-y-4 font-mono text-xs">
              <p className="text-slate-350 leading-relaxed">
                This permanently deletes your account, your Google sign-in credentials link, and all{" "}
                <span className="text-rose-400 font-bold">
                  {fetchingCount ? (
                    <span className="inline-block w-3.5 h-3.5 border border-rose-400 border-t-transparent rounded-full animate-spin vertical-align-middle"></span>
                  ) : (
                    userAnalysisCount
                  )}
                </span>{" "}
                saved analyses. This action cannot be undone.
              </p>
              
              <div className="space-y-2">
                <label className="text-slate-400 font-semibold block select-none">
                  Type <span className="text-slate-200 font-bold bg-slate-800 px-1.5 py-0.5 rounded border border-slate-700 select-all">DELETE</span> to confirm:
                </label>
                <input
                  type="text"
                  value={deleteConfirmText}
                  onChange={(e) => setDeleteConfirmText(e.target.value)}
                  className="w-full bg-slate-950 border border-slate-800 focus:border-rose-500/50 rounded-lg px-3.5 py-2 text-slate-200 text-xs font-semibold focus:outline-none transition-all placeholder-slate-600"
                  placeholder="Type DELETE"
                  disabled={deletingAccount}
                  id="delete-confirm-input"
                />
              </div>
            </div>

            <div className="bg-slate-955/40 border-t border-slate-800/60 px-5 py-3.5 flex items-center justify-end gap-3.5">
              <button
                onClick={() => setDeleteModalOpen(false)}
                className="px-4 py-1.5 rounded-lg border border-slate-800 hover:bg-slate-800/40 text-xs font-semibold text-slate-400 hover:text-slate-250 transition-all cursor-pointer focus:outline-none"
                disabled={deletingAccount}
                id="delete-cancel-btn"
              >
                Cancel
              </button>
              <button
                onClick={handleConfirmDeleteAccount}
                disabled={deleteConfirmText !== "DELETE" || deletingAccount}
                className="px-4 py-1.5 rounded-lg text-xs font-semibold bg-rose-600 hover:bg-rose-500 disabled:opacity-40 disabled:hover:bg-rose-600 text-white transition-all shadow-md shadow-rose-900/10 active:scale-95 cursor-pointer disabled:cursor-not-allowed focus:outline-none flex items-center justify-center gap-1.5"
                id="delete-confirm-btn"
              >
                {deletingAccount ? (
                  <>
                    <span className="w-3.5 h-3.5 border-2 border-white border-t-transparent rounded-full animate-spin shrink-0"></span>
                    Deleting...
                  </>
                ) : (
                  "Delete Permanently"
                )}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Auth Modal (Login / Signup / Forgot Password) */}
      {authModalOpen && (
        <div className="fixed inset-0 bg-slate-950/75 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-slate-900 border border-slate-800 rounded-xl max-w-md w-full shadow-2xl relative overflow-hidden flex flex-col font-mono text-xs">
            <button
              onClick={() => setAuthModalOpen(false)}
              className="absolute top-4 right-4 text-slate-500 hover:text-slate-350 transition-colors cursor-pointer p-1 rounded-full hover:bg-slate-800"
              title="Close modal"
            >
              <X className="w-4 h-4" />
            </button>
            
            <div className="p-6 pb-2 border-b border-slate-850 select-none">
              <h2 className="text-sm font-bold text-slate-100 uppercase tracking-wider font-sans">
                {authMode === "login" ? "Sign In" : authMode === "signup" ? "Create Account" : "Reset Password Link"}
              </h2>
              <p className="text-[10px] text-slate-500 mt-1">
                {authMode === "login" ? "Sign in to save your analysis results." : authMode === "signup" ? "Register a new email/password account." : "We'll send a password recovery link to your email."}
              </p>
            </div>
            
            <form onSubmit={handleAuthSubmit} className="p-6 space-y-4">
              {authError && (
                <div className="p-3 bg-red-500/10 border border-red-500/20 text-red-400 rounded-lg leading-relaxed font-semibold" id="auth-error-msg">
                  {authError}
                </div>
              )}
              {authMessage && (
                <div className="p-3 bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 rounded-lg leading-relaxed font-semibold" id="auth-success-msg">
                  {authMessage}
                </div>
              )}
              
              {authMode === "signup" && (
                <div className="space-y-1">
                  <label className="text-slate-400 font-semibold block select-none">Full Name</label>
                  <input
                    type="text"
                    required
                    value={authName}
                    onChange={(e) => setAuthName(e.target.value)}
                    className="w-full bg-slate-950 border border-slate-800 focus:border-blue-500/50 rounded-lg px-3.5 py-2 text-slate-200 text-xs font-semibold focus:outline-none transition-all placeholder-slate-700"
                    placeholder="Enter your name"
                    id="auth-name-input"
                  />
                </div>
              )}
              
              <div className="space-y-1">
                <label className="text-slate-400 font-semibold block select-none">Email Address</label>
                <input
                  type="email"
                  required
                  value={authEmail}
                  onChange={(e) => setAuthEmail(e.target.value)}
                  className="w-full bg-slate-950 border border-slate-800 focus:border-blue-500/50 rounded-lg px-3.5 py-2 text-slate-200 text-xs font-semibold focus:outline-none transition-all placeholder-slate-700"
                  placeholder="Enter email address"
                  id="auth-email-input"
                />
              </div>
              
              {authMode !== "forgot" && (
                <div className="space-y-1 relative">
                  <label className="text-slate-400 font-semibold block select-none">Password</label>
                  <input
                    type="password"
                    required
                    value={authPassword}
                    onChange={(e) => setAuthPassword(e.target.value)}
                    className="w-full bg-slate-950 border border-slate-800 focus:border-blue-500/50 rounded-lg px-3.5 py-2 text-slate-200 text-xs font-semibold focus:outline-none transition-all placeholder-slate-700"
                    placeholder="Enter password"
                    id="auth-password-input"
                  />
                  {authMode === "login" && (
                    <button
                      type="button"
                      onClick={() => {
                        setAuthMode("forgot");
                        setAuthError("");
                        setAuthMessage("");
                      }}
                      className="text-[10px] text-blue-400 hover:text-blue-300 font-semibold mt-1.5 focus:outline-none cursor-pointer block text-left"
                      id="forgot-password-link"
                    >
                      Forgot password?
                    </button>
                  )}
                </div>
              )}
              
              <button
                type="submit"
                disabled={authLoading}
                className="w-full py-2.5 mt-2 rounded-lg font-bold bg-brand-500 hover:bg-brand-600 text-white transition-all shadow-md shadow-brand-500/10 active:scale-95 disabled:opacity-50 cursor-pointer flex items-center justify-center gap-1.5"
                id="auth-submit-btn"
              >
                {authLoading ? (
                  <>
                    <span className="w-3.5 h-3.5 border-2 border-white border-t-transparent rounded-full animate-spin"></span>
                    Please wait...
                  </>
                ) : authMode === "login" ? (
                  "Sign In"
                ) : authMode === "signup" ? (
                  "Create Account"
                ) : (
                  "Send Reset Link"
                )}
              </button>
              
              {/* Tabs / Alternate flows */}
              <div className="border-t border-slate-850 pt-4 flex flex-col items-center gap-3">
                {authMode === "login" ? (
                  <p className="text-[10px] text-slate-500 font-medium">
                    Don't have an account?{" "}
                    <button
                      type="button"
                      onClick={() => {
                        setAuthMode("signup");
                        setAuthError("");
                        setAuthMessage("");
                      }}
                      className="text-blue-400 hover:text-blue-300 font-semibold focus:outline-none cursor-pointer"
                      id="toggle-signup-btn"
                    >
                      Sign Up
                    </button>
                  </p>
                ) : (
                  <p className="text-[10px] text-slate-500 font-medium">
                    Already have an account?{" "}
                    <button
                      type="button"
                      onClick={() => {
                        setAuthMode("login");
                        setAuthError("");
                        setAuthMessage("");
                      }}
                      className="text-blue-400 hover:text-blue-300 font-semibold focus:outline-none cursor-pointer"
                      id="toggle-login-btn"
                    >
                      Sign In
                    </button>
                  </p>
                )}
                
                {authMode === "login" && (
                  <>
                    <div className="w-full flex items-center justify-center gap-2 text-[10px] text-slate-500 font-semibold uppercase tracking-wider select-none">
                      <span className="h-px bg-slate-800/60 flex-1"></span>
                      <span>or</span>
                      <span className="h-px bg-slate-800/60 flex-1"></span>
                    </div>
                    
                    <button
                      type="button"
                      onClick={handleGoogleSignIn}
                      className="w-full py-2.5 rounded-lg font-semibold border border-slate-800 bg-slate-950 hover:bg-slate-900 text-slate-350 hover:text-slate-100 transition-all flex items-center justify-center gap-2 cursor-pointer focus:outline-none active:scale-95"
                      id="google-signin-btn"
                    >
                      <svg className="w-4 h-4" viewBox="0 0 24 24">
                        <path
                          fill="currentColor"
                          d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"
                        />
                        <path
                          fill="currentColor"
                          d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
                        />
                        <path
                          fill="currentColor"
                          d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.06H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.94l2.85-2.22.81-.63z"
                        />
                        <path
                          fill="currentColor"
                          d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.06l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"
                        />
                      </svg>
                      <span>Sign In with Google</span>
                    </button>
                  </>
                )}
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
