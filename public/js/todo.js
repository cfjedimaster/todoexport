const GRAPH_BASE = "https://graph.microsoft.com/v1.0";
const PAGE_SIZE = 100;

export class AuthExpiredError extends Error {
  constructor(message = "Your Microsoft session expired. Please sign in again.") {
    super(message);
    this.name = "AuthExpiredError";
  }
}

/**
 * Parse a Retry-After header value into milliseconds.
 * @param {string | null} headerValue
 * @param {number} attempt
 * @returns {number}
 */
export function parseRetryAfterMs(headerValue, attempt = 0) {
  const fallbackMs = Math.min(1000 * 2 ** attempt, 15_000);
  if (!headerValue) {
    return fallbackMs;
  }

  const seconds = Number(headerValue);
  if (Number.isFinite(seconds) && seconds >= 0) {
    return Math.min(Math.max(seconds * 1000, 500), 30_000);
  }

  const retryDate = Date.parse(headerValue);
  if (!Number.isNaN(retryDate)) {
    const delta = retryDate - Date.now();
    return Math.min(Math.max(delta, 500), 30_000);
  }

  return fallbackMs;
}

/**
 * Perform an authenticated JSON request with automatic 429/503 retry handling.
 */
export async function fetchGraphJson(
  url,
  accessToken,
  { fetchImpl = fetch, sleepImpl = defaultSleep, maxRetries = 4 } = {}
) {
  for (let attempt = 0; attempt <= maxRetries; attempt += 1) {
    const response = await fetchImpl(url, {
      headers: {
        Authorization: `Bearer ${accessToken}`,
        Accept: "application/json",
      },
    });

    if ((response.status === 429 || response.status === 503 || response.status === 504) && attempt < maxRetries) {
      const waitMs = parseRetryAfterMs(response.headers?.get("Retry-After"), attempt);
      await sleepImpl(waitMs);
      continue;
    }

    let data = null;
    try {
      data = await response.json();
    } catch {
      data = null;
    }

    if (response.status === 401) {
      const code = data?.error?.code || "";
      const detail = data?.error?.message || "";
      const wwwAuth = response.headers?.get("www-authenticate") || "";
      const endpointPath = safeEndpointPath(url);
      console.error("Microsoft returned HTTP 401:", {
        url,
        endpointPath,
        code,
        detail,
        wwwAuth,
        data,
      });

      const looksExpired =
        !detail ||
        /expired|lifetime validation failed/i.test(detail) ||
        /expired/i.test(wwwAuth);

      if (looksExpired) {
        throw new AuthExpiredError(
          detail
            ? `Your Microsoft session expired (${code || "401"}: ${detail}). Please sign in again.`
            : undefined
        );
      }

      const error = new Error(
        `Access was rejected by Microsoft (${code || "401"}): ${detail}`
      );
      error.status = 401;
      error.code = code;
      error.endpointPath = endpointPath;
      throw error;
    }

    if (!response.ok) {
      const error = new Error(
        data?.error?.message || `Microsoft returned an error (HTTP ${response.status}).`
      );
      error.status = response.status;
      throw error;
    }

    return data;
  }

  throw new Error("Microsoft temporarily rate-limited the export. Please try again in a moment.");
}

/**
 * Follow @odata.nextLink until all items in a collection have been retrieved.
 */
export async function fetchAllPages(initialUrl, accessToken, options = {}) {
  const items = [];
  let nextUrl = initialUrl;

  while (nextUrl) {
    const page = await fetchGraphJson(nextUrl, accessToken, options);
    if (Array.isArray(page?.value)) {
      items.push(...page.value);
    }
    nextUrl = page?.["@odata.nextLink"] || null;
  }

  return items;
}

/**
 * Strip noisy @odata.* metadata properties recursively.
 * @param {unknown} value
 * @returns {unknown}
 */
export function stripODataKeys(value) {
  if (Array.isArray(value)) {
    return value.map(stripODataKeys);
  }
  if (value && typeof value === "object") {
    const cleaned = {};
    for (const [key, val] of Object.entries(value)) {
      if (key.startsWith("@odata.")) {
        continue;
      }
      cleaned[key] = stripODataKeys(val);
    }
    return cleaned;
  }
  return value;
}

/**
 * Normalize attachment metadata (explicitly excluding any binary contentBytes).
 * @param {Record<string, unknown>} rawAttachment
 */
export function cleanAttachmentMetadata(rawAttachment) {
  return {
    id: rawAttachment.id ?? null,
    name: rawAttachment.name ?? null,
    contentType: rawAttachment.contentType ?? null,
    size: typeof rawAttachment.size === "number" ? rawAttachment.size : null,
    lastModifiedDateTime: rawAttachment.lastModifiedDateTime ?? null,
  };
}

/**
 * Clean a task object while preserving every structured field of the note.
 * @param {Record<string, unknown>} rawTask
 * @param {Array<Record<string, unknown>>} attachments
 */
export function cleanTask(rawTask, attachments = [], { attachmentsUnavailable = false } = {}) {
  const cleaned = stripODataKeys(rawTask);

  const checklistItems = Array.isArray(cleaned.checklistItems)
    ? cleaned.checklistItems
    : [];
  const linkedResources = Array.isArray(cleaned.linkedResources)
    ? cleaned.linkedResources
    : [];

  const result = {
    id: cleaned.id ?? null,
    title: cleaned.title ?? "",
    status: cleaned.status ?? null,
    importance: cleaned.importance ?? null,
    isReminderOn: Boolean(cleaned.isReminderOn),
    categories: Array.isArray(cleaned.categories) ? cleaned.categories : [],
    body: cleaned.body ?? null,
    createdDateTime: cleaned.createdDateTime ?? null,
    lastModifiedDateTime: cleaned.lastModifiedDateTime ?? null,
    bodyLastModifiedDateTime: cleaned.bodyLastModifiedDateTime ?? null,
    startDateTime: cleaned.startDateTime ?? null,
    dueDateTime: cleaned.dueDateTime ?? null,
    reminderDateTime: cleaned.reminderDateTime ?? null,
    completedDateTime: cleaned.completedDateTime ?? null,
    recurrence: cleaned.recurrence ?? null,
    hasAttachments: Boolean(cleaned.hasAttachments),
    checklistItems,
    linkedResources,
    attachments: attachments.map(cleanAttachmentMetadata),
  };

  if (attachmentsUnavailable) {
    result.attachmentsUnavailable = true;
  }

  return result;
}

/**
 * Clean a To Do list object and attach its cleaned tasks.
 * @param {Record<string, unknown>} rawList
 * @param {Array<Record<string, unknown>>} tasks
 */
export function cleanList(rawList, tasks) {
  return {
    id: rawList.id ?? null,
    displayName: rawList.displayName ?? "",
    isOwner: Boolean(rawList.isOwner),
    isShared: Boolean(rawList.isShared),
    wellknownListName: rawList.wellknownListName ?? null,
    tasks,
  };
}

/**
 * Fetch all tasks for a single list, expanding checklistItems & linkedResources with graceful fallbacks,
 * and fetching attachment metadata whenever a task has attachments.
 */
export async function fetchTasksForList(listId, accessToken, includeCompleted, options = {}) {
  const encodedListId = encodeURIComponent(listId);
  const baseTasksUrl = `${GRAPH_BASE}/me/todo/lists/${encodedListId}/tasks`;

  let rawTasks;
  let needsSubResourceFetch = false;

  const expandParams = `$expand=checklistItems,linkedResources&$top=${PAGE_SIZE}`;
  const preferredUrl = includeCompleted
    ? `${baseTasksUrl}?${expandParams}`
    : `${baseTasksUrl}?$filter=${encodeURIComponent("status ne 'completed'")}&${expandParams}`;

  try {
    rawTasks = await fetchAllPages(preferredUrl, accessToken, options);
  } catch (err) {
    if (err.status !== 400) {
      throw err;
    }

    // Fallback 1: if combining $filter + $expand returned 400, try $expand only and filter client-side
    if (!includeCompleted) {
      try {
        rawTasks = await fetchAllPages(`${baseTasksUrl}?${expandParams}`, accessToken, options);
      } catch (expandErr) {
        if (expandErr.status !== 400) {
          throw expandErr;
        }
        rawTasks = await fetchAllPages(`${baseTasksUrl}?$top=${PAGE_SIZE}`, accessToken, options);
        needsSubResourceFetch = true;
      }
    } else {
      // Fallback 2: if $expand itself returned 400, fetch bare tasks then sub-resources
      rawTasks = await fetchAllPages(`${baseTasksUrl}?$top=${PAGE_SIZE}`, accessToken, options);
      needsSubResourceFetch = true;
    }
  }

  // Always enforce the completed filter client-side as a safeguard
  const filteredTasks = includeCompleted
    ? rawTasks
    : rawTasks.filter((task) => task.status !== "completed");

  const tasks = [];
  for (const rawTask of filteredTasks) {
    const encodedTaskId = encodeURIComponent(rawTask.id);
    const taskCopy = { ...rawTask };

    if (needsSubResourceFetch) {
      const [checklistItems, linkedResources] = await Promise.all([
        fetchAllPages(
          `${baseTasksUrl}/${encodedTaskId}/checklistItems`,
          accessToken,
          options
        ),
        fetchAllPages(
          `${baseTasksUrl}/${encodedTaskId}/linkedResources`,
          accessToken,
          options
        ),
      ]);
      taskCopy.checklistItems = checklistItems;
      taskCopy.linkedResources = linkedResources;
    }

    let attachments = [];
    let attachmentsUnavailable = false;
    if (taskCopy.hasAttachments) {
      try {
        attachments = await fetchAllPages(
          `${baseTasksUrl}/${encodedTaskId}/attachments`,
          accessToken,
          options
        );
      } catch (attErr) {
        if (attErr instanceof AuthExpiredError) {
          throw attErr;
        }
        // Personal accounts occasionally reject attachment metadata reads (401/403 accessDenied)
        // on older or email-linked tasks; skip attachment details rather than aborting the export.
        console.warn("Skipping unavailable attachment metadata for task:", rawTask.id, attErr);
        attachmentsUnavailable = true;
      }
    }

    tasks.push(cleanTask(taskCopy, attachments, { attachmentsUnavailable }));
  }

  return tasks;
}

/**
 * Export every list and task (plus checklist items, linked resources, and attachment metadata).
 */
export async function exportAllTodos({
  accessToken,
  includeCompleted,
  onProgress = () => {},
  fetchImpl = fetch,
  sleepImpl = defaultSleep,
}) {
  const options = { fetchImpl, sleepImpl };

  onProgress({
    phase: "lists",
    currentIndex: 0,
    totalLists: 0,
    listName: "",
  });

  const rawLists = await fetchAllPages(
    `${GRAPH_BASE}/me/todo/lists?$top=${PAGE_SIZE}`,
    accessToken,
    options
  );

  const exportedLists = [];
  let totalTasks = 0;
  let totalAttachments = 0;
  let tasksWithUnavailableAttachments = 0;

  for (let i = 0; i < rawLists.length; i += 1) {
    const rawList = rawLists[i];
    onProgress({
      phase: "tasks",
      currentIndex: i + 1,
      totalLists: rawLists.length,
      listName: rawList.displayName || "Untitled list",
    });

    const tasks = await fetchTasksForList(rawList.id, accessToken, includeCompleted, options);
    totalTasks += tasks.length;
    for (const task of tasks) {
      totalAttachments += task.attachments.length;
      if (task.attachmentsUnavailable) {
        tasksWithUnavailableAttachments += 1;
      }
    }

    exportedLists.push(cleanList(rawList, tasks));
  }

  return {
    exportedAt: new Date().toISOString(),
    includeCompleted: Boolean(includeCompleted),
    notes: {
      groupsIncluded: false,
      attachmentContentsIncluded: false,
    },
    summary: {
      listCount: exportedLists.length,
      taskCount: totalTasks,
      attachmentCount: totalAttachments,
      tasksWithUnavailableAttachments,
    },
    lists: exportedLists,
  };
}

function defaultSleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function safeEndpointPath(rawUrl) {
  try {
    const parsed = new URL(rawUrl);
    return parsed.pathname.replace(/^\/v1\.0/, "");
  } catch {
    return rawUrl;
  }
}
