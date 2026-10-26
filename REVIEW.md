# Tabs and bug review

The changes extend `feat/retro-desktop`, where the existing application lives.
`main` currently contains only the initial README. MotionKit remains independent;
this public repository contains no private MotionKit implementation or media.

## Verified fixes

1. **Late agent callbacks crossed chat boundaries.** A client retained its event
   callback after `fresh()` or `selectChat()`, and that callback wrote to whichever
   chat was active. Event and approval callbacks now require both the original
   chat and the current client instance. A regression test reproduced the old
   transcript contamination and now passes.
2. **Stopping Codex could leave the app busy indefinitely.** Stop relied on a
   later `turn/completed` notification even after an interrupt was acknowledged.
   A bounded grace timer now closes a nonresponsive client, rejects pending work,
   and allows the coordinator to settle. Normal completion clears the timer.
   The missing-notification test timed out before the fix and passes afterward.
3. **Git previews survived project switches.** The renderer kept the selected
   file and its old diff, and accepted responses from older requests. Project
   changes now clear that selection and invalidate outstanding requests. The
   native Electron check switches between two Git repositories and verifies that
   the previous diff disappears.
4. **A fresh source install had no Electron binary.** The pinned Electron 45
   npm package has no automatic install script. The new root `postinstall`
   explicitly runs its `install-electron` command. The runtime was downloaded
   and the real desktop UI launched successfully.

## Validation

- Production TypeScript check and Vite build pass.
- All 35 automated tests pass, including existing collaboration, saved chats,
  approval handling, native adapter contracts and Git previews.
- Studio tests cover separate MotionKit discovery, asset-only loopback preview,
  native argument boundaries, notes cleanup, cancellation and validated outputs.
- Isolated native Electron checks pass for all three tabs, light/dark themes,
  compact layout, video brief retention, project switching, settings persistence,
  MotionKit preview routing and invalid video input rejection.
- A real two-scene faceless job completed through native IPC, using the existing
  local model, Piper narration, live Commons footage search/download and MP4
  export. The result's video and output-folder actions resolved successfully.

The new MotionKit launcher was tested with a generated standalone project
fixture. This change does not verify all MotionKit films, voice engines or export
commands on Windows; those stay in the separate MotionKit project. No live
Codex/Claude subscription turns were started during this review. Adapter and
coordinator behavior was tested with protocol/client fixtures, not a fresh
end-to-end coding-agent session. This original tab review does not claim that the application
is free of all bugs.

## Prompt editing update (0.3.0)

The Editing tab now has an independent saved editing chat, a prompt box and
ChatGPT/Codex, Claude, and both-agent choices. The selected MotionKit root and
film are supplied to the agent as task context without changing the coding
workspace's project, transcript or permissions. Both mode edits with Codex and
reviews with Claude, with fixes returned to Codex. Competing coding/editing agent
tasks are rejected. Editing prompts, sessions and permissions save independently.

Validation on this PC: all 44 automated tests pass, along with the production
TypeScript/Vite build and native chat/desktop checks. The Editing UI was checked
in light, dark and compact layouts. Native checks verified all three selectors,
actual fixture-file changes, separate history, draft retention and close saving.
The optional live check also passed with the signed-in native Codex and Claude
clients: Codex edited the generated file, Claude edited it, and Codex edited it
again with a completed structured Claude review. These were small generated test
files, with no private MotionKit code, uploads, paid API calls or real film export.
