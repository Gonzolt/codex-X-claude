# Codex x Claude

A personal Windows desktop workspace for Codex and Claude Code, with a retro browser frame, pale blue wallpaper, tilted keycap lettering, and two live agent panels.

The interface is yours to change. There is no hosted application service and no API-key entry screen. Agents run as local processes and use their supported account authentication. Provider access and subscription limits still apply.

## Workspace tabs

The browser-style tab strip has three independent spaces:

- **Codex × Claude** keeps the saved coding chats, agent collaboration, approvals and Git previews.
- **Editing** connects to a local checkout of [MotionKit](https://github.com/Gonzolt/motionkit). Select that folder, choose a film, and describe your edit. Pick **ChatGPT / Codex**, **Claude**, or **both**. Single-agent mode edits with the selected agent; both mode lets Codex edit and Claude review/request fixes with the existing bounded repair loop. The agents work on the actual MotionKit files. Use **open live preview** to inspect the result in MotionKit's own player/scrubber. MotionKit remains a separate project; its private source is neither bundled nor copied into this repository. The artwork in the tab is an illustration, not an embedded film preview.
- **Faceless** connects to the existing free local video workflow. Select the folder containing `automatic.py`, `commons_footage.py`, and its installed `.venv`. Enter a topic, choose reflection/fiction/factual mode and a scene count, then choose **make my video**. Factual mode requires checked notes and source links. The tab shows live production output, can stop the video process tree, and opens the completed MP4 or its files/credits folder.

Faceless uses the selected workflow's local Ollama scriptwriter and Piper voice, with key-free Wikimedia Commons footage. Run that workflow's `01_SETUP.cmd` and `04_SETUP_LOCAL_AI.cmd` once if needed. The workflow and its downloaded models are separate from this desktop application's install. Existing local installations stay in place. No paid voice service or automatic publishing is enabled.

Studio folders are saved locally, independently of coding projects and chats. Switching tabs preserves an unfinished video brief and keeps an active render running. Closing the app asks before stopping active work. A MotionKit preview server serves only project assets on a local loopback port and closes with the desktop app.

### Prompting an edit

1. Open **Editing** and select your standalone MotionKit folder.
2. Choose an existing film, or request a new film when the project has none.
3. Type the change in **what would you like to change?** and choose your editor.
4. Select **make the edit** or press Ctrl+Enter. Follow progress and answer any permission/input requests. **Stop edit** cancels that editing task.
5. Open the live preview and inspect the changed film. New films are discovered after the task finishes.

The ChatGPT option uses the application's existing native **Codex** connection;
it does not automate the ChatGPT website or introduce another API-key service.
Claude uses the existing Claude Code connection. Account access/usage limits apply.
Editing has its own saved chats, drafts, native sessions and approval mode.
Coding and editing agent tasks run one at a time to avoid competing writes.
Film creation and exports still depend on MotionKit's tools/assets being installed;
the agent must verify a render before reporting a successful export.

## First launch

1. Install [Codex CLI](https://developers.openai.com/codex/cli) and [Claude Code](https://code.claude.com/docs/en/setup) using their official installers. On Windows, use their native executables; PowerShell/npm `.cmd` shims alone are not supported by this first version.
2. Sign in with `codex login` and `claude auth login`. Choose the subscription account you want to use. The app does not collect or copy account credentials.
3. Launch the Windows executable, or run from source below.
4. Open **connections**, then **refresh connections**. You can also open each installed agent's own sign-in terminal from here.
5. Select a trusted project with **open project**, write a task, and choose who receives it.

An account must include access to its coding agent. Browser access to a free chat account does not necessarily provide that access. If you install a CLI while the app is open, restart the app if refreshing cannot find it.

## Working modes

| Selection | Behavior |
| --- | --- |
| Both · build + review | Codex implements, then Claude reviews the actual files. Actionable findings return to Codex for repair, with a maximum of three review passes. |
| Both · explore in parallel | Both agents investigate at the same time without editing files. Their output streams into separate panels. |
| Codex or Claude · build | Only the selected agent works on the task. |
| Codex or Claude · read-only explore | The selected agent investigates without editing files. |

The first version uses one writer at a time. Parallel exploration and Claude's review have read-only restrictions; this version does not merge simultaneous implementations or create Git worktrees. The handoff is managed by application code, rather than unrestricted agent-to-agent chat.

Commands, tool calls, messages, and implementation/review handoffs appear in the activity view. File changes can be inspected in **changes**, including staged, unstaged, deleted, renamed, and new files. Each agent has a stop control; **stop working** stops both.

Small live status lines describe thinking, reading, researching, editing, using tools, and writing with a little personality. They follow actual protocol/tool events; they do not expose private reasoning or invent research activity while waiting. A waiting reviewer gets a handoff status.

## Saved chats

Every launch starts a fresh empty chat. Previous chats stay in the sidebar, with their messages, project and native sessions intact. Unsent chat drafts save automatically too; reopening an older chat restores its draft. Your last project stays selected for the new chat.

Closing waits for the final save, including the latest text in the composer. A second close cannot bypass that save. If writing fails, the window stays open and offers a retry. Opening the program again while it is already running brings the existing window forward and starts a new chat when no coding task is active; it does not start a second writer against the same history file.

Use **new chat** for a different subject. The previous chat stays in the **saved chats** sidebar, titled from its first task. Select an older chat to restore its project, messages, and each agent's native session. Chats save automatically on this computer and survive app restarts. Each chat keeps up to 500 recent events; the native agents manage their full session history. Switching collaboration modes in the same project retains agent context.

Chat switching and starting a new subject are disabled during a running task. When work is idle, the composer shows a **start a new chat** shortcut. Unsent drafts stay with their chat and return after restarting. Old activity from version 0.1.1 is migrated into a saved chat; native session IDs cannot be recovered retroactively for that old activity.

## Customize the interface

The **dark mode** button beside **open project** switches the whole interface between light and dark themes. Your selection is saved across app restarts. **Make it yours** changes the accent, wallpaper, and message size in either theme. Settings and the recent activity display are saved locally.

- `src/main.tsx`: layout, panels, dialogs, and controls.
- `src/styles.css`: colors, type, spacing, window chrome, and keycap styling.
- `src/wallpaper.css`: original SVG wallpaper, embedded locally.
- `electron/agents.cjs`: Codex app-server and Claude Agent SDK adapters.
- `electron/coordinator.cjs`: task routing, stop controls, and approvals.
- `electron/workspace.cjs`: Git status and file previews.
- `electron/preload.cjs`: the small bridge between the UI and desktop process.

## Run from source

Use Node.js 22.12+ or 24+ and Git on Windows.

```powershell
npm ci
npm run dev
```

The root `postinstall` downloads the pinned Electron runtime explicitly. This is
required by the Electron 45 package; the package alone does not install its binary.

For a production run:

```powershell
npm run build
npm start
```

Build a portable Windows executable:

```powershell
npm run dist
```

The executable is written to `release/`. `npm run pack` creates an unpacked desktop app for testing. Dependencies are pinned in `package-lock.json`.

`npm run dev:web` is an interface preview only. It cannot run local agents or open local project folders.

## Permissions and local data

Electron runs with context isolation and renderer sandboxing. The renderer cannot execute arbitrary commands. Native processes are launched without a shell; only the explicit sign-in action opens a PowerShell terminal. External links are restricted to the repository, official setup guides, and an explicitly requested pending HTTPS authorization page.

Codex uses its workspace-write sandbox for build tasks and its read-only sandbox for exploration. Its command/file approval requests appear in the app. Claude uses the SDK's normal permission mode, with tool requests routed to the app; the app does not load project or user hooks/settings into Claude's SDK session. Read-only Claude tasks are limited to reading and searching, including web research. These are agent permission boundaries, not a separate OS sandbox for all of Claude's execution.

The **auto-approve** toggle approves tool commands, edits, and simple consent forms for this chat until you switch chats or restart the app. It starts off, does not turn off read-only restrictions, and does not answer actual questions or complete browser sign-ins. Pending permissions also offer **allow for this chat**. **Stop** remains available. Codex MCP input forms and both agents' supported question requests can be answered in the app, with schema validation.

Chat activity can contain source code and prompts. The app stores chats, native session identifiers, project paths, and appearance preferences in Electron's local user-data directory (`%APPDATA%/codex-x-claude/workspace.json`). It does not store API keys or authentication tokens there. Full command-output events are not persisted. The agent tools manage their own credentials and session files; resuming requires those native session files to remain available.

## Verification and current limits

```powershell
npm test
npm run build
npm run test:desktop
npm run test:chats
npm run test:editing
```

`test:desktop` uses an isolated profile and generated MotionKit/Git fixtures; it
does not sign in or start coding-agent turns. It captures light, dark and compact
layout screenshots under `.cache/`. With an installed faceless workflow available,
`npm run test:desktop -- --live-faceless` also runs a real two-scene local video
through the native IPC controls. That optional check uses network access for
Commons footage, without paid services. See `REVIEW.md` for this change's verified
bug fixes and remaining integration limits.

`test:editing` uses generated test films and fixture agents to verify native UI
submission for all three editor choices. `npm run test:editing -- --live` runs
small real file edits with the locally signed-in agents instead; it uses their
existing account access and consumes their usage allowance. Neither mode edits
the user's real MotionKit project. The live check only approves direct Write/Edit
requests for the generated fixture file and declines other approval requests.

27 automated tests cover history migration and persistence, saved native session restoration across modes, chat switching protection, activity classification, auto-approval versus actual questions, MCP inputs, bounded review/repair, Claude completion/disconnection, streaming, stop controls, Codex sandbox values, and Git previews. Isolated Electron UI checks exercise saved chats and drafts, live statuses, permission and question dialogs, restart persistence, dark/light themes, and compact layout. Earlier native connection checks confirmed both agents respond using subscription sign-ins.

Live checks closed and restored each native agent session, then verified that both retained a marker from the previous message. A native read-only Claude request also returned the expected structured review verdict. A complete repair/review loop on a real coding task remains covered by controller tests. Provider versions may change their event/permission schemas. Unsupported Codex request types return an explicit error. Claude turns finish on the SDK result event instead of waiting indefinitely for subsequent background messages.

The portable build is unsigned. No deployment, telemetry service, or cloud storage is configured by this application.
