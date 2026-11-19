import test from "node:test";
import assert from "node:assert/strict";
import { AuthExpiredError, exportAllTodos, parseRetryAfterMs } from "../public/js/todo.js";

function jsonResponse(body, { status = 200, headers = {} } = {}) {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: new Headers(headers),
    async json() {
      return body;
    },
  };
}

test("parseRetryAfterMs handles seconds, invalid values, and clamping", () => {
  assert.equal(parseRetryAfterMs("3", 0), 3000);
  assert.equal(parseRetryAfterMs("0", 0), 500);
  assert.equal(parseRetryAfterMs("120", 0), 30_000);
  assert.equal(parseRetryAfterMs(null, 1), 2000);
});

test("exportAllTodos paginates lists & tasks, strips @odata keys, and includes attachment metadata only", async () => {
  const calls = [];
  const progressEvents = [];

  const routes = new Map([
    [
      "https://graph.microsoft.com/v1.0/me/todo/lists?$top=100",
      jsonResponse({
        "@odata.nextLink": "https://graph.microsoft.com/v1.0/me/todo/lists?page=2",
        value: [
          {
            "@odata.etag": "etag-1",
            id: "list-1",
            displayName: "Tasks",
            isOwner: true,
            isShared: false,
            wellknownListName: "defaultList",
          },
        ],
      }),
    ],
    [
      "https://graph.microsoft.com/v1.0/me/todo/lists?page=2",
      jsonResponse({
        value: [
          {
            id: "list-2",
            displayName: "Groceries",
            isOwner: true,
            isShared: true,
            wellknownListName: "none",
          },
        ],
      }),
    ],
    [
      "https://graph.microsoft.com/v1.0/me/todo/lists/list-1/tasks?$filter=status%20ne%20'completed'&$expand=checklistItems,linkedResources&$top=100",
      jsonResponse({
        value: [
          {
            "@odata.etag": "task-etag",
            id: "task-1",
            title: "Renew passport",
            status: "notStarted",
            importance: "high",
            isReminderOn: true,
            categories: ["Travel"],
            body: { content: "Bring two photos", contentType: "text" },
            hasAttachments: true,
            checklistItems: [
              {
                "@odata.type": "#microsoft.graph.checklistItem",
                id: "chk-1",
                displayName: "Print form",
                isChecked: true,
              },
            ],
            linkedResources: [
              {
                id: "lnk-1",
                webUrl: "https://travel.state.gov",
                applicationName: "Web",
                displayName: "Passport Info",
              },
            ],
          },
        ],
      }),
    ],
    [
      "https://graph.microsoft.com/v1.0/me/todo/lists/list-1/tasks/task-1/attachments",
      jsonResponse({
        value: [
          {
            "@odata.type": "#microsoft.graph.taskFileAttachment",
            id: "att-1",
            name: "application.pdf",
            contentType: "application/pdf",
            size: 102400,
            lastModifiedDateTime: "2026-10-01T12:00:00Z",
            contentBytes: "BASE64_SHOULD_BE_EXCLUDED",
          },
        ],
      }),
    ],
    [
      "https://graph.microsoft.com/v1.0/me/todo/lists/list-2/tasks?$filter=status%20ne%20'completed'&$expand=checklistItems,linkedResources&$top=100",
      jsonResponse({
        value: [
          {
            id: "task-2",
            title: "Coffee beans",
            status: "notStarted",
            importance: "normal",
            hasAttachments: false,
            checklistItems: [],
            linkedResources: [],
          },
        ],
      }),
    ],
  ]);

  const fetchImpl = async (url) => {
    calls.push(url);
    const res = routes.get(url);
    if (!res) {
      throw new Error(`Unexpected URL: ${url}`);
    }
    return res;
  };

  const result = await exportAllTodos({
    accessToken: "test-token",
    includeCompleted: false,
    onProgress: (ev) => progressEvents.push(ev),
    fetchImpl,
    sleepImpl: async () => {},
  });

  assert.equal(result.includeCompleted, false);
  assert.deepEqual(result.notes, {
    groupsIncluded: false,
    attachmentContentsIncluded: false,
  });
  assert.deepEqual(result.summary, {
    listCount: 2,
    taskCount: 2,
    attachmentCount: 1,
  });

  const firstTask = result.lists[0].tasks[0];
  assert.equal(firstTask.title, "Renew passport");
  assert.equal(firstTask.body.content, "Bring two photos");
  assert.equal("@odata.etag" in firstTask, false);
  assert.equal("@odata.type" in firstTask.checklistItems[0], false);
  assert.deepEqual(firstTask.attachments, [
    {
      id: "att-1",
      name: "application.pdf",
      contentType: "application/pdf",
      size: 102400,
      lastModifiedDateTime: "2026-10-01T12:00:00Z",
    },
  ]);
  // Verify attachment endpoint was NOT called for task-2 (hasAttachments: false)
  assert.equal(
    calls.some((u) => u.includes("task-2/attachments")),
    false
  );
  assert.equal(progressEvents[0].phase, "lists");
  assert.equal(progressEvents[1].listName, "Tasks");
  assert.equal(progressEvents[2].listName, "Groceries");
});

test("exportAllTodos falls back cleanly on HTTP 400 from combined $filter + $expand and retries HTTP 429", async () => {
  let taskAttempts = 0;
  const sleeps = [];

  const fetchImpl = async (url) => {
    if (url.endsWith("/me/todo/lists?$top=100")) {
      return jsonResponse({
        value: [{ id: "list-a", displayName: "Work", isOwner: true, isShared: false }],
      });
    }

    if (url.includes("$filter=") && url.includes("$expand=")) {
      return jsonResponse({ error: { message: "Filter with expand unsupported" } }, { status: 400 });
    }

    if (url.endsWith("/lists/list-a/tasks?$expand=checklistItems,linkedResources&$top=100")) {
      taskAttempts += 1;
      if (taskAttempts === 1) {
        return jsonResponse({}, { status: 429, headers: { "Retry-After": "1" } });
      }
      return jsonResponse({
        value: [
          { id: "open-1", title: "Open task", status: "notStarted", hasAttachments: false },
          { id: "done-1", title: "Done task", status: "completed", hasAttachments: false },
        ],
      });
    }

    throw new Error(`Unexpected URL: ${url}`);
  };

  const result = await exportAllTodos({
    accessToken: "test-token",
    includeCompleted: false,
    fetchImpl,
    sleepImpl: async (ms) => sleeps.push(ms),
  });

  assert.deepEqual(sleeps, [1000]);
  assert.equal(result.summary.taskCount, 1);
  assert.equal(result.lists[0].tasks[0].id, "open-1");
});

test("exportAllTodos throws AuthExpiredError on HTTP 401", async () => {
  const fetchImpl = async () => jsonResponse({}, { status: 401 });

  await assert.rejects(
    () =>
      exportAllTodos({
        accessToken: "expired-token",
        includeCompleted: true,
        fetchImpl,
        sleepImpl: async () => {},
      }),
    AuthExpiredError
  );
});
