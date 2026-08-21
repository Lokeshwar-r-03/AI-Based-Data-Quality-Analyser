import React, { useState, useEffect } from "react";
import { fetchUserSettings, updateUserSettings } from "../api/client";
import {
  AlertTriangle,
  Settings,
  User,
  Sliders,
  Shield,
  Mail,
  KeyRound,
  CalendarDays,
  CheckCircle2,
  LogIn,
} from "lucide-react";

export default function ProfileSettings({ user, onOpenDeleteModal, showToast }) {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [settings, setSettings] = useState(null);
  const [autoThreshold, setAutoThreshold] = useState(0.85);
  const [reviewThreshold, setReviewThreshold] = useState(0.40);
  const [dirty, setDirty] = useState(false);
  const [savedFlash, setSavedFlash] = useState(false);

  useEffect(() => {
    loadSettings();
  }, [user]);

  const loadSettings = async () => {
    if (!user) { setLoading(false); return; }
    setLoading(true);
    try {
      const data = await fetchUserSettings();
      setSettings(data);
      setAutoThreshold(data.auto_threshold ?? 0.85);
      setReviewThreshold(data.review_threshold ?? 0.40);
    } catch (err) {
      console.error("Failed to load settings:", err);
      showToast("Failed to load settings", "error");
    } finally {
      setLoading(false);
    }
  };

  const handleAutoChange = (val) => {
    const num = parseFloat(val);
    setAutoThreshold(num);
    setDirty(true);
    if (reviewThreshold >= num) {
      setReviewThreshold(Math.max(0.10, num - 0.05));
    }
  };

  const handleReviewChange = (val) => {
    const num = parseFloat(val);
    if (num < autoThreshold) {
      setReviewThreshold(num);
      setDirty(true);
    }
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      await updateUserSettings({
        auto_threshold: autoThreshold,
        review_threshold: reviewThreshold,
      });
      setDirty(false);
      setSavedFlash(true);
      setTimeout(() => setSavedFlash(false), 2500);
      showToast("Settings saved. Changes take effect on your next analysis.", "success");
    } catch (err) {
      showToast(err.message || "Failed to save settings", "error");
    } finally {
      setSaving(false);
    }
  };

  if (!user) {
    return (
      <div className="flex flex-col items-center justify-center py-24 gap-5 text-center">
        <div className="w-16 h-16 bg-slate-800/60 rounded-2xl flex items-center justify-center">
          <LogIn className="w-7 h-7 text-slate-500" />
        </div>
        <div>
          <h2 className="text-base font-bold text-slate-200 font-mono">Sign In Required</h2>
          <p className="text-slate-500 text-xs mt-1.5 font-mono">
            Profile settings are only available when you are signed in.
          </p>
        </div>
      </div>
    );
  }

  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center py-24 gap-4">
        <div className="w-7 h-7 border-2 border-brand-500 border-t-transparent rounded-full animate-spin" />
        <p className="text-slate-500 text-xs font-mono">Loading settings...</p>
      </div>
    );
  }

  const authMethod = settings?.auth_method || "email";

  return (
    <div className="max-w-3xl mx-auto py-6 px-4 space-y-6">
      {/* Page Header */}
      <div className="flex items-center gap-3">
        <div className="w-10 h-10 bg-brand-500/10 border border-brand-500/20 rounded-xl flex items-center justify-center text-brand-400">
          <Settings className="w-5 h-5" />
        </div>
        <div>
          <h1 className="text-base font-bold text-slate-100 font-mono tracking-tight">Profile Settings</h1>
          <p className="text-slate-500 text-[10px] font-mono uppercase tracking-wider">Preferences & Account</p>
        </div>
      </div>

      {/* Account Info Card */}
      <div className="bg-slate-900 border border-slate-800 rounded-xl overflow-hidden shadow-md">
        <div className="bg-slate-800/30 border-b border-slate-800 px-5 py-3 flex items-center gap-2">
          <User className="w-3.5 h-3.5 text-slate-500" />
          <h2 className="text-[10px] text-slate-400 uppercase tracking-wider font-bold font-mono">Account Info</h2>
        </div>
        <div className="px-5 py-5 grid grid-cols-1 sm:grid-cols-2 gap-4">
          {/* Avatar + Name */}
          <div className="sm:col-span-2 flex items-center gap-4 pb-4 border-b border-slate-800/60">
            <div className="w-14 h-14 rounded-2xl bg-brand-500/20 border border-brand-500/30 flex items-center justify-center text-brand-400 font-extrabold text-xl uppercase shrink-0">
              {user?.name ? user.name.charAt(0) : "U"}
            </div>
            <div>
              <p className="text-sm font-bold text-slate-100 font-mono">{user?.name || "—"}</p>
              <p className="text-xs text-slate-400 font-mono mt-0.5">{user?.email || "—"}</p>
              <span className="inline-flex items-center gap-1 mt-1 px-2 py-0.5 rounded-full text-[9.5px] font-bold font-mono uppercase tracking-wider bg-emerald-500/10 border border-emerald-500/20 text-emerald-400">
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 inline-block" />
                Active
              </span>
            </div>
          </div>

          {/* Email */}
          <div>
            <label className="text-[10px] text-slate-500 uppercase font-mono font-semibold flex items-center gap-1.5 mb-1.5">
              <Mail className="w-3 h-3" /> Email
            </label>
            <p className="text-xs text-slate-200 font-mono bg-slate-950/60 rounded-lg px-3 py-2 border border-slate-800/60">
              {settings?.email || user?.email || "—"}
            </p>
          </div>

          {/* Sign-In Method */}
          <div>
            <label className="text-[10px] text-slate-500 uppercase font-mono font-semibold flex items-center gap-1.5 mb-1.5">
              <KeyRound className="w-3 h-3" /> Sign-in Method
            </label>
            <div className="text-xs text-slate-200 font-mono bg-slate-950/60 rounded-lg px-3 py-2 border border-slate-800/60 flex items-center gap-2">
              {authMethod === "google" ? (
                <>
                  <svg className="w-3.5 h-3.5 shrink-0" viewBox="0 0 24 24">
                    <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 0 1-2.2 3.32v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.1z" />
                    <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" />
                    <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" />
                    <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" />
                  </svg>
                  Google OAuth
                </>
              ) : (
                <>
                  <KeyRound className="w-3 h-3 text-slate-500" />
                  Email & Password
                </>
              )}
            </div>
          </div>

          {/* Account Created */}
          <div className="sm:col-span-2">
            <label className="text-[10px] text-slate-500 uppercase font-mono font-semibold flex items-center gap-1.5 mb-1.5">
              <CalendarDays className="w-3 h-3" /> Account Created
            </label>
            <p className="text-xs text-slate-200 font-mono bg-slate-950/60 rounded-lg px-3 py-2 border border-slate-800/60">
              {settings?.created_at
                ? new Date(settings.created_at).toLocaleDateString("en-US", {
                    year: "numeric", month: "long", day: "numeric",
                    hour: "2-digit", minute: "2-digit"
                  })
                : "—"}
            </p>
          </div>
        </div>
      </div>

      {/* Analysis Preferences Card */}
      <div className="bg-slate-900 border border-slate-800 rounded-xl overflow-hidden shadow-md">
        <div className="bg-slate-800/30 border-b border-slate-800 px-5 py-3 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Sliders className="w-3.5 h-3.5 text-slate-500" />
            <h2 className="text-[10px] text-slate-400 uppercase tracking-wider font-bold font-mono">Analysis Preferences</h2>
          </div>
          {savedFlash && (
            <span className="flex items-center gap-1 text-[10px] text-emerald-400 font-mono font-semibold animate-pulse">
              <CheckCircle2 className="w-3 h-3" /> Saved
            </span>
          )}
        </div>

        <div className="px-5 py-5 space-y-6">
          <p className="text-[11px] text-slate-400 leading-relaxed">
            These thresholds control how the pipeline categorizes findings. Changes take effect on your{" "}
            <span className="text-slate-200 font-semibold">next analysis run</span>.
          </p>

          {/* Auto-Fix Threshold */}
          <div>
            <div className="flex items-center justify-between mb-2">
              <label className="text-[10px] text-slate-400 uppercase font-mono font-semibold flex items-center gap-1.5">
                <Shield className="w-3 h-3 text-emerald-400" />
                Auto-Fix Threshold
              </label>
              <span className="text-xs font-bold text-emerald-400 font-mono bg-emerald-500/10 px-2 py-0.5 rounded-md border border-emerald-500/20">
                {autoThreshold.toFixed(2)}
              </span>
            </div>
            <input
              type="range"
              min="0.50"
              max="1.00"
              step="0.01"
              value={autoThreshold}
              onChange={(e) => handleAutoChange(e.target.value)}
              className="w-full h-1.5 bg-slate-800 rounded-full appearance-none cursor-pointer accent-emerald-500"
              id="auto-threshold-slider"
            />
            <div className="flex justify-between mt-1">
              <span className="text-[9px] text-slate-600 font-mono">0.50</span>
              <span className="text-[9px] text-slate-600 font-mono">1.00</span>
            </div>
            <p className="text-[10px] text-slate-500 mt-1.5 leading-relaxed">
              Issues with confidence{" "}
              <span className="text-emerald-400 font-semibold">≥ {autoThreshold.toFixed(2)}</span>{" "}
              are automatically fixed. Lower this to auto-fix more issues.
            </p>
          </div>

          {/* Review Queue Threshold */}
          <div>
            <div className="flex items-center justify-between mb-2">
              <label className="text-[10px] text-slate-400 uppercase font-mono font-semibold flex items-center gap-1.5">
                <Shield className="w-3 h-3 text-amber-400" />
                Review Queue Threshold
              </label>
              <span className="text-xs font-bold text-amber-400 font-mono bg-amber-500/10 px-2 py-0.5 rounded-md border border-amber-500/20">
                {reviewThreshold.toFixed(2)}
              </span>
            </div>
            <input
              type="range"
              min="0.10"
              max={Math.max(0.10, autoThreshold - 0.01).toFixed(2)}
              step="0.01"
              value={reviewThreshold}
              onChange={(e) => handleReviewChange(e.target.value)}
              className="w-full h-1.5 bg-slate-800 rounded-full appearance-none cursor-pointer accent-amber-500"
              id="review-threshold-slider"
            />
            <div className="flex justify-between mt-1">
              <span className="text-[9px] text-slate-600 font-mono">0.10</span>
              <span className="text-[9px] text-slate-600 font-mono">{Math.max(0.10, autoThreshold - 0.01).toFixed(2)}</span>
            </div>
            <p className="text-[10px] text-slate-500 mt-1.5 leading-relaxed">
              Issues between{" "}
              <span className="text-amber-400 font-semibold">{reviewThreshold.toFixed(2)}</span>{" "}
              and{" "}
              <span className="text-emerald-400 font-semibold">{autoThreshold.toFixed(2)}</span>{" "}
              go to the Resolve Queue. Below this, issues are ignored.
            </p>
          </div>

          {/* Confidence Scale Visualization */}
          <div className="bg-slate-950/60 rounded-lg p-3.5 border border-slate-800/60">
            <p className="text-[9px] text-slate-500 uppercase font-mono font-semibold mb-2.5 tracking-wider">
              Confidence Scale Preview
            </p>
            <div className="relative h-5 w-full rounded-full overflow-hidden bg-slate-800">
              <div
                className="absolute left-0 top-0 h-full bg-slate-700/60 rounded-l-full transition-all duration-200"
                style={{ width: `${reviewThreshold * 100}%` }}
              />
              <div
                className="absolute top-0 h-full bg-amber-500/30 transition-all duration-200"
                style={{ left: `${reviewThreshold * 100}%`, width: `${(autoThreshold - reviewThreshold) * 100}%` }}
              />
              <div
                className="absolute top-0 h-full bg-emerald-500/30 rounded-r-full transition-all duration-200"
                style={{ left: `${autoThreshold * 100}%`, width: `${(1 - autoThreshold) * 100}%` }}
              />
            </div>
            <div className="flex justify-between mt-1.5 text-[9px] font-mono">
              <span className="text-slate-600">Ignored</span>
              <span className="text-amber-500">Review Queue</span>
              <span className="text-emerald-500">Auto-Fix</span>
            </div>
          </div>

          {/* Save Button */}
          <div className="flex justify-end pt-1">
            <button
              onClick={handleSave}
              disabled={!dirty || saving}
              className="px-5 py-2 rounded-lg text-xs font-semibold bg-brand-500 hover:bg-brand-400 disabled:opacity-40 disabled:hover:bg-brand-500 text-white transition-all shadow-md shadow-brand-500/10 active:scale-95 cursor-pointer disabled:cursor-not-allowed focus:outline-none flex items-center gap-1.5"
              id="save-settings-btn"
            >
              {saving ? (
                <>
                  <span className="w-3.5 h-3.5 border-2 border-white border-t-transparent rounded-full animate-spin shrink-0" />
                  Saving...
                </>
              ) : savedFlash ? (
                <>
                  <CheckCircle2 className="w-3.5 h-3.5" />
                  Saved!
                </>
              ) : (
                "Save Preferences"
              )}
            </button>
          </div>
        </div>
      </div>

      {/* Danger Zone Card */}
      <div className="bg-slate-900 border border-rose-500/30 rounded-xl overflow-hidden shadow-md">
        <div className="bg-rose-500/5 border-b border-rose-500/20 px-5 py-3 flex items-center gap-2">
          <AlertTriangle className="w-3.5 h-3.5 text-rose-400" />
          <h2 className="text-[10px] text-rose-400 uppercase tracking-wider font-bold font-mono">Danger Zone</h2>
        </div>
        <div className="px-5 py-4 flex items-center justify-between gap-4">
          <div>
            <p className="text-xs text-slate-200 font-semibold">Delete Account & All Data</p>
            <p className="text-[10px] text-slate-500 mt-0.5">
              Permanently remove your account, credentials, and all saved analyses. This cannot be undone.
            </p>
          </div>
          <button
            onClick={onOpenDeleteModal}
            className="px-3.5 py-2 rounded-lg text-xs font-semibold border border-rose-500/40 text-rose-400 hover:bg-rose-500/10 hover:border-rose-500/60 transition-all cursor-pointer shrink-0 focus:outline-none whitespace-nowrap"
            id="danger-zone-delete-btn"
          >
            Delete Account...
          </button>
        </div>
      </div>
    </div>
  );
}
