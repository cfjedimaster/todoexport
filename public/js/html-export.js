const HTML_ESCAPE_MAP = {
  "&": "&amp;",
  "<": "&lt;",
  ">": "&gt;",
  '"': "&quot;",
  "'": "&#39;",
};

/**
 * Escape text for safe insertion into HTML text nodes and double-quoted attributes.
 * @param {unknown} value
 * @returns {string}
 */
export function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, (ch) => HTML_ESCAPE_MAP[ch]);
}

/**
 * Allow only http(s) URLs in generated anchor hrefs.
 * @param {unknown} rawUrl
 * @returns {string | null}
 */
export function sanitizeHttpUrl(rawUrl) {
  if (typeof rawUrl !== "string" || !rawUrl.trim()) {
    return null;
  }
  try {
    const parsed = new URL(rawUrl.trim());
    if (parsed.protocol === "http:" || parsed.protocol === "https:") {
      return parsed.href;
    }
    return null;
  } catch {
    return null;
  }
}

/**
 * Extract clean plain text from a task note body (handling both plain text and HTML bodies safely).
 * @param {{ content?: string, contentType?: string } | null | undefined} body
 * @returns {string}
 */
export function extractNoteText(body) {
  const raw = typeof body?.content === "string" ? body.content : "";
  if (!raw.trim()) {
    return "";
  }

  if (body?.contentType?.toLowerCase() !== "html") {
    return raw.replace(/\r\n/g, "\n").trim();
  }

  // Prefer the native Sanitizer API's Document.parseHTML() when available in the browser
  // so scripts, styles, and unsafe elements are stripped before reading textContent.
  if (typeof Document !== "undefined" && typeof Document.parseHTML === "function") {
    const doc = Document.parseHTML(raw);
    for (const br of doc.querySelectorAll("br")) {
      br.replaceWith("\n");
    }
    for (const block of doc.querySelectorAll("p, div, li, tr, h1, h2, h3, h4, h5, h6")) {
      block.append("\n");
    }
    return (doc.body?.textContent || "")
      .replace(/\r\n/g, "\n")
      .replace(/\n{3,}/g, "\n\n")
      .trim();
  }

  // Fallback (e.g. Safari without Document.parseHTML or Node tests):
  // strip script/style blocks and tags, then decode common HTML entities into plain text.
  return raw
    .replace(/<(script|style)\b[^>]*>[\s\S]*?<\/\1>/gi, "")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(p|div|li|tr|h[1-6])>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/\r\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/**
 * Format an ISO timestamp or Graph dateTimeTimeZone object cleanly.
 * Calendar-only dates (midnight UTC such as dueDateTime) are formatted in UTC so they never shift a day.
 * @param {string | { dateTime?: string, timeZone?: string } | null | undefined} input
 * @param {{ includeTime?: boolean, dateOnly?: boolean, locale?: string }} options
 * @returns {string}
 */
export function formatDateValue(
  input,
  { includeTime = false, dateOnly = false, locale } = {}
) {
  if (!input) {
    return "";
  }

  let raw = "";
  let tz = "";
  if (typeof input === "string") {
    raw = input.trim();
  } else if (typeof input === "object" && typeof input.dateTime === "string") {
    raw = input.dateTime.trim();
    tz = typeof input.timeZone === "string" ? input.timeZone.trim() : "";
  }

  if (!raw) {
    return "";
  }

  // Normalize fractional seconds beyond 3 digits (Graph often returns 7 digits) and append Z for UTC
  let normalized = raw.replace(/(\.\d{3})\d+/, "$1");
  const hasOffset = /(?:Z|[+-]\d{2}:?\d{2})$/i.test(normalized);
  if (!hasOffset && (!tz || tz.toUpperCase() === "UTC")) {
    normalized = `${normalized}Z`;
  }

  const parsed = new Date(normalized);
  if (Number.isNaN(parsed.getTime())) {
    return raw;
  }

  const isMidnightUtc = /T00:00:00(?:\.0+)?Z$/i.test(normalized);
  const useUtc = dateOnly || isMidnightUtc;

  const formatOptions = {
    year: "numeric",
    month: "short",
    day: "numeric",
    ...(includeTime && !useUtc ? { hour: "numeric", minute: "2-digit" } : {}),
    ...(useUtc ? { timeZone: "UTC" } : {}),
  };

  try {
    return new Intl.DateTimeFormat(locale, formatOptions).format(parsed);
  } catch {
    return parsed.toISOString().slice(0, 10);
  }
}

/**
 * Format a byte count into a human-friendly size string.
 * @param {number | null | undefined} bytes
 * @returns {string}
 */
export function formatFileSize(bytes) {
  if (typeof bytes !== "number" || !Number.isFinite(bytes) || bytes < 0) {
    return "";
  }
  if (bytes < 1024) {
    return `${bytes} B`;
  }
  if (bytes < 1024 * 1024) {
    return `${(bytes / 1024).toFixed(1)} KB`;
  }
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function renderTaskDates(task, locale) {
  const entries = [];

  const due = formatDateValue(task.dueDateTime, { dateOnly: true, locale });
  if (due) {
    entries.push({ label: "Due", value: due });
  }

  const completed = formatDateValue(task.completedDateTime, { dateOnly: true, locale });
  if (completed) {
    entries.push({ label: "Completed", value: completed });
  }

  const start = formatDateValue(task.startDateTime, { dateOnly: true, locale });
  if (start) {
    entries.push({ label: "Starts", value: start });
  }

  if (task.isReminderOn) {
    const reminder = formatDateValue(task.reminderDateTime, { includeTime: true, locale });
    if (reminder) {
      entries.push({ label: "Reminder", value: reminder });
    }
  }

  const created = formatDateValue(task.createdDateTime, { locale });
  if (created) {
    entries.push({ label: "Created", value: created });
  }

  if (entries.length === 0) {
    return "";
  }

  const itemsHtml = entries
    .map(
      ({ label, value }) =>
        `<span class="meta-item"><strong>${escapeHtml(label)}:</strong> ${escapeHtml(value)}</span>`
    )
    .join("");

  return `<div class="task-meta">${itemsHtml}</div>`;
}

function renderTask(task, locale) {
  const isCompleted = task.status === "completed";
  const statusSymbol = isCompleted ? "&#10003;" : "&#9675;";
  const statusLabel = isCompleted ? "Completed" : "Open";

  const badges = [];
  if (task.importance === "high") {
    badges.push('<span class="badge badge-high">High priority</span>');
  }
  if (isCompleted) {
    badges.push('<span class="badge badge-done">Completed</span>');
  }
  if (Array.isArray(task.categories)) {
    for (const category of task.categories) {
      if (category) {
        badges.push(`<span class="badge">${escapeHtml(category)}</span>`);
      }
    }
  }

  const badgesHtml = badges.length > 0 ? `<div class="badges">${badges.join("")}</div>` : "";
  const datesHtml = renderTaskDates(task, locale);

  const noteText = extractNoteText(task.body);
  const noteHtml = noteText
    ? `<div class="task-note">${escapeHtml(noteText)}</div>`
    : "";

  let checklistHtml = "";
  if (Array.isArray(task.checklistItems) && task.checklistItems.length > 0) {
    const items = task.checklistItems
      .map((step) => {
        const checked = Boolean(step.isChecked);
        const mark = checked ? "&#9745;" : "&#9744;";
        const cls = checked ? "step step-done" : "step";
        return `<li class="${cls}"><span aria-hidden="true">${mark}</span> <span>${escapeHtml(step.displayName || "")}</span></li>`;
      })
      .join("");
    checklistHtml = `<ul class="checklist">${items}</ul>`;
  }

  let linksHtml = "";
  if (Array.isArray(task.linkedResources) && task.linkedResources.length > 0) {
    const items = task.linkedResources
      .map((res) => {
        const label = res.displayName || res.applicationName || res.webUrl || "Linked item";
        const safeHref = sanitizeHttpUrl(res.webUrl);
        if (safeHref) {
          return `<li><a href="${escapeHtml(safeHref)}" target="_blank" rel="noopener noreferrer">${escapeHtml(label)}</a></li>`;
        }
        return `<li>${escapeHtml(label)}</li>`;
      })
      .join("");
    linksHtml = `<div class="subblock"><h4>Links</h4><ul class="sublist">${items}</ul></div>`;
  }

  let attachmentsHtml = "";
  if (Array.isArray(task.attachments) && task.attachments.length > 0) {
    const items = task.attachments
      .map((att) => {
        const sizeText = formatFileSize(att.size);
        const detail = [att.contentType, sizeText].filter(Boolean).join(", ");
        const suffix = detail ? ` <span class="muted">(${escapeHtml(detail)})</span>` : "";
        return `<li>${escapeHtml(att.name || "Attachment")}${suffix}</li>`;
      })
      .join("");
    attachmentsHtml = `<div class="subblock"><h4>Attachments (metadata only)</h4><ul class="sublist">${items}</ul></div>`;
  } else if (task.attachmentsUnavailable) {
    attachmentsHtml =
      '<div class="subblock"><p class="muted">Attachments exist on this task, but Microsoft did not allow reading their details.</p></div>';
  }

  return `<article class="task${isCompleted ? " task-completed" : ""}">
      <div class="task-header">
        <span class="status-icon" title="${statusLabel}" aria-label="${statusLabel}">${statusSymbol}</span>
        <h3>${escapeHtml(task.title || "Untitled task")}</h3>
      </div>
      ${badgesHtml}
      ${datesHtml}
      ${noteHtml}
      ${checklistHtml}
      ${linksHtml}
      ${attachmentsHtml}
    </article>`;
}

/**
 * Build a clean, standalone, printable HTML document from the exported To Do payload.
 * @param {Record<string, any>} exportData
 * @param {{ locale?: string }} options
 * @returns {string}
 */
export function buildHtmlExport(exportData, { locale } = {}) {
  const lists = Array.isArray(exportData?.lists) ? exportData.lists : [];
  const summary = exportData?.summary || { listCount: lists.length, taskCount: 0 };
  const exportedLabel = formatDateValue(exportData?.exportedAt, { includeTime: true, locale });
  const scopeLabel = exportData?.includeCompleted
    ? "Open and completed tasks"
    : "Open (incomplete) tasks only";

  const listWord = summary.listCount === 1 ? "list" : "lists";
  const taskWord = summary.taskCount === 1 ? "task" : "tasks";

  const tocHtml =
    lists.length > 1
      ? `<nav class="toc" aria-label="Task lists">
      <h2>Lists</h2>
      <ul>
        ${lists
          .map((list, idx) => {
            const count = Array.isArray(list.tasks) ? list.tasks.length : 0;
            return `<li><a href="#list-${idx + 1}">${escapeHtml(list.displayName || "Untitled list")}</a> <span class="count">(${count})</span></li>`;
          })
          .join("\n        ")}
      </ul>
    </nav>`
      : "";

  const listsHtml =
    lists.length === 0
      ? '<section class="list-section"><p class="muted">No lists were found in this account.</p></section>'
      : lists
          .map((list, idx) => {
            const tasks = Array.isArray(list.tasks) ? list.tasks : [];
            const sharedBadge = list.isShared
              ? ' <span class="badge">Shared</span>'
              : "";
            const tasksHtml =
              tasks.length === 0
                ? '<p class="muted">No matching tasks in this list.</p>'
                : tasks.map((task) => renderTask(task, locale)).join("\n    ");

            return `<section class="list-section" id="list-${idx + 1}">
    <div class="list-heading">
      <h2>${escapeHtml(list.displayName || "Untitled list")}${sharedBadge}</h2>
      <span class="list-count">${tasks.length} ${tasks.length === 1 ? "task" : "tasks"}</span>
    </div>
    ${tasksHtml}
  </section>`;
          })
          .join("\n\n  ");

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta name="color-scheme" content="light dark">
  <title>Microsoft To Do Export</title>
  <style>
    :root {
      --bg-light: #f6f8fb;
      --bg-dark: #10151c;
      --surface-light: #ffffff;
      --surface-dark: #18202c;
      --subtle-light: #eef2f7;
      --subtle-dark: #212c3b;
      --border-light: #d5dce6;
      --border-dark: #303d4f;
      --text-light: #161c24;
      --text-dark: #edf2f7;
      --muted-light: #4f5b6b;
      --muted-dark: #a6b4c6;
      --accent-light: #0a58ca;
      --accent-dark: #60a5fa;
      --high-bg-light: #fdeeee;
      --high-bg-dark: #3a191c;
      --high-text-light: #991b1b;
      --high-text-dark: #fecaca;
      --done-bg-light: #e8f6ee;
      --done-bg-dark: #142f21;
      --done-text-light: #14532d;
      --done-text-dark: #bbf7d0;

      --bg: var(--bg-light);
      --surface: var(--surface-light);
      --subtle: var(--subtle-light);
      --border: var(--border-light);
      --text: var(--text-light);
      --muted: var(--muted-light);
      --accent: var(--accent-light);
      --high-bg: var(--high-bg-light);
      --high-text: var(--high-text-light);
      --done-bg: var(--done-bg-light);
      --done-text: var(--done-text-light);
      color-scheme: light dark;
    }

    @media (prefers-color-scheme: dark) {
      :root {
        --bg: var(--bg-dark);
        --surface: var(--surface-dark);
        --subtle: var(--subtle-dark);
        --border: var(--border-dark);
        --text: var(--text-dark);
        --muted: var(--muted-dark);
        --accent: var(--accent-dark);
        --high-bg: var(--high-bg-dark);
        --high-text: var(--high-text-dark);
        --done-bg: var(--done-bg-dark);
        --done-text: var(--done-text-dark);
      }
    }

    @supports (color: light-dark(white, black)) {
      :root {
        --bg: light-dark(var(--bg-light), var(--bg-dark));
        --surface: light-dark(var(--surface-light), var(--surface-dark));
        --subtle: light-dark(var(--subtle-light), var(--subtle-dark));
        --border: light-dark(var(--border-light), var(--border-dark));
        --text: light-dark(var(--text-light), var(--text-dark));
        --muted: light-dark(var(--muted-light), var(--muted-dark));
        --accent: light-dark(var(--accent-light), var(--accent-dark));
        --high-bg: light-dark(var(--high-bg-light), var(--high-bg-dark));
        --high-text: light-dark(var(--high-text-light), var(--high-text-dark));
        --done-bg: light-dark(var(--done-bg-light), var(--done-bg-dark));
        --done-text: light-dark(var(--done-text-light), var(--done-text-dark));
      }
    }

    *, *::before, *::after { box-sizing: border-box; }
    body {
      margin: 0;
      font-family: system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
      font-size: 1rem;
      line-height: 1.6;
      color: var(--text);
      background: var(--bg);
    }
    .container {
      max-inline-size: 52rem;
      margin-inline: auto;
      padding: 2rem 1.25rem 3rem;
    }
    header {
      margin-block-end: 1.75rem;
      padding-block-end: 1.25rem;
      border-block-end: 2px solid var(--border);
    }
    h1 { margin: 0 0 0.4rem; font-size: 1.75rem; line-height: 1.2; }
    .summary { margin: 0; color: var(--muted); font-size: 0.95rem; }
    .toc {
      background: var(--surface);
      border: 1px solid var(--border);
      border-radius: 0.65rem;
      padding: 1rem 1.25rem;
      margin-block-end: 2rem;
    }
    .toc h2 { margin: 0 0 0.5rem; font-size: 1.05rem; }
    .toc ul {
      margin: 0;
      padding: 0;
      list-style: none;
      display: flex;
      flex-wrap: wrap;
      gap: 0.5rem 1.25rem;
    }
    .toc a { color: var(--accent); text-underline-offset: 0.18em; }
    .count, .muted { color: var(--muted); }
    .list-section { margin-block-end: 2.25rem; }
    .list-heading {
      display: flex;
      flex-wrap: wrap;
      align-items: baseline;
      justify-content: space-between;
      gap: 0.5rem;
      border-block-end: 1px solid var(--border);
      padding-block-end: 0.4rem;
      margin-block-end: 1rem;
    }
    .list-heading h2 { margin: 0; font-size: 1.35rem; }
    .list-count { font-size: 0.9rem; color: var(--muted); }
    .task {
      background: var(--surface);
      border: 1px solid var(--border);
      border-radius: 0.65rem;
      padding: 1rem 1.15rem;
      margin-block-end: 0.85rem;
      break-inside: avoid;
    }
    .task-completed { opacity: 0.85; }
    .task-header {
      display: flex;
      align-items: baseline;
      gap: 0.55rem;
    }
    .status-icon { color: var(--accent); font-weight: 700; flex-shrink: 0; }
    .task-completed .status-icon { color: var(--done-text); }
    .task-header h3 { margin: 0; font-size: 1.05rem; line-height: 1.35; }
    .task-completed .task-header h3 { text-decoration: line-through; }
    .badges {
      display: flex;
      flex-wrap: wrap;
      gap: 0.35rem;
      margin-block-start: 0.45rem;
    }
    .badge {
      font-size: 0.78rem;
      font-weight: 600;
      padding: 0.12rem 0.5rem;
      border-radius: 999px;
      background: var(--subtle);
      color: var(--text);
    }
    .badge-high { background: var(--high-bg); color: var(--high-text); }
    .badge-done { background: var(--done-bg); color: var(--done-text); }
    .task-meta {
      display: flex;
      flex-wrap: wrap;
      gap: 0.3rem 1rem;
      margin-block-start: 0.5rem;
      font-size: 0.875rem;
      color: var(--muted);
    }
    .task-note {
      margin-block-start: 0.75rem;
      padding: 0.75rem 0.9rem;
      background: var(--subtle);
      border-radius: 0.45rem;
      white-space: pre-wrap;
      word-break: break-word;
      font-size: 0.95rem;
    }
    .checklist {
      margin: 0.75rem 0 0;
      padding: 0;
      list-style: none;
      display: flex;
      flex-direction: column;
      gap: 0.3rem;
      font-size: 0.9375rem;
    }
    .step-done span:last-child { text-decoration: line-through; color: var(--muted); }
    .subblock { margin-block-start: 0.75rem; font-size: 0.9rem; }
    .subblock h4 { margin: 0 0 0.25rem; font-size: 0.85rem; color: var(--muted); text-transform: uppercase; letter-spacing: 0.03em; }
    .sublist { margin: 0; padding-inline-start: 1.25rem; }
    .sublist a { color: var(--accent); word-break: break-word; }
    footer {
      margin-block-start: 2.5rem;
      padding-block-start: 1rem;
      border-block-start: 1px solid var(--border);
      font-size: 0.85rem;
      color: var(--muted);
    }
    @media print {
      :root {
        --bg: #ffffff;
        --surface: #ffffff;
        --subtle: #f5f5f5;
        --border: #cccccc;
        --text: #000000;
        --muted: #444444;
        --accent: #000000;
      }
      body { background: #ffffff; color: #000000; }
      .toc { display: none; }
      .container { max-inline-size: none; padding: 0; }
      .task-completed { opacity: 1; }
    }
  </style>
</head>
<body>
  <div class="container">
    <header>
      <h1>Microsoft To Do Export</h1>
      <p class="summary">
        Exported ${escapeHtml(exportedLabel || "unknown date")} &middot;
        ${escapeHtml(scopeLabel)} &middot;
        ${summary.listCount} ${listWord}, ${summary.taskCount} ${taskWord}
      </p>
    </header>

    ${tocHtml}

    <main>
  ${listsHtml}
    </main>

    <footer>
      List groups are not included (lists appear flat), and file attachments are shown as metadata only.
    </footer>
  </div>
</body>
</html>
`;
}
