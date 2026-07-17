import { createClient } from "@supabase/supabase-js";

const state = {
  supabase: null,
  session: null,
  account: null,
  latestData: null,
  history: [],
  adminOverview: null,
  authMode: "signup",
  activeView: "analyzer",
  loadingAccount: false,
};

const $ = (selector, root = document) => root.querySelector(selector);
const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];

function escapeHtml(value = "") {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function formatNumber(value) {
  return Number.isFinite(Number(value)) ? Number(value).toLocaleString() : "Not measured";
}

function initials(nameOrEmail = "User") {
  const clean = String(nameOrEmail).trim();
  if (!clean) return "U";
  const words = clean.split(/\s+/).filter(Boolean);
  if (words.length > 1) return `${words[0][0]}${words[1][0]}`.toUpperCase();
  return clean.slice(0, 2).toUpperCase();
}

function formatDate(value, includeTime = false) {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  return new Intl.DateTimeFormat("en-PK", {
    timeZone: "Asia/Karachi",
    day: "2-digit",
    month: "short",
    year: "numeric",
    ...(includeTime ? { hour: "2-digit", minute: "2-digit" } : {}),
  }).format(date);
}

function todayLabel() {
  return new Intl.DateTimeFormat("en-PK", {
    timeZone: "Asia/Karachi",
    weekday: "short",
    day: "2-digit",
    month: "long",
    year: "numeric",
  }).format(new Date());
}

function toast(message, type = "info", title = "") {
  const region = $("#toast-region");
  const node = document.createElement("div");
  node.className = `toast ${type}`;
  node.innerHTML = `<div><strong>${escapeHtml(title || (type === "error" ? "Something went wrong" : type === "success" ? "Success" : "Notice"))}</strong><p>${escapeHtml(message)}</p></div>`;
  region.appendChild(node);
  window.setTimeout(() => node.remove(), 5200);
}

function setBootVisible(visible) {
  $("#boot-screen").classList.toggle("hidden", !visible);
}

function showPublicApp() {
  $("#public-app").classList.remove("hidden");
  $("#dashboard-app").classList.add("hidden");
  setBootVisible(false);
}

function showDashboardApp() {
  $("#public-app").classList.add("hidden");
  $("#dashboard-app").classList.remove("hidden");
  setBootVisible(false);
}

function setStatus(message = "", type = "") {
  const box = $("#status");
  box.textContent = message;
  box.className = `status${type ? ` ${type}` : ""}`;
}

function setAuthStatus(message = "", type = "") {
  const box = $("#auth-status");
  box.textContent = message;
  box.className = `auth-status${type ? ` ${type}` : ""}`;
}

function setAuthLoading(loading) {
  const button = $("#auth-submit");
  button.disabled = loading;
  button.classList.toggle("loading", loading);
}

function setAnalyzeLoading(loading) {
  const button = $("#submit-button");
  button.disabled = loading;
  button.classList.toggle("loading", loading);
  $(".button-label", button).textContent = loading ? "Analyzing live results…" : "Analyze keyword";
}

function openAuth(mode = "signup") {
  setAuthMode(mode);
  $("#auth-modal").classList.remove("hidden");
  document.body.style.overflow = "hidden";
  window.setTimeout(() => {
    const target = mode === "signup" ? $("#auth-name") : mode === "reset" ? $("#auth-password") : $("#auth-email");
    target?.focus();
  }, 50);
}

function closeAuth() {
  $("#auth-modal").classList.add("hidden");
  document.body.style.overflow = "";
  setAuthStatus();
}

function setAuthMode(mode) {
  state.authMode = mode;
  const nameField = $("#auth-name-field");
  const emailField = $("#auth-email-field");
  const nameInput = $("#auth-name");
  const passwordInput = $("#auth-password");
  const forgot = $("#forgot-password");
  const switchRow = $("#auth-switch-row");
  const switchButton = $("#auth-switch");

  nameInput.required = mode === "signup";
  passwordInput.autocomplete = mode === "login" ? "current-password" : "new-password";
  nameField.classList.toggle("hidden", mode !== "signup");
  emailField.classList.toggle("hidden", mode === "reset");
  forgot.classList.toggle("hidden", mode !== "login");
  switchRow.classList.toggle("hidden", mode === "reset");
  setAuthStatus();

  if (mode === "signup") {
    $("#auth-kicker").textContent = "CREATE YOUR ACCOUNT";
    $("#auth-title").textContent = "Start analyzing keywords";
    $("#auth-description").textContent = "Sign up with your email to receive 20 keyword analyses per day.";
    $("#auth-password-label").textContent = "Password";
    passwordInput.placeholder = "At least 8 characters";
    $("#auth-submit span").textContent = "Create account";
    switchRow.firstChild.textContent = "Already have an account? ";
    switchButton.textContent = "Log in";
  } else if (mode === "login") {
    $("#auth-kicker").textContent = "WELCOME BACK";
    $("#auth-title").textContent = "Log in to your dashboard";
    $("#auth-description").textContent = "Access your analyzer, daily quota and previous keyword research.";
    $("#auth-password-label").textContent = "Password";
    passwordInput.placeholder = "Your password";
    $("#auth-submit span").textContent = "Log in";
    switchRow.firstChild.textContent = "New to RankScope? ";
    switchButton.textContent = "Create account";
  } else {
    $("#auth-kicker").textContent = "SECURE YOUR ACCOUNT";
    $("#auth-title").textContent = "Choose a new password";
    $("#auth-description").textContent = "Enter a new password with at least eight characters.";
    $("#auth-password-label").textContent = "New password";
    passwordInput.placeholder = "New password";
    $("#auth-submit span").textContent = "Update password";
  }
}

async function apiFetch(path, options = {}) {
  if (!state.supabase) throw new Error("Authentication is not ready.");
  const { data } = await state.supabase.auth.getSession();
  const session = data?.session;
  if (!session?.access_token) throw new Error("Please sign in to continue.");
  state.session = session;

  const response = await fetch(path, {
    ...options,
    headers: {
      "content-type": "application/json",
      Authorization: `Bearer ${session.access_token}`,
      ...(options.headers || {}),
    },
  });

  let payload = {};
  try {
    payload = await response.json();
  } catch {
    payload = {};
  }

  if (!response.ok) {
    const error = new Error(payload.error || `Request failed with status ${response.status}.`);
    error.status = response.status;
    error.payload = payload;
    throw error;
  }

  return payload;
}

async function loadAccount() {
  if (state.loadingAccount) return;
  state.loadingAccount = true;
  try {
    const data = await apiFetch("/api/account", { method: "GET" });
    state.account = data;
    renderAccount();
    showDashboardApp();
  } catch (error) {
    console.error(error);
    toast(error.message, "error", "Account unavailable");
    if (error.status === 401) {
      await state.supabase.auth.signOut();
      showPublicApp();
    } else {
      showDashboardApp();
    }
  } finally {
    state.loadingAccount = false;
  }
}

function renderAccount() {
  const profile = state.account?.profile;
  const usage = state.account?.usage;
  if (!profile || !usage) return;

  const displayName = profile.full_name || profile.email?.split("@")[0] || "User";
  const avatarText = initials(displayName || profile.email);
  const isAdmin = profile.role === "admin";
  const isActive = profile.status === "active";

  $("#sidebar-name").textContent = displayName;
  $("#sidebar-email").textContent = profile.email;
  $("#sidebar-avatar").textContent = avatarText;
  $("#topbar-avatar").textContent = avatarText;
  $("#welcome-name").textContent = displayName.split(" ")[0];
  $("#current-date").textContent = todayLabel();

  $("#sidebar-usage-text").textContent = `${usage.used} / ${usage.limit}`;
  $("#sidebar-usage-bar").style.width = `${usage.percent}%`;
  $("#quota-remaining").textContent = usage.remaining;
  $("#stat-used").textContent = usage.used;
  $("#stat-used-note").textContent = `of ${usage.limit} available`;
  $("#stat-remaining").textContent = usage.remaining;
  $("#stat-status").textContent = profile.status === "active" ? "Active" : "Suspended";
  $("#stat-role").textContent = isAdmin ? "Administrator" : "Standard user";
  $("#admin-nav-item").classList.toggle("hidden", !isAdmin);
  $("#suspended-notice").classList.toggle("hidden", isActive);
  $("#analyze-form").classList.toggle("hidden", !isActive);

  if (!isAdmin && state.activeView === "admin") switchDashboardView("analyzer");
}

function switchDashboardView(view) {
  if (view === "admin" && state.account?.profile?.role !== "admin") return;
  state.activeView = view;
  $$(".dashboard-view").forEach((section) => section.classList.remove("active"));
  $$(".dashboard-nav-item").forEach((item) => item.classList.toggle("active", item.dataset.dashboardView === view));
  $(`#view-${view}`)?.classList.add("active");

  const labels = {
    analyzer: ["SEO RESEARCH WORKSPACE", "Keyword Analyzer"],
    history: ["YOUR RESEARCH LIBRARY", "Search History"],
    admin: ["PLATFORM CONTROL", "Admin Panel"],
  };
  $("#topbar-kicker").textContent = labels[view][0];
  $("#topbar-title").textContent = labels[view][1];

  closeSidebar();
  if (view === "history") loadHistory();
  if (view === "admin") loadAdminOverview();
  window.scrollTo({ top: 0, behavior: "smooth" });
}

function openSidebar() {
  $("#dashboard-sidebar").classList.add("open");
  $("#sidebar-overlay").classList.add("open");
}

function closeSidebar() {
  $("#dashboard-sidebar").classList.remove("open");
  $("#sidebar-overlay").classList.remove("open");
}

async function loadHistory() {
  try {
    const data = await apiFetch("/api/history?limit=100", { method: "GET" });
    state.history = data.searches || [];
    renderHistory();
  } catch (error) {
    toast(error.message, "error", "History unavailable");
  }
}

function competitionClass(label = "") {
  return String(label).toLowerCase().replaceAll(" ", "-");
}

function renderHistory() {
  const body = $("#history-body");
  const empty = $("#history-empty");
  const tableWrap = $("#history-table-wrap");
  const rows = state.history || [];
  empty.classList.toggle("hidden", rows.length > 0);
  tableWrap.classList.toggle("hidden", rows.length === 0);

  body.innerHTML = rows
    .map((item) => `
      <tr>
        <td><strong class="history-keyword">${escapeHtml(item.keyword)}</strong><span class="domain">${escapeHtml(item.language)}</span></td>
        <td>${escapeHtml(item.country)}</td>
        <td>${escapeHtml(item.search_intent || "—")}</td>
        <td><span class="competition-pill ${competitionClass(item.competition_label)}">${escapeHtml(item.competition_label || "—")} · ${Number(item.competition_score ?? 0)}</span></td>
        <td>${Number(item.result_count || 0)}</td>
        <td>${escapeHtml(formatDate(item.searched_at, true))}</td>
      </tr>`)
    .join("");
}

async function loadAdminOverview() {
  if (state.account?.profile?.role !== "admin") return;
  try {
    const data = await apiFetch("/api/admin", {
      method: "POST",
      body: JSON.stringify({ action: "overview" }),
    });
    state.adminOverview = data;
    renderAdminOverview();
  } catch (error) {
    toast(error.message, "error", "Admin data unavailable");
  }
}

function renderAdminOverview() {
  const data = state.adminOverview;
  if (!data) return;
  $("#admin-total-users").textContent = data.stats?.totalUsers || 0;
  $("#admin-active-users").textContent = data.stats?.activeUsers || 0;
  $("#admin-suspended-users").textContent = data.stats?.suspendedUsers || 0;
  $("#admin-searches-today").textContent = data.stats?.searchesToday || 0;
  renderAdminUsers();

  $("#admin-searches-body").innerHTML = (data.recentSearches || [])
    .map((item) => {
      const profile = Array.isArray(item.profiles) ? item.profiles[0] : item.profiles;
      return `
        <tr>
          <td>${escapeHtml(profile?.email || "Unknown user")}</td>
          <td><strong>${escapeHtml(item.keyword)}</strong></td>
          <td>${escapeHtml(item.country)}<span class="domain">${escapeHtml(item.language)}</span></td>
          <td>${escapeHtml(item.search_intent || "—")}</td>
          <td><span class="competition-pill ${competitionClass(item.competition_label)}">${escapeHtml(item.competition_label || "—")} · ${Number(item.competition_score || 0)}</span></td>
          <td>${escapeHtml(formatDate(item.searched_at, true))}</td>
        </tr>`;
    })
    .join("") || `<tr><td colspan="6" class="muted">No search activity recorded.</td></tr>`;
}

function renderAdminUsers() {
  const filter = $("#admin-user-filter").value.trim().toLowerCase();
  const users = (state.adminOverview?.users || []).filter((user) => {
    if (!filter) return true;
    return `${user.email} ${user.full_name}`.toLowerCase().includes(filter);
  });

  $("#admin-users-body").innerHTML = users
    .map((user) => {
      const name = user.full_name || user.email.split("@")[0];
      return `
        <tr data-admin-user-id="${escapeHtml(user.id)}">
          <td><div class="user-cell"><span class="user-mini-avatar">${escapeHtml(initials(name))}</span><div><strong>${escapeHtml(name)}</strong><span>${escapeHtml(user.email)}</span></div></div></td>
          <td><span class="role-pill ${escapeHtml(user.role)}">${escapeHtml(user.role)}</span></td>
          <td><span class="status-pill ${escapeHtml(user.status)}">${escapeHtml(user.status)}</span></td>
          <td><strong>${Number(user.usedToday || 0)}</strong> / ${Number(user.daily_limit || 0)}</td>
          <td>${Number(user.daily_limit || 0)}</td>
          <td>${escapeHtml(formatDate(user.created_at))}</td>
          <td>
            <div class="admin-edit-grid">
              <select data-field="role" aria-label="Role"><option value="user" ${user.role === "user" ? "selected" : ""}>User</option><option value="admin" ${user.role === "admin" ? "selected" : ""}>Admin</option></select>
              <select data-field="status" aria-label="Status"><option value="active" ${user.status === "active" ? "selected" : ""}>Active</option><option value="suspended" ${user.status === "suspended" ? "selected" : ""}>Suspended</option></select>
              <input data-field="dailyLimit" type="number" min="0" max="1000" value="${Number(user.daily_limit || 0)}" aria-label="Daily limit" />
              <button type="button" data-admin-action="save">Save</button>
            </div>
            <div class="admin-action-row"><button type="button" data-admin-action="reset">Reset today's usage</button><button class="danger-action" type="button" data-admin-action="delete">Delete user</button></div>
          </td>
        </tr>`;
    })
    .join("") || `<tr><td colspan="7" class="muted">No matching users found.</td></tr>`;
}

async function handleAdminAction(button) {
  const row = button.closest("tr[data-admin-user-id]");
  const userId = row?.dataset.adminUserId;
  if (!userId) return;
  button.disabled = true;

  try {
    if (button.dataset.adminAction === "save") {
      const role = $('[data-field="role"]', row).value;
      const status = $('[data-field="status"]', row).value;
      const dailyLimit = Number($('[data-field="dailyLimit"]', row).value);
      await apiFetch("/api/admin", {
        method: "POST",
        body: JSON.stringify({ action: "update_user", userId, role, status, dailyLimit }),
      });
      toast("The user account was updated.", "success", "User saved");
    } else if (button.dataset.adminAction === "reset") {
      await apiFetch("/api/admin", {
        method: "POST",
        body: JSON.stringify({ action: "reset_usage", userId }),
      });
      toast("Today's search usage was reset to zero.", "success", "Usage reset");
    } else if (button.dataset.adminAction === "delete") {
      const user = state.adminOverview?.users?.find((item) => item.id === userId);
      const confirmed = window.confirm(`Delete ${user?.email || "this user"}? Their account and saved data will be removed.`);
      if (!confirmed) return;
      await apiFetch("/api/admin", {
        method: "POST",
        body: JSON.stringify({ action: "delete_user", userId }),
      });
      toast("The user account and saved data were deleted.", "success", "User deleted");
    }
    await loadAdminOverview();
    if (userId === state.account?.profile?.id) await loadAccount();
  } catch (error) {
    toast(error.message, "error", "Update failed");
  } finally {
    button.disabled = false;
  }
}

function listHtml(items, className) {
  if (!Array.isArray(items) || !items.length) return '<span class="muted">Not provided</span>';
  return `<ul class="detail-list ${className}">${items.map((item) => `<li>${escapeHtml(item)}</li>`).join("")}</ul>`;
}

function renderResults(data) {
  state.latestData = data;
  $("#results").classList.remove("hidden");
  $("#result-keyword").textContent = data.keyword;
  $("#competition-label").textContent = data.competitionLabel;
  $("#competition-score").textContent = data.competitionScore;
  $("#score-ring").style.setProperty("--score", data.competitionScore);
  $("#search-intent").textContent = data.searchIntent;
  $("#competition-summary").textContent = data.competitionSummary || "No summary returned.";
  $("#ranking-pattern").textContent = data.rankingPattern || "No pattern returned.";
  $("#recommended-format").textContent = data.recommendedContentType || "Not provided";
  $("#recommended-words").textContent = data.recommendedWordCount || "Not provided";
  $("#methodology").textContent = data.methodology || "";

  const stats = data.wordCountStats || {};
  $("#average-words").textContent = stats.average ? formatNumber(stats.average) : "Not measured";
  $("#measured-pages").textContent = stats.pagesMeasured
    ? `Measured on ${stats.pagesMeasured} accessible page${stats.pagesMeasured === 1 ? "" : "s"}`
    : "Pages may have blocked automated fetching";

  $("#opportunities").innerHTML = (data.opportunities || [])
    .map((item) => `<li>${escapeHtml(item)}</li>`)
    .join("") || "<li>No opportunities returned.</li>";

  $("#results-body").innerHTML = (data.topResults || [])
    .map((item, index) => {
      const title = item.detectedTitle || item.title || item.domain;
      const words = item.wordCount ? formatNumber(item.wordCount) : "Blocked";
      return `
        <tr>
          <td class="rank-cell">${index + 1}</td>
          <td><a class="page-link" href="${escapeHtml(item.finalUrl || item.url)}" target="_blank" rel="noopener noreferrer">${escapeHtml(title)}</a><span class="domain">${escapeHtml(item.url)}</span></td>
          <td><span class="type-pill">${escapeHtml(item.pageType || "Unknown")}</span></td>
          <td><span class="word-count">${words}</span><span class="domain">${escapeHtml(item.fetchStatus || "")}</span></td>
          <td>${escapeHtml(item.contentAngle || item.snippet || "Not provided")}</td>
          <td>${listHtml(item.strengths, "strength")}${listHtml(item.gaps, "gap")}</td>
        </tr>`;
    })
    .join("");

  $("#results").scrollIntoView({ behavior: "smooth", block: "start" });
}

function csvEscape(value) {
  return `"${String(value ?? "").replaceAll('"', '""')}"`;
}

function exportCsv() {
  if (!state.latestData) return;
  const header = ["Rank", "Title", "URL", "Page Type", "Word Count", "Content Angle", "Strengths", "Gaps"];
  const rows = (state.latestData.topResults || []).map((item, index) => [
    index + 1,
    item.detectedTitle || item.title,
    item.finalUrl || item.url,
    item.pageType,
    item.wordCount ?? "Not measured",
    item.contentAngle,
    (item.strengths || []).join(" | "),
    (item.gaps || []).join(" | "),
  ]);
  const csv = [header, ...rows].map((row) => row.map(csvEscape).join(",")).join("\n");
  const blob = new Blob([`\uFEFF${csv}`], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `${state.latestData.keyword.replace(/[^a-z0-9]+/gi, "-").replace(/^-|-$/g, "").toLowerCase() || "keyword"}-serp-analysis.csv`;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

async function handleAnalyze(event) {
  event.preventDefault();
  if (state.account?.profile?.status !== "active") {
    setStatus("Your account is suspended.", "error");
    return;
  }

  const formData = new FormData(event.currentTarget);
  const payload = {
    keyword: String(formData.get("keyword") || "").trim(),
    country: String(formData.get("country") || "United States"),
    language: String(formData.get("language") || "English"),
  };

  setAnalyzeLoading(true);
  setStatus("Searching the live web, reviewing ranking pages and measuring accessible content…");
  $("#results").classList.add("hidden");

  try {
    const data = await apiFetch("/api/analyze", {
      method: "POST",
      body: JSON.stringify(payload),
    });
    renderResults(data);
    setStatus(data.cached ? "Analysis complete. A recent cached result was used and this search was recorded." : "Analysis complete.", "success");
    await Promise.all([loadAccount(), loadHistory()]);
  } catch (error) {
    const quota = error.payload?.quota;
    if (quota && state.account) {
      state.account.usage = {
        ...state.account.usage,
        ...quota,
        percent: quota.limit > 0 ? Math.min(100, Math.round((quota.used / quota.limit) * 100)) : 100,
      };
      renderAccount();
    }
    setStatus(error.message, "error");
    toast(error.message, "error", error.status === 429 ? "Daily limit reached" : "Analysis failed");
  } finally {
    setAnalyzeLoading(false);
  }
}

async function handleAuthSubmit(event) {
  event.preventDefault();
  if (!state.supabase) return;
  setAuthLoading(true);
  setAuthStatus();

  const email = $("#auth-email").value.trim();
  const password = $("#auth-password").value;
  const fullName = $("#auth-name").value.trim();

  try {
    if (password.length < 8) throw new Error("Password must contain at least 8 characters.");

    if (state.authMode === "signup") {
      if (!fullName) throw new Error("Enter your full name.");
      const { data, error } = await state.supabase.auth.signUp({
        email,
        password,
        options: {
          data: { full_name: fullName },
          emailRedirectTo: window.location.origin,
        },
      });
      if (error) throw error;
      if (data.session) {
        setAuthStatus("Account created. Opening your dashboard…", "success");
        closeAuth();
        await loadAccount();
      } else {
        setAuthStatus("Account created. Check your email and confirm the signup before logging in.", "success");
        $("#auth-password").value = "";
      }
    } else if (state.authMode === "login") {
      const { error } = await state.supabase.auth.signInWithPassword({ email, password });
      if (error) throw error;
      closeAuth();
      await loadAccount();
    } else {
      const { error } = await state.supabase.auth.updateUser({ password });
      if (error) throw error;
      setAuthStatus("Password updated successfully. Opening your dashboard…", "success");
      window.history.replaceState({}, "", window.location.pathname);
      closeAuth();
      await loadAccount();
    }
  } catch (error) {
    setAuthStatus(error.message || "Authentication failed.", "error");
  } finally {
    setAuthLoading(false);
  }
}

async function handleForgotPassword() {
  const email = $("#auth-email").value.trim();
  if (!email) {
    setAuthStatus("Enter your email address first.", "error");
    $("#auth-email").focus();
    return;
  }

  setAuthLoading(true);
  try {
    const { error } = await state.supabase.auth.resetPasswordForEmail(email, {
      redirectTo: `${window.location.origin}/#reset-password`,
    });
    if (error) throw error;
    setAuthStatus("Password reset email sent. Open the link in your inbox.", "success");
  } catch (error) {
    setAuthStatus(error.message, "error");
  } finally {
    setAuthLoading(false);
  }
}

async function handleSession(session, event = "") {
  state.session = session;
  if (event === "PASSWORD_RECOVERY" || window.location.hash === "#reset-password") {
    showPublicApp();
    openAuth("reset");
    return;
  }

  if (session) {
    await loadAccount();
  } else {
    state.account = null;
    state.latestData = null;
    showPublicApp();
  }
}

function bindEvents() {
  $$('[data-open-auth]').forEach((button) => button.addEventListener("click", () => openAuth(button.dataset.openAuth)));
  $("#auth-close").addEventListener("click", closeAuth);
  $("#auth-modal").addEventListener("click", (event) => {
    if (event.target === event.currentTarget) closeAuth();
  });
  $("#auth-switch").addEventListener("click", () => setAuthMode(state.authMode === "signup" ? "login" : "signup"));
  $("#forgot-password").addEventListener("click", handleForgotPassword);
  $("#auth-form").addEventListener("submit", handleAuthSubmit);
  $("#analyze-form").addEventListener("submit", handleAnalyze);
  $("#export-button").addEventListener("click", exportCsv);
  $("#logout-button").addEventListener("click", async () => {
    await state.supabase?.auth.signOut();
    closeSidebar();
    showPublicApp();
    toast("You have been logged out.", "success", "Signed out");
  });

  document.addEventListener("click", (event) => {
    const viewButton = event.target.closest("[data-dashboard-view]");
    if (viewButton) switchDashboardView(viewButton.dataset.dashboardView);
    const adminButton = event.target.closest("[data-admin-action]");
    if (adminButton) handleAdminAction(adminButton);
  });

  $("#refresh-history").addEventListener("click", loadHistory);
  $("#refresh-admin").addEventListener("click", loadAdminOverview);
  $("#admin-user-filter").addEventListener("input", renderAdminUsers);
  $("#sidebar-open").addEventListener("click", openSidebar);
  $("#sidebar-close").addEventListener("click", closeSidebar);
  $("#sidebar-overlay").addEventListener("click", closeSidebar);

  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape") {
      closeAuth();
      closeSidebar();
    }
  });
}

async function init() {
  bindEvents();
  $("#footer-year").textContent = new Date().getFullYear();
  $("#current-date").textContent = todayLabel();

  try {
    const response = await fetch("/api/config", { headers: { accept: "application/json" } });
    const config = await response.json();
    if (!response.ok) throw new Error(config.error || "Could not load application configuration.");

    state.supabase = createClient(config.supabaseUrl, config.supabaseAnonKey, {
      auth: {
        persistSession: true,
        autoRefreshToken: true,
        detectSessionInUrl: true,
      },
    });

    state.supabase.auth.onAuthStateChange((event, session) => {
      window.setTimeout(() => handleSession(session, event), 0);
    });

    const { data, error } = await state.supabase.auth.getSession();
    if (error) throw error;
    await handleSession(data.session, "INITIAL_SESSION");
  } catch (error) {
    console.error(error);
    showPublicApp();
    toast(`${error.message} Add the Supabase environment variables and deploy again.`, "error", "Setup required");
  }
}

init();
