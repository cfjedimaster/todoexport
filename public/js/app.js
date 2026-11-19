import {
  clearSession,
  getStoredSession,
  handleAuthCallback,
  loadAppConfig,
  startLogin,
} from "./auth.js";
import { buildHtmlExport } from "./html-export.js";
import { AuthExpiredError, exportAllTodos } from "./todo.js";

const FORMATS = {
  json: {
    filename: "todo-export.json",
    mimeType: "application/json;charset=utf-8",
    label: "JSON",
  },
  html: {
    filename: "todo-export.html",
    mimeType: "text/html;charset=utf-8",
    label: "HTML",
  },
};

const ui = {
  errorBanner: document.querySelector("#error-banner"),
  errorMessage: document.querySelector("#error-message"),

  viewLoading: document.querySelector("#view-loading"),
  loadingHeading: document.querySelector("#loading-heading"),
  loadingText: document.querySelector("#loading-text"),

  viewSignedOut: document.querySelector("#view-signed-out"),
  signedOutHeading: document.querySelector("#signed-out-heading"),
  btnSignIn: document.querySelector("#btn-sign-in"),

  viewSignedIn: document.querySelector("#view-signed-in"),
  exportHeading: document.querySelector("#export-heading"),
  userName: document.querySelector("#user-name"),
  userEmail: document.querySelector("#user-email"),
  btnSignOut: document.querySelector("#btn-sign-out"),
  exportForm: document.querySelector("#export-form"),
  btnExport: document.querySelector("#btn-export"),

  progressWrap: document.querySelector("#export-progress-wrap"),
  progressLabel: document.querySelector("#export-progress-label"),
  progressBar: document.querySelector("#export-progress"),

  successBanner: document.querySelector("#success-banner"),
  successMessage: document.querySelector("#success-message"),
  btnDownloadAgain: document.querySelector("#btn-download-again"),
  btnDownloadOther: document.querySelector("#btn-download-other"),
};

let clientId = null;
let currentSession = null;
let lastExportData = null;
let lastExportFormat = "json";

function showError(message) {
  ui.errorMessage.textContent = message;
  ui.errorBanner.hidden = false;
}

function clearError() {
  ui.errorMessage.textContent = "";
  ui.errorBanner.hidden = true;
}

function clearSuccess() {
  ui.successMessage.textContent = "";
  ui.successBanner.hidden = true;
}

function showView(name, { focusHeading = false } = {}) {
  ui.viewLoading.hidden = name !== "loading";
  ui.viewSignedOut.hidden = name !== "signed-out";
  ui.viewSignedIn.hidden = name !== "signed-in";

  if (name === "loading") {
    document.title = "Signing In | Microsoft To Do Exporter";
  } else if (name === "signed-out") {
    document.title = "Sign In | Microsoft To Do Exporter";
    if (focusHeading) {
      ui.signedOutHeading.focus();
    }
  } else if (name === "signed-in") {
    document.title = "Export Options | Microsoft To Do Exporter";
    if (focusHeading) {
      ui.exportHeading.focus();
    }
  }
}

function renderSignedInUser(session) {
  ui.userName.textContent = session.user.name;
  ui.userEmail.textContent =
    session.user.email && session.user.email !== session.user.name
      ? session.user.email
      : "";
  ui.userEmail.hidden = !ui.userEmail.textContent;
}

function setFormBusy(busy) {
  ui.btnExport.disabled = busy;
  ui.btnSignOut.disabled = busy;
  for (const input of ui.exportForm.querySelectorAll("input")) {
    input.disabled = busy;
  }
  ui.btnExport.textContent = busy ? "Exporting…" : "Export To Dos";
}

function triggerFileDownload(content, { filename, mimeType }) {
  const blob = new Blob([content], { type: mimeType });
  const objectUrl = URL.createObjectURL(blob);

  const link = document.createElement("a");
  link.href = objectUrl;
  link.download = filename;
  link.hidden = true;
  document.body.append(link);
  link.click();
  link.remove();

  // Revoke slightly later so browsers finish starting the download
  setTimeout(() => URL.revokeObjectURL(objectUrl), 10_000);
}

function serializeAndDownload(exportData, formatKey) {
  const format = FORMATS[formatKey] || FORMATS.json;
  const content =
    formatKey === "html"
      ? buildHtmlExport(exportData)
      : `${JSON.stringify(exportData, null, 2)}\n`;
  triggerFileDownload(content, format);
  return format;
}

function formatSummaryText(summary, filename) {
  const listWord = summary.listCount === 1 ? "list" : "lists";
  const taskWord = summary.taskCount === 1 ? "task" : "tasks";
  const parts = [`${summary.listCount} ${listWord}`, `${summary.taskCount} ${taskWord}`];

  if (summary.attachmentCount > 0) {
    const attachmentWord = summary.attachmentCount === 1 ? "attachment" : "attachments";
    parts.push(`${summary.attachmentCount} ${attachmentWord} (metadata only)`);
  }

  return `Export complete! ${filename} has been downloaded with ${parts.join(", ")}.`;
}

function updateDownloadButtons(primaryFormat) {
  const current = FORMATS[primaryFormat] || FORMATS.json;
  const otherKey = primaryFormat === "html" ? "json" : "html";
  const other = FORMATS[otherKey];

  ui.btnDownloadAgain.textContent = `Download ${current.filename} again`;
  ui.btnDownloadOther.textContent = `Also download as ${other.label}`;
  ui.btnDownloadOther.dataset.format = otherKey;
}

async function handleSignInClick() {
  clearError();
  if (!clientId) {
    showError("Sign-in is currently unavailable because the application is not configured.");
    return;
  }

  ui.btnSignIn.disabled = true;
  try {
    await startLogin(clientId);
  } catch (err) {
    ui.btnSignIn.disabled = false;
    showError(err instanceof Error ? err.message : "Unable to start Microsoft sign-in.");
  }
}

function handleSignOutClick() {
  clearError();
  clearSuccess();
  clearSession();
  currentSession = null;
  lastExportData = null;
  ui.progressWrap.hidden = true;
  showView("signed-out", { focusHeading: true });
}

async function handleExportSubmit(event) {
  event.preventDefault();
  clearError();
  clearSuccess();

  const activeSession = getStoredSession();
  if (!activeSession) {
    currentSession = null;
    showError("Your Microsoft session expired. Please sign in again to export your To Dos.");
    showView("signed-out", { focusHeading: true });
    return;
  }
  currentSession = activeSession;

  const formData = new FormData(ui.exportForm);
  const includeCompleted = formData.get("includeCompleted") === "yes";
  const exportFormat = formData.get("exportFormat") === "html" ? "html" : "json";

  setFormBusy(true);
  ui.progressWrap.hidden = false;
  ui.progressLabel.textContent = "Loading your lists…";
  ui.progressBar.removeAttribute("value");
  document.title = "Exporting… | Microsoft To Do Exporter";

  try {
    const exportData = await exportAllTodos({
      accessToken: currentSession.accessToken,
      includeCompleted,
      onProgress({ phase, currentIndex, totalLists, listName }) {
        if (phase === "lists") {
          ui.progressLabel.textContent = "Loading your lists…";
          ui.progressBar.removeAttribute("value");
        } else if (phase === "tasks") {
          ui.progressLabel.textContent = `Reading list ${currentIndex} of ${totalLists}: ${listName}`;
          ui.progressBar.max = Math.max(totalLists, 1);
          ui.progressBar.value = currentIndex;
        }
      },
    });

    lastExportData = exportData;
    lastExportFormat = exportFormat;

    const downloadedFormat = serializeAndDownload(exportData, exportFormat);
    updateDownloadButtons(exportFormat);

    ui.progressWrap.hidden = true;
    ui.successMessage.textContent = formatSummaryText(
      exportData.summary,
      downloadedFormat.filename
    );
    ui.successBanner.hidden = false;
    document.title = "Export Complete | Microsoft To Do Exporter";
  } catch (err) {
    ui.progressWrap.hidden = true;
    document.title = "Export Options | Microsoft To Do Exporter";

    if (err instanceof AuthExpiredError) {
      clearSession();
      currentSession = null;
      showError(err.message);
      showView("signed-out", { focusHeading: true });
      return;
    }

    showError(
      err instanceof Error
        ? err.message
        : "Something went wrong while exporting your To Dos. Please try again."
    );
  } finally {
    setFormBusy(false);
  }
}

async function init() {
  ui.btnSignIn.addEventListener("click", handleSignInClick);
  ui.btnSignOut.addEventListener("click", handleSignOutClick);
  ui.exportForm.addEventListener("submit", handleExportSubmit);
  ui.btnDownloadAgain.addEventListener("click", () => {
    if (lastExportData) {
      serializeAndDownload(lastExportData, lastExportFormat);
    }
  });
  ui.btnDownloadOther.addEventListener("click", () => {
    if (lastExportData) {
      const otherFormat = ui.btnDownloadOther.dataset.format || "html";
      serializeAndDownload(lastExportData, otherFormat);
    }
  });

  showView("loading");

  try {
    const config = await loadAppConfig();
    clientId = config.clientId;
  } catch (err) {
    ui.btnSignIn.disabled = true;
    showError(err instanceof Error ? err.message : "Unable to load application configuration.");
    showView("signed-out");
    return;
  }

  try {
    const callbackSession = await handleAuthCallback(clientId);
    if (callbackSession) {
      currentSession = callbackSession;
      renderSignedInUser(currentSession);
      showView("signed-in", { focusHeading: true });
      return;
    }
  } catch (err) {
    showError(err instanceof Error ? err.message : "Sign-in could not be completed.");
    showView("signed-out", { focusHeading: true });
    return;
  }

  const stored = getStoredSession();
  if (stored) {
    currentSession = stored;
    renderSignedInUser(currentSession);
    showView("signed-in");
  } else {
    showView("signed-out");
  }
}

init();
