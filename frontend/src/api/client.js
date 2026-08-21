export const API_BASE_URL = "http://localhost:8000";

export async function fetchHealth() {
  const res = await fetch(`${API_BASE_URL}/api/health`, { credentials: "include" });
  if (!res.ok) throw new Error("Backend health check failed");
  return res.json();
}

export async function uploadDataset(file) {
  const formData = new FormData();
  formData.append("file", file);

  const res = await fetch(`${API_BASE_URL}/api/datasets`, {
    method: "POST",
    body: formData,
    credentials: "include",
  });
  
  if (!res.ok) {
    const err = await res.json();
    throw new Error(err.detail || "Upload failed");
  }
  return res.json();
}

export async function fetchProfile(datasetId) {
  const res = await fetch(`${API_BASE_URL}/api/datasets/${datasetId}/profile`, { credentials: "include" });
  if (!res.ok) throw new Error("Failed to fetch column profiles");
  return res.json();
}

export async function startAnalysis(datasetId) {
  const res = await fetch(`${API_BASE_URL}/api/datasets/${datasetId}/analyses`, {
    method: "POST",
    credentials: "include",
  });
  if (!res.ok) throw new Error("Failed to trigger pipeline analysis");
  return res.json();
}

export async function fetchAnalysisStatus(analysisId) {
  const res = await fetch(`${API_BASE_URL}/api/analyses/${analysisId}`, { credentials: "include" });
  if (!res.ok) throw new Error("Failed to poll analysis status");
  return res.json();
}

export async function fetchFindings(analysisId) {
  const res = await fetch(`${API_BASE_URL}/api/analyses/${analysisId}/findings`, { credentials: "include" });
  if (!res.ok) throw new Error("Failed to fetch findings");
  return res.json();
}

export async function approveFinding(analysisId, findingId, action = null) {
  let payload = {};
  if (action) {
    if (typeof action === "object") {
      payload = action;
    } else {
      payload = { action };
    }
  }
  const res = await fetch(`${API_BASE_URL}/api/analyses/${analysisId}/findings/${findingId}/apply`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
    credentials: "include",
  });
  if (!res.ok) throw new Error("Failed to approve finding fix");
  return res.json();
}

export async function rejectFinding(analysisId, findingId) {
  const res = await fetch(`${API_BASE_URL}/api/analyses/${analysisId}/findings/${findingId}/reject`, {
    method: "POST",
    credentials: "include",
  });
  if (!res.ok) throw new Error("Failed to reject finding fix");
  return res.json();
}

export async function revertFinding(analysisId, findingId) {
  const res = await fetch(`${API_BASE_URL}/api/analyses/${analysisId}/findings/${findingId}/revert`, {
    method: "POST",
    credentials: "include",
  });
  if (!res.ok) throw new Error("Failed to revert finding fix");
  return res.json();
}

export async function fetchBeforeAfter(analysisId) {
  const res = await fetch(`${API_BASE_URL}/api/analyses/${analysisId}/before-after`, { credentials: "include" });
  if (!res.ok) throw new Error("Failed to load before/after comparison metrics");
  return res.json();
}

export async function fetchReport(analysisId) {
  const res = await fetch(`${API_BASE_URL}/api/analyses/${analysisId}/report`, { credentials: "include" });
  if (!res.ok) throw new Error("Failed to load audit trail report");
  return res.json();
}

export function getDownloadUrl(analysisId) {
  return `${API_BASE_URL}/api/analyses/${analysisId}/download`;
}

export async function loadSampleDataset() {
  const res = await fetch(`${API_BASE_URL}/api/datasets/sample`, {
    method: "POST",
    credentials: "include",
  });
  if (!res.ok) throw new Error("Failed to load sample dataset");
  return res.json();
}

export async function fetchDatasetPreview(datasetId) {
  const res = await fetch(`${API_BASE_URL}/api/datasets/${datasetId}/preview`, { credentials: "include" });
  if (!res.ok) throw new Error("Failed to fetch dataset preview");
  return res.json();
}

// Authentication endpoints
export async function fetchCurrentUser() {
  const res = await fetch(`${API_BASE_URL}/api/auth/me`, { credentials: "include" });
  if (res.status === 401) return null;
  if (!res.ok) throw new Error("Authentication check failed");
  return res.json();
}

export async function logout() {
  const res = await fetch(`${API_BASE_URL}/api/auth/logout`, {
    method: "POST",
    credentials: "include",
  });
  if (!res.ok) throw new Error("Logout failed");
  return res.json();
}

// Recent Uploads / Persistence endpoints
export async function fetchRecentAnalyses() {
  const res = await fetch(`${API_BASE_URL}/api/analyses`, { credentials: "include" });
  if (res.status === 401) return [];
  if (!res.ok) throw new Error("Failed to fetch historical analyses");
  return res.json();
}

export async function deleteAnalysis(analysisId) {
  const res = await fetch(`${API_BASE_URL}/api/analyses/${analysisId}`, {
    method: "DELETE",
    credentials: "include",
  });
  if (!res.ok) throw new Error("Failed to delete analysis");
  return res.json();
}

export async function claimAnalysis(analysisId) {
  const res = await fetch(`${API_BASE_URL}/api/analyses/${analysisId}/claim`, {
    method: "POST",
    credentials: "include",
  });
  if (!res.ok) throw new Error("Failed to claim analysis");
  return res.json();
}

export async function deleteUserAccount() {
  const res = await fetch(`${API_BASE_URL}/api/users/me`, {
    method: "DELETE",
    credentials: "include",
  });
  if (!res.ok) throw new Error("Failed to delete account");
  return res.json();
}

export async function fetchUserSettings() {
  const res = await fetch(`${API_BASE_URL}/api/users/me/settings`, { credentials: "include" });
  if (!res.ok) throw new Error("Failed to fetch user settings");
  return res.json();
}

export async function updateUserSettings(payload) {
  const res = await fetch(`${API_BASE_URL}/api/users/me/settings`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
    credentials: "include",
  });
  if (!res.ok) {
    const err = await res.json();
    throw new Error(err.detail || "Failed to update settings");
  }
  return res.json();
}

// Email/Password authentication and Forgot/Reset password flows
export async function signup(email, password, name) {
  const res = await fetch(`${API_BASE_URL}/api/auth/signup`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password, name }),
    credentials: "include",
  });
  if (!res.ok) {
    const err = await res.json();
    throw new Error(err.detail || "Signup failed");
  }
  return res.json();
}

export async function login(email, password) {
  const res = await fetch(`${API_BASE_URL}/api/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password }),
    credentials: "include",
  });
  if (!res.ok) {
    const err = await res.json();
    throw new Error(err.detail || "Login failed");
  }
  return res.json();
}

export async function forgotPassword(email) {
  const res = await fetch(`${API_BASE_URL}/api/auth/forgot-password`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email }),
    credentials: "include",
  });
  if (!res.ok) {
    const err = await res.json();
    throw new Error(err.detail || "Forgot password request failed");
  }
  return res.json();
}

export async function resetPassword(token, newPassword) {
  const res = await fetch(`${API_BASE_URL}/api/auth/reset-password`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ token, new_password: newPassword }),
    credentials: "include",
  });
  if (!res.ok) {
    const err = await res.json();
    throw new Error(err.detail || "Password reset failed");
  }
  return res.json();
}
