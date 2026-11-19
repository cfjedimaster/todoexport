import test from "node:test";
import assert from "node:assert/strict";
import {
  buildHtmlExport,
  escapeHtml,
  extractNoteText,
  formatDateValue,
  formatFileSize,
  sanitizeHttpUrl,
} from "../public/js/html-export.js";

test("escapeHtml escapes all dangerous HTML characters", () => {
  assert.equal(
    escapeHtml(`<script>alert("x" & 'y')</script>`),
    "&lt;script&gt;alert(&quot;x&quot; &amp; &#39;y&#39;)&lt;/script&gt;"
  );
});

test("sanitizeHttpUrl allows http/https and rejects javascript/data URLs", () => {
  assert.equal(sanitizeHttpUrl("https://example.com/a?b=1"), "https://example.com/a?b=1");
  assert.equal(sanitizeHttpUrl("http://example.com"), "http://example.com/");
  assert.equal(sanitizeHttpUrl("javascript:alert(1)"), null);
  assert.equal(sanitizeHttpUrl("data:text/html,<script>alert(1)</script>"), null);
  assert.equal(sanitizeHttpUrl("not a url"), null);
});

test("extractNoteText preserves plain text and strips scripts/tags from HTML notes", () => {
  assert.equal(
    extractNoteText({ content: "Line 1\r\nLine 2", contentType: "text" }),
    "Line 1\nLine 2"
  );
  assert.equal(
    extractNoteText({
      content: "<p>First &amp; second</p><script>alert(1)</script><p>Third<br>Fourth</p>",
      contentType: "html",
    }),
    "First & second\nThird\nFourth"
  );
});

test("formatDateValue keeps midnight UTC due dates on the exact calendar day", () => {
  const formatted = formatDateValue(
    { dateTime: "2026-11-24T00:00:00.0000000", timeZone: "UTC" },
    { dateOnly: true, locale: "en-US" }
  );
  assert.equal(formatted, "Nov 24, 2026");
});

test("formatFileSize formats bytes, KB, and MB", () => {
  assert.equal(formatFileSize(512), "512 B");
  assert.equal(formatFileSize(2048), "2.0 KB");
  assert.equal(formatFileSize(1_572_864), "1.5 MB");
});

test("buildHtmlExport generates a clean, XSS-safe standalone HTML document", () => {
  const sample = {
    exportedAt: "2026-11-19T18:30:00.000Z",
    includeCompleted: true,
    summary: { listCount: 2, taskCount: 2, attachmentCount: 1, tasksWithUnavailableAttachments: 0 },
    lists: [
      {
        id: "l1",
        displayName: "Work <Urgent>",
        isOwner: true,
        isShared: true,
        tasks: [
          {
            id: "t1",
            title: "Ship <script>alert(1)</script> report",
            status: "notStarted",
            importance: "high",
            isReminderOn: true,
            categories: ["Q4"],
            body: { content: "Remember to double-check totals & charts.", contentType: "text" },
            createdDateTime: "2026-11-10T14:00:00Z",
            dueDateTime: { dateTime: "2026-11-25T00:00:00.0000000", timeZone: "UTC" },
            reminderDateTime: { dateTime: "2026-11-24T15:00:00.0000000", timeZone: "UTC" },
            hasAttachments: true,
            checklistItems: [
              { id: "c1", displayName: "Verify numbers", isChecked: true },
              { id: "c2", displayName: "Email team", isChecked: false },
            ],
            linkedResources: [
              { displayName: "Good Link", webUrl: "https://example.com/report" },
              { displayName: "Bad Link", webUrl: "javascript:alert(1)" },
            ],
            attachments: [
              { name: "budget.pdf", contentType: "application/pdf", size: 4096 },
            ],
          },
        ],
      },
      {
        id: "l2",
        displayName: "Groceries",
        isOwner: true,
        isShared: false,
        tasks: [
          {
            id: "t2",
            title: "Buy espresso beans",
            status: "completed",
            importance: "normal",
            isReminderOn: false,
            categories: [],
            body: null,
            completedDateTime: { dateTime: "2026-11-18T00:00:00.0000000", timeZone: "UTC" },
            hasAttachments: false,
            checklistItems: [],
            linkedResources: [],
            attachments: [],
          },
        ],
      },
    ],
  };

  const html = buildHtmlExport(sample, { locale: "en-US" });

  assert.match(html, /^<!doctype html>/i);
  assert.match(html, /Work &lt;Urgent&gt;/);
  assert.match(html, /Ship &lt;script&gt;alert\(1\)&lt;\/script&gt; report/);
  assert.doesNotMatch(html, /<script>alert\(1\)<\/script>/);
  assert.doesNotMatch(html, /javascript:alert/);
  assert.match(html, /https:\/\/example\.com\/report/);
  assert.match(html, /Nov 25, 2026/);
  assert.match(html, /Nov 18, 2026/);
  assert.match(html, /Verify numbers/);
  assert.match(html, /budget\.pdf/);
  assert.match(html, /href="#list-2"/);
  assert.match(html, /List groups are not included/);
});
