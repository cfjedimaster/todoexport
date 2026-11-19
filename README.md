# Microsoft To Do Exporter

A minimal, single-purpose web app that exports all of your **Microsoft To Do** lists and tasks into a single `todo-export.json` file.

## How It Works (and Privacy)

- **Strictly read-only:** Requests only `Tasks.Read` (plus `openid` and `profile` to display your signed-in name). It cannot create, modify, or delete any lists or tasks.
- **Runs entirely in your browser:** After signing in via Microsoft's OAuth 2.0 Authorization Code Flow with PKCE, your browser fetches your lists and tasks directly from Microsoft Graph and builds `todo-export.json` locally. No task data or tokens are ever sent to or stored on a backend server.
- **Zero frontend frameworks:** Plain HTML, CSS, and vanilla JavaScript ES modules. A single tiny Netlify Function (`netlify/functions/config.mts`) exists solely to expose the public `MS_CLIENT_ID` environment variable at `/api/config`.

## What's Included in `todo-export.json`

- Every To Do list (`id`, `displayName`, `isOwner`, `isShared`, `wellknownListName`)
- Every task in each list (optionally excluding `completed` tasks), including:
  - Title, note `body`, status, importance, categories, reminder settings, recurrence, and all timestamps
  - `checklistItems` (subtasks / steps)
  - `linkedResources` (external source links)
  - `attachments` **metadata only** (`id`, `name`, `contentType`, `size`, `lastModifiedDateTime`)

### Known Limitations

- **List groups are not included:** Microsoft Graph does not expose To Do list groups/folders, so all lists are exported as a flat collection.
- **File attachment contents are not downloaded:** Only attachment metadata (file name, MIME type, size, timestamp) is included so the exported JSON file stays fast and manageable.

## Running & Deploying Your Own Copy

See [SETUP.md](./SETUP.md) for the complete step-by-step walkthrough covering Microsoft Entra ID app registration, local development with `netlify dev`, and deploying to Netlify.

## Credits

Built by [Raymond Camden](https://www.raymondcamden.com).
