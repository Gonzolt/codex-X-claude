import React, { useCallback, useEffect, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { ArrowRight, ArrowUpRight, Asterisk, Check, ChevronDown, CircleHelp, Code2, Columns2, Command, ExternalLink, FileCode2, FileDiff, Folder, FolderOpen, GitBranch, GitFork as Github, History, Link2, MessageSquare, Minus, Monitor, Moon, MoreHorizontal, Palette, Plus, RefreshCw, Settings2, ShieldCheck, Sparkles, Square, SquareTerminal, Sun, X } from 'lucide-react';
import type { Activity, Agent, Appearance, Changes, Desktop, Result, Status, Workspace } from './types';
import './styles.css';
import './dark.css';

const INITIAL: Workspace = {
  project: null, events: [], appearance: { accent: 'mint', theme: 'light', pattern: true, fontSize: 14 },
  agents: { codex: { installed: false, signedIn: false }, claude: { installed: false, signedIn: false } },
  status: { codex: 'idle', claude: 'idle' }, busy: false, approvals: []
};
const NAMES = { codex: 'Codex', claude: 'Claude' };
const STATUS: Record<Status, string> = { idle: 'standing by', working: 'working', waiting: 'up next', approval: 'needs approval', done: 'finished', stopped: 'stopped', error: 'needs attention' };
const time = (date: number) => new Date(date).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
const projectName = (folder: string | null) => folder?.split(/[\\/]/).filter(Boolean).at(-1) || 'untitled workspace';

// A browser preview renders the real UI, but never pretends to run agents.
function browserBridge(): Desktop {
  let state = structuredClone(INITIAL);
  const listeners = new Set<(state: Workspace) => void>();
  const unavailable = async () => ({ ok: false as const, error: 'Open the desktop application to connect your agents and select a local project.' });
  return {
    getState: async () => ({ ok: true, value: state }), chooseProject: unavailable, refresh: unavailable,
    start: unavailable, stop: unavailable, approve: unavailable, signIn: unavailable, fresh: unavailable,
    changes: async () => ({ ok: true, value: { files: [], isGit: false } }), diff: unavailable,
    appearance: async value => { state = { ...state, appearance: value }; listeners.forEach(fn => fn(state)); return { ok: true, value: undefined }; },
    openLink: unavailable, window: unavailable,
    subscribe: fn => { listeners.add(fn); return () => { listeners.delete(fn); }; }
  };
}
const desktop = window.desktop || browserBridge();

function Keycaps({ text, small = false }: { text: string; small?: boolean }) {
  return <span className={`keycaps ${small ? 'small' : ''}`} aria-label={text}>{[...text].map((letter, i) => <span aria-hidden="true" key={i} style={{ '--tilt': `${[ -7, 3, -3, 6, -4, 3, -5, 5 ][i % 8]}deg` } as React.CSSProperties}>{letter}</span>)}</span>;
}
function AgentMark({ agent, size = 28 }: { agent: Agent; size?: number }) {
  return agent === 'claude' ? <Asterisk size={size} strokeWidth={2.3} className="claude-mark" /> : <Command size={size - 3} strokeWidth={1.9} className="codex-mark" />;
}
function EmptyArt({ agent }: { agent: Agent }) {
  return <div className={`empty-art ${agent}`} aria-hidden="true">
    <span className="art-spark a">✧</span><span className="art-spark b">+</span><span className="art-spark c">✦</span>
    <div className="art-shadow" /><div className="art-window"><div className="art-bar"><span /><span /><span /></div><div className="art-screen"><AgentMark agent={agent} size={52} /></div></div>
    <span className="art-cursor"><ArrowUpRight size={23} /></span>
  </div>;
}

function AgentPanel({ agent, workspace, onConnect, onStop }: { agent: Agent; workspace: Workspace; onConnect(): void; onStop(): void }) {
  const connection = workspace.agents[agent], status = workspace.status[agent];
  const events = workspace.events.filter(e => e.agent === agent || e.agent === 'you');
  const scroll = useRef<HTMLDivElement>(null), following = useRef(true);
  useEffect(() => { if (following.current && scroll.current) scroll.current.scrollTop = scroll.current.scrollHeight; }, [workspace.events]);
  const running = status === 'working' || status === 'approval';
  return <section className={`agent-panel ${agent}`} aria-label={`${NAMES[agent]} panel`}>
    <header className="agent-header">
      <div className="agent-identity"><span className={`agent-avatar ${agent}`}><AgentMark agent={agent} /></span><div><h2>{NAMES[agent]}<span className="agent-number">0{agent === 'codex' ? '1' : '2'}</span></h2><p>{agent === 'codex' ? 'the builder' : 'the second perspective'}</p></div></div>
      <div className="agent-header-actions"><span className={`status ${status}`}><i />{STATUS[status]}</span>{running ? <button className="icon-button" title={`Stop ${NAMES[agent]}`} aria-label={`Stop ${NAMES[agent]}`} onClick={onStop}><Square size={13} fill="currentColor" /></button> : <button className="icon-button" title={`${NAMES[agent]} connection`} aria-label={`${NAMES[agent]} connection`} onClick={onConnect}><MoreHorizontal size={19} /></button>}</div>
    </header>
    <div className="agent-body" ref={scroll} onScroll={() => { const el = scroll.current; if (el) following.current = el.scrollHeight - el.scrollTop - el.clientHeight < 60; }}>
      {events.length === 0 ? <div className="agent-empty"><EmptyArt agent={agent} /><h3>{agent === 'codex' ? 'big ideas, meet code.' : 'a fresh pair of eyes.'}</h3><p>{agent === 'codex' ? 'Ready for the next thing you want to make.' : 'Here to think it through with you.'}</p><button className="connection-chip" onClick={onConnect}><i className={connection.signedIn ? 'connected' : ''} />{connection.signedIn ? 'signed in locally' : connection.installed ? 'check connection' : 'connect account'}<ArrowUpRight size={12} /></button></div> : <div className="messages">{events.map(event => <EventMessage key={event.id} event={event} />)}</div>}
    </div>
    <footer className="agent-footer"><span><span className={`tiny-dot ${connection.signedIn ? 'green' : ''}`} />{connection.installed ? connection.signedIn ? 'local session' : 'sign-in needed' : 'not connected'}</span><span>{events.filter(e => e.kind === 'tool').length} tool calls<Code2 size={13} /></span></footer>
  </section>;
}

function EventMessage({ event }: { event: Activity }) {
  if (event.kind === 'tool' || event.kind === 'output') return <details className="tool-event"><summary><SquareTerminal size={13} /><span>{event.kind === 'tool' ? event.text.slice(0, 110) : 'command output'}</span><ChevronDown size={12} /></summary><pre>{event.text}</pre></details>;
  return <article className={`message ${event.agent === 'you' ? 'user' : ''} ${event.kind}`}><div className="message-meta"><span>{event.agent === 'you' ? 'you' : event.agent === 'system' ? 'workspace' : NAMES[event.agent]}</span><time>{time(event.time)}</time></div><div className="message-content">{event.text}{event.streaming && <span className="typing-caret" />}</div></article>;
}

function App() {
  const [workspace, setWorkspace] = useState<Workspace>(INITIAL);
  const [prompt, setPrompt] = useState('');
  const [target, setTarget] = useState<Agent | 'both'>('both');
  const [mode, setMode] = useState<'build' | 'compare'>('build');
  const [view, setView] = useState<'workspace' | 'activity'>('workspace');
  const [modal, setModal] = useState<'connections' | 'appearance' | 'changes' | null>(null);
  const [toast, setToast] = useState('');
  const [refreshing, setRefreshing] = useState(false);
  const [sending, setSending] = useState(false);
  const [changed, setChanged] = useState<Changes>({ files: [], isGit: false });
  const [selectedFile, setSelectedFile] = useState('');
  const [diff, setDiff] = useState('');
  const textarea = useRef<HTMLTextAreaElement>(null), diffRequest = useRef(0);
  const notify = useCallback((message: string) => setToast(message), []);
  const invoke = useCallback(async <T,>(promise: Promise<Result<T>>): Promise<T | undefined> => {
    try { const result = await promise; if (!result.ok) { notify(result.error); return; } return result.value; }
    catch (error) { notify(error instanceof Error ? error.message : 'Something went wrong.'); }
  }, [notify]);
  useEffect(() => {
    let alive = true;
    const unsubscribe = desktop.subscribe(state => { if (alive) setWorkspace({ ...state, events: [...state.events] }); });
    invoke(desktop.getState()).then(state => { if (state && alive) setWorkspace(state); });
    return () => { alive = false; unsubscribe(); };
  }, [invoke]);
  useEffect(() => { if (toast) { const id = setTimeout(() => setToast(''), 7000); return () => clearTimeout(id); } }, [toast]);
  useEffect(() => {
    document.documentElement.dataset.theme = workspace.appearance.theme;
    document.documentElement.dataset.accent = workspace.appearance.accent;
    document.documentElement.dataset.pattern = String(workspace.appearance.pattern);
    document.documentElement.style.setProperty('--message-size', workspace.appearance.fontSize + 'px');
  }, [workspace.appearance]);
  const refreshChanges = useCallback(async () => { const result = await invoke(desktop.changes()); if (result) setChanged(result); }, [invoke]);
  useEffect(() => { refreshChanges(); }, [workspace.project, workspace.busy, refreshChanges]);
  useEffect(() => {
    const listener = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setModal(null);
      if ((event.ctrlKey || event.metaKey) && event.key === 'k') { event.preventDefault(); textarea.current?.focus(); }
    };
    window.addEventListener('keydown', listener); return () => window.removeEventListener('keydown', listener);
  }, []);
  async function submit() {
    if (!prompt.trim() || workspace.busy || sending) return;
    setSending(true);
    const result = await invoke(desktop.start({ prompt, target, mode }));
    if (result) { setWorkspace(result); setPrompt(''); setView('workspace'); }
    setSending(false);
  }
  async function refresh() { setRefreshing(true); await invoke(desktop.refresh()); setRefreshing(false); }
  async function showDiff(name: string) {
    const request = ++diffRequest.current;
    setSelectedFile(name); setDiff('Loading changes…');
    const result = await invoke(desktop.diff(name));
    if (request === diffRequest.current) setDiff(result || 'Preview unavailable.');
  }
  async function appearance(patch: Partial<Appearance>) { await invoke(desktop.appearance({ ...workspace.appearance, ...patch })); }
  const activity = workspace.events.filter(e => e.agent === 'system' || ['tool', 'change', 'error', 'prompt'].includes(e.kind));
  const connected = Object.values(workspace.agents).filter(agent => agent.signedIn).length;

  return <div className="desktop-shell">
    <div className="window-titlebar"><div className="window-title"><span className="mini-app-icon"><Columns2 size={11} /></span>codex x claude<span className="title-version">/ a shared workspace</span></div><div className="window-buttons"><button aria-label="Minimize" onClick={() => invoke(desktop.window('minimize'))}><Minus size={12} /></button><button aria-label="Maximize" onClick={() => invoke(desktop.window('maximize'))}><Square size={10} /></button><button className="close-window" aria-label="Close window" onClick={() => invoke(desktop.window('close'))}><X size={12} /></button></div></div>
    <div className="browser-toolbar"><div className="toolbar-arrows"><button className="icon-button" title="Workspace" aria-label="Go to workspace" onClick={() => setView('workspace')}><ArrowRight size={17} className="back-arrow" /></button><button className="icon-button" title="Refresh connections" aria-label="Refresh connections" disabled={workspace.busy || refreshing} onClick={refresh}><RefreshCw size={14} className={refreshing ? 'spin' : ''} /></button></div><div className="address-bar"><ShieldCheck size={12} /><span>local://<b>codex-x-claude</b>/{workspace.project ? projectName(workspace.project) : 'workspace'}</span><span className="address-local">on your computer</span></div><button className="toolbar-github" aria-label="Open GitHub repository" title="GitHub repository" onClick={() => invoke(desktop.openLink('repository'))}><Github size={16} /></button><span className="toolbar-light amber" /><span className="toolbar-light mint">+</span></div>
    <div className="app-body">
      <aside className="sidebar">
        <button className="sidebar-brand" onClick={() => setView('workspace')}><span className="brand-symbol"><Columns2 size={23} /></span><span>better<br /><b>together.</b></span><span className="brand-star">✳</span></button>
        <div className="sidebar-section-label">YOUR LITTLE CORNER</div>
        <nav aria-label="Main navigation"><button className={view === 'workspace' ? 'nav-item active' : 'nav-item'} onClick={() => setView('workspace')}><Columns2 size={16} />workspace<span className="nav-key">1</span></button><button className={view === 'activity' ? 'nav-item active' : 'nav-item'} onClick={() => setView('activity')}><History size={16} />activity{activity.length > 0 && <span className="nav-count">{activity.length}</span>}</button><button className="nav-item" onClick={() => { setModal('changes'); refreshChanges(); }}><FileDiff size={16} />changes<span className="nav-count">{changed.files.length}</span></button></nav>
        <div className="sidebar-divider" /><div className="sidebar-section-label">PROJECT</div>
        <button className="project-button" disabled={workspace.busy} onClick={() => invoke(desktop.chooseProject())}><Folder size={17} /><span>{workspace.project ? projectName(workspace.project) : 'open a folder'}<small>{workspace.project ? 'local project' : 'make yourself at home'}</small></span><Plus size={13} /></button>
        <button className="new-session" disabled={workspace.busy || workspace.events.length === 0} onClick={() => invoke(desktop.fresh())}><Plus size={13} />new session</button>
        <div className="sidebar-bottom"><div className="connection-note"><div><span className={`tiny-dot ${connected ? 'green' : ''}`} /><span>{connected}/2 agents connected</span></div><button onClick={() => setModal('connections')}>manage connections<ArrowUpRight size={12} /></button></div><button className="nav-item" onClick={() => setModal('appearance')}><Palette size={16} />make it yours</button><button className="nav-item" onClick={() => setModal('connections')}><Settings2 size={16} />connections</button><div className="made-for-you"><Monitor size={12} />your machine. your rules.<span>♡</span></div></div>
      </aside>
      <main className="workspace-main">
        <header className="workspace-heading"><div className="heading-crumb"><span className="tiny-dot green" />a place to make things</div><div className="headline-row"><div className="headline"><Keycaps text="codex" /><span className="headline-cross">×</span><Keycaps text="claude" /></div><div className="heading-actions"><button className="bevel-button theme-toggle" aria-label="Dark mode" aria-pressed={workspace.appearance.theme === 'dark'} title={workspace.appearance.theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'} onClick={() => appearance({ theme: workspace.appearance.theme === 'dark' ? 'light' : 'dark' })}>{workspace.appearance.theme === 'dark' ? <Sun size={14} /> : <Moon size={14} />}<span>{workspace.appearance.theme === 'dark' ? 'light mode' : 'dark mode'}</span></button><button className="bevel-button open-project" disabled={workspace.busy} onClick={() => invoke(desktop.chooseProject())}><FolderOpen size={15} />{workspace.project ? 'switch project' : 'open project'}<ArrowUpRight size={13} /></button></div></div><div className="heading-subrow"><p>two minds. one workspace. whatever you’re imagining.</p><span className="version-badge">v0.1 <span>✧</span></span></div></header>
        {view === 'workspace' ? <>
          <div className="workspace-subbar"><div><Columns2 size={13} /><span>side by side</span><span className="subbar-separator">/</span><span className="muted">{workspace.project ? projectName(workspace.project) : 'a fresh start'}</span></div><button onClick={() => setModal('connections')}><Link2 size={13} />local accounts<ArrowUpRight size={12} /></button></div>
          <div className="agent-grid"><AgentPanel agent="codex" workspace={workspace} onConnect={() => setModal('connections')} onStop={() => invoke(desktop.stop('codex'))} /><div className="bridge-badge" title="Connected by your workspace"><Link2 size={15} /></div><AgentPanel agent="claude" workspace={workspace} onConnect={() => setModal('connections')} onStop={() => invoke(desktop.stop('claude'))} /></div>
          <section className="shared-strip"><div className="shared-label"><span className="shared-symbol"><MessageSquare size={14} /></span>the handoff<span className="live-label"><i />{workspace.busy ? 'live' : 'shared'}</span></div><div className="shared-last">{[...workspace.events].reverse().find(e => e.kind === 'handoff')?.text || 'Good things happen when they put their heads together.'}</div><button aria-label="View shared activity" title="View shared activity" onClick={() => setView('activity')}><ArrowUpRight size={16} /></button></section>
        </> : <section className="activity-page"><header><div><History size={20} /><h2>the whole picture.</h2></div><span>{activity.length} events</span></header><p className="activity-description">Tasks, tools, and handoffs, as they happen.</p>{activity.length ? <div className="activity-list">{activity.map(event => <div className={`activity-row ${event.kind}`} key={event.id}><span className="activity-time">{time(event.time)}</span><span className={`activity-agent ${event.agent}`}>{event.agent}</span><span className="activity-detail">{event.text}</span></div>)}</div> : <div className="activity-empty"><History size={37} strokeWidth={1} /><h3>every little step, right here.</h3><p>Send a task and watch the workspace come to life.</p></div>}</section>}
        <section className="composer"><div className="composer-heading"><Sparkles size={15} /><label htmlFor="task-prompt">what are we making?</label><span><kbd>ctrl</kbd><kbd>K</kbd></span></div><textarea ref={textarea} id="task-prompt" placeholder="An idea, a tricky bug, a ‘what if’…" value={prompt} onChange={event => setPrompt(event.target.value)} maxLength={32000} onKeyDown={event => { if ((event.ctrlKey || event.metaKey) && event.key === 'Enter') { event.preventDefault(); submit(); } }} /><div className="composer-footer"><div className="composer-options"><div className="target-picker" aria-label="Choose agents">{(['both', 'codex', 'claude'] as const).map(agent => <button key={agent} aria-pressed={target === agent} className={target === agent ? 'selected' : ''} onClick={() => setTarget(agent)}>{agent === 'both' ? <><Columns2 size={12} />both</> : <><AgentMark agent={agent} size={13} />{agent}</>}</button>)}</div><span className="option-divider" /><label className="mode-picker"><select aria-label="Collaboration mode" value={mode} onChange={event => setMode(event.target.value as 'build' | 'compare')}><option value="build">{target === 'both' ? 'build + review' : 'build'}</option><option value="compare">{target === 'both' ? 'explore in parallel' : 'read-only explore'}</option></select><ChevronDown size={12} /></label></div>{workspace.busy ? <button className="bevel-button stop-button" onClick={() => invoke(desktop.stop())}><Square size={11} fill="currentColor" />stop working</button> : <button className="bevel-button send-button" disabled={!prompt.trim() || sending} onClick={submit}>{sending ? 'starting…' : 'let’s go'}<ArrowRight size={16} /></button>}</div></section>
        <div className="workspace-bottom"><span><ShieldCheck size={12} />{mode === 'compare' ? 'read-only exploration' : 'you approve actions that need permission'}</span><span>send with <kbd>ctrl</kbd> + <kbd>enter</kbd></span></div>
      </main>
    </div>
    <footer className="window-statusbar"><span><span className={`tiny-dot ${workspace.busy ? 'amber' : 'green'}`} />{workspace.busy ? 'a little work in progress…' : 'all quiet. ready when you are.'}</span><span><GitBranch size={12} />{workspace.project ? projectName(workspace.project) : 'no project selected'}<span className="footer-divider" />built to be yours<ArrowUpRight size={11} /></span></footer>

    {modal && <div className="modal-backdrop" onClick={() => setModal(null)}><section className={`retro-dialog ${modal === 'changes' ? 'wide' : ''}`} role="dialog" aria-modal="true" aria-labelledby="dialog-title" onClick={event => event.stopPropagation()}><header className="dialog-titlebar"><h2 id="dialog-title">{modal === 'connections' ? 'a few introductions.' : modal === 'appearance' ? 'make yourself at home.' : 'what’s changed.'}</h2><button className="close-window" aria-label="Close dialog" onClick={() => setModal(null)}><X size={14} /></button></header><div className="dialog-content">
      {modal === 'connections' && <><p className="dialog-intro">Your local agents. Your existing accounts.<br /><span>No API keys to paste here.</span></p>{(['codex', 'claude'] as const).map(agent => <div className="connection-card" key={agent}><div className="connection-card-title"><span className={`agent-avatar ${agent}`}><AgentMark agent={agent} /></span><div><h3>{NAMES[agent]}{agent === 'claude' && ' Code'}</h3><p>{workspace.agents[agent].signedIn ? 'signed in · ready to work' : workspace.agents[agent].installed ? 'installed · sign-in needed' : 'not installed yet'}</p></div><i className={`connection-led ${workspace.agents[agent].signedIn ? 'on' : ''}`} /></div><div className="connection-card-actions">{workspace.agents[agent].installed ? <button className="bevel-button" disabled={workspace.busy} onClick={async () => { const result = await invoke(desktop.signIn(agent)); if (result) notify(result); }}><Link2 size={13} />{workspace.agents[agent].signedIn ? 'sign in again' : 'sign in'}<ArrowUpRight size={12} /></button> : <button className="bevel-button" onClick={() => invoke(desktop.openLink(agent))}>installation guide<ExternalLink size={12} /></button>}<span>{workspace.agents[agent].version || (agent === 'claude' ? 'uses your Claude plan' : 'uses your ChatGPT plan')}</span></div></div>)}<div className="connection-help"><CircleHelp size={16} /><p>Sign-in opens the agent’s own terminal and browser. After you finish, refresh below. Your plan’s access and limits apply.</p></div><button className="bevel-button refresh-button" disabled={refreshing || workspace.busy} onClick={refresh}><RefreshCw size={14} className={refreshing ? 'spin' : ''} />{refreshing ? 'checking…' : 'refresh connections'}</button></>}
      {modal === 'appearance' && <><p className="dialog-intro">A little more you.</p><div className="appearance-field"><label>the accent</label><div className="swatches">{(['mint', 'lavender', 'peach'] as const).map(accent => <button key={accent} aria-label={`${accent} accent`} aria-pressed={workspace.appearance.accent === accent} className={`swatch ${accent}`} onClick={() => appearance({ accent })}>{workspace.appearance.accent === accent && <Check size={18} />}</button>)}</div></div><div className="appearance-field"><label htmlFor="pattern-toggle">a little wallpaper<small>the soft blue shapes in the background</small></label><button id="pattern-toggle" role="switch" aria-checked={workspace.appearance.pattern} className={`toggle ${workspace.appearance.pattern ? 'on' : ''}`} onClick={() => appearance({ pattern: !workspace.appearance.pattern })}><span /></button></div><div className="appearance-field"><label htmlFor="font-size">message size</label><select id="font-size" className="retro-select" value={workspace.appearance.fontSize} onChange={event => appearance({ fontSize: Number(event.target.value) })}>{[13, 14, 15, 16].map(size => <option key={size} value={size}>{size}px</option>)}</select></div><div className="appearance-preview"><Keycaps text="hello" small /><p>your workspace, your way.</p></div><button className="bevel-button refresh-button" onClick={() => appearance(INITIAL.appearance)}>back to the original</button></>}
      {modal === 'changes' && <><div className="changes-heading"><p>{changed.isGit ? `${changed.files.length} changed files in this project` : workspace.project ? 'Open a Git repository to see its changes.' : 'Open a project to see its changes.'}</p><button className="icon-button" title="Refresh changes" aria-label="Refresh changes" onClick={refreshChanges}><RefreshCw size={15} /></button></div>{changed.files.length ? <div className="diff-layout"><div className="changed-files">{changed.files.map(file => <button key={file.path} className={selectedFile === file.path ? 'selected' : ''} onClick={() => showDiff(file.path)}><FileCode2 size={14} /><span>{file.path}</span><b>{file.status}</b></button>)}</div><pre className="diff-preview">{selectedFile ? diff : 'Select a file to look a little closer.'}</pre></div> : <div className="changes-empty"><FileDiff size={36} strokeWidth={1} /><h3>a clean slate.</h3><p>File changes will appear here.</p></div>}</>}
    </div></section></div>}
    {workspace.approvals.length > 0 && <div className="modal-backdrop approval-backdrop"><section className="retro-dialog" role="dialog" aria-modal="true" aria-labelledby="approval-title"><header className="dialog-titlebar"><h2 id="approval-title">a quick check with you.</h2><ShieldCheck size={16} /></header><div className="dialog-content"><p className="dialog-intro">{NAMES[workspace.approvals[0].agent]} wants to {workspace.approvals[0].title}.</p><pre className="approval-detail">{workspace.approvals[0].detail}</pre><div className="approval-actions"><button className="bevel-button" onClick={() => invoke(desktop.approve(workspace.approvals[0].id, false))}>decline</button><button className="bevel-button send-button" onClick={() => invoke(desktop.approve(workspace.approvals[0].id, true))}>allow this action<Check size={14} /></button></div></div></section></div>}
    {toast && <div className="toast" role="status"><span>{toast}</span><button aria-label="Dismiss notification" onClick={() => setToast('')}><X size={14} /></button></div>}
  </div>;
}

createRoot(document.getElementById('root')!).render(<React.StrictMode><App /></React.StrictMode>);
