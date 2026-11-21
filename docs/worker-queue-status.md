# Worker Queue & Job Status Reference

> **Last updated:** 2026-03-28  
> **Resolves:** GitHub issue #480 — "Document worker queue capabilities vs placeholders"

---

## ⚠️ Critical Notice — No Queue Infrastructure Exists

SocialFlow **does not currently have a worker queue**. There is no Bull, BullMQ, Redis, or any other queue backend in this codebase. Features described in the README under "Soroban-Powered Smart Campaigns" and "Automated Engagement Distribution" are **not implemented**.

The sections below document every action that appears queue-like or async in the UI, with an honest status for each.

---

## Job / Action Status Table

| Job Type | Status | Expected Output | Side Effects |
|---|---|---|---|
| `generate_caption` | ✅ Real | AI-generated caption string from Gemini 2.5 Flash | Calls Google Generative AI API; consumes API quota |
| `generate_reply` | ✅ Real | Array of up to 3 suggested reply strings from Gemini 2.5 Flash | Calls Google Generative AI API; consumes API quota |
| `schedule_post` | ⚠️ Stub | `console.log` of post data + browser `alert()` | Clears the draft from `localStorage`; navigates to Calendar view. **No post is dispatched anywhere.** |
| `export_analytics_report` | ⚠️ Stub | Browser `alert("Downloading report as PDF...")` | `console.log` only. No file is generated or downloaded. |
| `mark_message_important` | ⚠️ Stub | `console.log("Marked as important")` | No state change, no persistence. |
| `attach_file_to_message` | ⚠️ Stub | `console.log("Attaching file...")` | No file is attached or uploaded. |
| `view_all_activity_history` | ⚠️ Stub | `console.log("Showing full history log...")` | No navigation or data fetch occurs. |
| `calendar_date_click` | ⚠️ Stub | `console.log("Clicked date: ...")` | No action taken. |
| `dashboard_export_data` | ⚠️ Stub | Browser `alert('Exporting data...')` | No file produced. |
| `dashboard_refresh` | ⚠️ Stub | Browser `alert('Refreshing...')` | No data is re-fetched; all dashboard stats are hardcoded. |
| `media_rename` | ⚠️ Stub | Browser `alert('Editing name...')` | Filename is not changed. |
| `settings_persist` | ⚠️ Stub | Toggle state held in React `useState` | Settings are **not** written to disk or any store; they reset on page reload. |
| `stellar_wallet_connect` | ❌ Not implemented | — | No Stellar SDK, Freighter, or Albedo integration exists in the codebase. |
| `soroban_smart_campaign` | ❌ Not implemented | — | No Soroban RPC calls exist. |
| `nft_mint` | ❌ Not implemented | — | No IPFS/Pinata calls exist. |
| `ipc_main_handler` | ❌ Not implemented | — | `electron/main.js` has no `ipcMain.on` listeners. The preload bridge exposes `sendMessage` but messages are never received. |

---

## Per-Job Details

### `generate_caption` ✅ Real

Calls `GoogleGenAI.models.generateContent` with model `gemini-2.5-flash`.

**Required env vars:**
- `API_KEY` — Google Generative AI API key (set in `.env.local`)

**External dependencies:**
- `@google/genai` npm package
- Network access to `generativelanguage.googleapis.com`

**Error behaviour:** On API failure, returns the string `"Error generating caption. Please check your API key."` — no exception is thrown to the caller.

---

### `generate_reply` ✅ Real

Calls `GoogleGenAI.models.generateContent` with model `gemini-2.5-flash`. Splits the response on newlines and returns up to 3 items.

**Required env vars:**
- `API_KEY` — Google Generative AI API key

**External dependencies:** Same as `generate_caption`.

**Error behaviour:** On API failure, returns a hardcoded fallback array: `["Thank you!", "We'll get back to you shortly.", "Could you provide more details?"]`

---

### `schedule_post` ⚠️ Stub — returns placeholder data, no queue job dispatched

`handleSchedule` in `components/CreatePost.tsx` wraps a `setTimeout(..., 1000)` to simulate latency, then:
1. Logs `{ caption, selectedPlatforms, mediaFile, scheduleDate, scheduleTime }` to the browser console.
2. Calls `handleClearDraft()` which removes `socialflow-draft` from `localStorage`.
3. Shows a browser `alert("Post scheduled successfully! Check console for details.")`.
4. Navigates to the Calendar view.

**No post is sent to any social platform. No job is enqueued.**

**Required env vars:** None (stub).  
**External dependencies:** None (stub).

---

### Analytics / Dashboard stats ⚠️ Stub — all data is hardcoded

All metrics shown in `Dashboard.tsx` and `Analytics.tsx` (followers, engagement rate, reach, watch time, chart data, audience age, territories, best posting times) are **static hardcoded arrays** defined at the top of each file. The "Best Posting Times" heatmap uses `Math.random()` on every render.

**No analytics API is called. No real data is fetched.**

---

### Settings toggles ⚠️ Stub — in-memory only

All four toggles in `Settings.tsx` (Dark Mode, Email Notifications, Public Profile, Auto-Update) are backed by `useState`. They reset to `true` on every page load. The Account section buttons (Profile Settings, Integrations, Billing, etc.) have no `onClick` handlers and do nothing.

---

### Stellar / Soroban / NFT / IPFS ❌ Not implemented

Despite being described in the README, none of the following exist in the codebase:
- Stellar SDK (`@stellar/stellar-sdk` or `stellar-sdk`)
- Freighter or Albedo wallet adapter
- Soroban RPC client
- Pinata or any IPFS client
- Any blockchain transaction logic

These are planned features (see `.kiro/specs/stellar-web3-integration/`).

---

## Electron IPC ❌ Not implemented

`electron/preload.js` exposes `window.electronAPI.sendMessage(channel, data)` for the `"toMain"` channel. However, `electron/main.js` contains **no `ipcMain.on` listeners**. Any call to `window.electronAPI.sendMessage` is silently dropped.

---

## SSE Ticket Service

Server-Sent Events (SSE) connections are authenticated with short-lived, single-use tickets rather than long-lived credentials. The implementation lives in [`backend/src/services/sseTicketService.ts`](../backend/src/services/sseTicketService.ts).

### Ticket issuance

- A ticket is a random 24-byte value rendered as a hex string.
- Tickets are short-lived: each one carries a TTL and is intended to be redeemed once, immediately after issuance.
- A ticket is consumed on first use; a second attempt to redeem the same ticket is rejected.

### Ticket storage

- Tickets are held in an in-memory `Map` inside the service module.
- The map is **per process**. There is no shared store (no Redis, no database) backing it.

### Ticket sweeping

- A periodic interval removes expired entries from the map.
- The interval is `unref`'d so it does not keep the Node.js event loop alive on its own.

### Multi-replica consequence

Because tickets are held per process, a ticket issued by one replica is **not** visible to any other replica. In a multi-replica deployment, a client that obtains a ticket from replica A and then opens the SSE connection against replica B will have the ticket rejected. Operators seeing SSE failures immediately after a rollout or behind a load balancer should check whether ticket issuance and connection handling are landing on the same process.

> Changing ticket storage to a shared store is tracked separately and is out of scope for this document.

---

## Environment Variables Summary

| Variable | Required by | Status |
|---|---|---|
| `API_KEY` | `generate_caption`, `generate_reply` | Required for AI features to work |
| `PINATA_SECRETS` | IPFS/NFT upload | Not implemented yet |

All other env vars mentioned in the README (Stellar RPC endpoints, wallet configs) have no corresponding code.

---

## See Also

- [`docs/README.md`](README.md) — index of all project documentation
