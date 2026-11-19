# Setup Guide: Microsoft Entra ID & Netlify Deployment

This guide walks through registering your own Microsoft Entra ID application (for read-only Microsoft To Do access) and deploying this project on Netlify.

---

## Part 1: Microsoft Entra ID App Registration

You do **not** need a paid Azure subscription to register an application in Microsoft Entra ID.

### 1. Open App Registrations
1. Sign in to the [Microsoft Entra admin center](https://entra.microsoft.com) (or [Azure Portal](https://portal.azure.com) and search for **App registrations**).
2. In the left sidebar, go to **Identity** → **Applications** → **App registrations** (in Azure Portal: **Microsoft Entra ID** → **App registrations**).

### 2. Register a New Application
1. Click **+ New registration**.
2. **Name:** Enter a name users will recognize on the Microsoft consent screen (for example, `Microsoft To Do Exporter`).
3. **Supported account types:** Choose:
   > **Accounts in any organizational directory (Any Microsoft Entra ID tenant - Multitenant) and personal Microsoft accounts (e.g. Skype, Xbox)**

   This lets both personal Microsoft accounts (`@outlook.com`, `@hotmail.com`, `@live.com`) and work/school Microsoft 365 accounts sign in using the same `/common` endpoint.
4. **Redirect URI (important!):**
   - In the platform dropdown, select **Single-page application (SPA)**.
     - **Do NOT choose "Web"** — the "Web" platform does not allow browser CORS requests to Microsoft's token endpoint for PKCE.
   - Enter `http://localhost:8888/` for local testing with `netlify dev`.
5. Click **Register**.

### 3. Copy Your Application (Client) ID
1. On the **Overview** page of your new app registration, copy the **Application (client) ID** (a GUID like `12345678-abcd-1234-ef00-1234567890ab`).
2. **Do NOT create a Client Secret** under *Certificates & secrets*. Browser PKCE flows do not use a client secret, which also means you never have to rotate expiring secrets.

### 4. Add Read-Only To Do Permissions
1. In the left menu, click **API permissions**.
2. Click **+ Add a permission** → **Microsoft Graph** → **Delegated permissions**.
3. Search for `Tasks`, expand **Tasks**, and check **`Tasks.Read`** (*Read user tasks*).
   - Leave `Tasks.ReadWrite` unchecked so the app remains strictly read-only.
4. Also ensure **`openid`** and **`profile`** are listed (under **OpenId permissions**) so the app can display your signed-in name.
5. Click **Add permissions**.
   - You do **not** need to click "Grant admin consent" for personal accounts or standard user-consented `Tasks.Read`.

### 5. Double-Check Authentication Settings
1. Go to **Authentication** in the left menu.
2. Confirm your redirect URI(s) are listed under **Single-page application**.
3. Scroll to **Implicit grant and hybrid flows** and make sure **both** checkboxes (`Access tokens` and `ID tokens`) remain **unchecked**.

> **Note about the "unverified" publisher badge:** Unless you verify your app through a Microsoft Partner Network (MPN) business account, Microsoft displays an *"unverified"* label under your app name on the consent screen. That is normal for personal and open-source tools—users can still click **Accept** to grant read-only access. Note that some strict corporate/school IT departments may block unverified third-party apps on work tenants.

---

## Part 2: Local Development

1. Copy the environment variable template:
   ```bash
   cp .env.example .env
   ```
2. Edit `.env` and replace the placeholder with your **Application (client) ID**:
   ```bash
   MS_CLIENT_ID=your-actual-application-client-id
   ```
3. Install dev dependencies (for Netlify Functions TypeScript types) and run Netlify Dev:
   ```bash
   npm install
   npx netlify dev
   ```
4. Open `http://localhost:8888/` in your browser.

---

## Part 3: Deploying to Netlify from GitHub

1. Push this repository to GitHub (e.g., `https://github.com/cfjedimaster/todoexport`).
2. In the [Netlify Dashboard](https://app.netlify.com), click **Add new site** → **Import an existing project** → **GitHub** and select your repository.
   - Netlify automatically reads `netlify.toml` (`publish = "public"`, functions in `netlify/functions/`). No build command is required.
3. Add the environment variable in Netlify:
   - Go to **Project configuration** → **Environment variables** → **Add a variable**.
   - Key: `MS_CLIENT_ID`
   - Value: your **Application (client) ID** from Part 1
   - Scopes: **Functions** (do not mark as secret—SPA client IDs are public values served to the browser via `/api/config`).
   - Trigger a deploy (or push a commit) so the function picks up the variable.
4. **Add your live Netlify URL to Microsoft Entra ID:**
   - Copy your deployed Netlify site URL (for example, `https://your-site-name.netlify.app/` — include the trailing slash!).
   - Return to Microsoft Entra ID → your App Registration → **Authentication** → **Single-page application** → **Add URI**.
   - Paste `https://your-site-name.netlify.app/` (and any custom domain you add later, with a trailing slash) and click **Save**.
5. Visit your live Netlify site and test signing in and exporting `todo-export.json`!
