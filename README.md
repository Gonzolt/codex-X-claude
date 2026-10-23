# Codex x Claude

A personal Windows desktop workspace for Codex and Claude Code, with a retro browser frame, pale blue wallpaper, tilted keycap lettering, and two live agent panels.

The interface is yours to change. There is no hosted application service and no API-key entry screen. Agents run as local processes and use their supported account authentication. Provider access and subscription limits still apply.

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
| Both · build + review | Codex implements the request, then the controller sends its summary and the original task to Claude for a read-only review of the actual files. |
| Both · explore in parallel | Both agents investigate at the same time without editing files. Their output streams into separate panels. |
| Codex or Claude · build | Only the selected agent works on the task. |
| Codex or Claude · read-only explore | The selected agent investigates without editing files. |

The first version uses one writer at a time. Parallel exploration and Claude's review have read-only restrictions; this version does not merge simultaneous implementations or create Git worktrees. The handoff is managed by application code, rather than unrestricted agent-to-agent chat.

Commands, tool calls, messages, and implementation/review handoffs appear in the activity view. File changes can be inspected in **changes**, including staged, unstaged, deleted, renamed, and new files. Each agent has a stop control; **stop working** stops both.

## Customize the interface

**Make it yours** changes the accent, wallpaper, and message size. Settings and the recent activity display are saved locally.

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

Electron runs with context isolation and renderer sandboxing. The renderer cannot execute arbitrary commands. Native processes are launched without a shell; only the explicit sign-in action opens a PowerShell terminal. External links are restricted to the repository and official setup guides.

Codex uses its workspace-write sandbox for build tasks and its read-only sandbox for exploration. Its supported command/file approval requests appear in the app. Claude uses the SDK's normal permission mode, with tool requests routed to the app; the app does not load project or user hooks/settings into Claude's SDK session. Read-only Claude tasks are limited to reading and searching. These are agent permission boundaries, not a separate OS sandbox for all of Claude's execution.

Recent activity can contain source code, prompts, and command output. The app stores up to 500 recent events and appearance preferences in Electron's local user-data directory (`%APPDATA%/codex-x-claude/workspace.json` in this version). It does not store API keys or authentication tokens there. Full command-output events are not persisted. The agent tools manage their own credentials and session files.

Conversation context is retained for each agent during the current desktop session. Reopening the application restores the activity display; it starts fresh agent conversations. Switching folders or selecting **new session** also starts fresh conversations.

## Verification and current limits

```powershell
npm test
npm run build
```

Controller and Git integration tests cover streaming message assembly, implementation/review handoffs, concurrent exploration, stop behavior, approvals, invalid input, and staged/unstaged/untracked file previews. Desktop smoke checks exercise the real Electron bridge, project picker, appearance persistence, changes dialog, and compact layout. The Codex app-server handshake and ChatGPT account detection were checked without sending a model prompt.

This first version has not yet completed a live Claude task or a live two-agent task: Claude Code must be installed and signed in on the machine to verify those paths. Provider versions may change their event/permission schemas. Unsupported Codex input requests return an explicit error rather than automatically granting access. Claude asks interactive questions in its response rather than opening a questionnaire dialog.

The portable build is unsigned. No deployment, telemetry service, or cloud storage is configured by this application.
