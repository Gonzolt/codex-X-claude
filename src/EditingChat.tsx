import { useEffect, useRef, useState } from 'react';
import { ArrowRight, Check, Link2, MessageSquare, Plus, ShieldCheck, Square } from 'lucide-react';
import type { Agent, Desktop, Result, Workspace } from './types';
import './editing.css';

export function EditingChat({ workspace, desktop, root, film, prompt, setPrompt, target, setTarget, update, report, codingBusy, onConnect }: {
  workspace: Workspace; desktop: Desktop; root: string | null; film: string | null;
  prompt: string; setPrompt(value: string): void; target: Agent | 'both'; setTarget(value: Agent | 'both'): void;
  update(state: Workspace): void; report(message: string): void; codingBusy: boolean; onConnect(): void;
}) {
  const [pending, setPending] = useState(false);
  const feed = useRef<HTMLDivElement>(null), following = useRef(true);
  useEffect(() => { if (following.current && feed.current) feed.current.scrollTop = feed.current.scrollHeight; }, [workspace.events]);
  useEffect(() => { following.current = true; }, [workspace.activeChatId]);
  const chats = workspace.chats.filter(chat => chat.project === root);
  // Why "make the edit" is off, in the order the user has to fix it; null when it can be pressed.
  const blocked = !root ? 'Choose your MotionKit folder above to start editing.'
    : codingBusy ? 'Finish the coding task before sending an edit.'
    : !prompt.trim() ? 'Describe the change above to make the edit.'
    : null;
  async function perform<T,>(action: Promise<Result<T>>) {
    try { const result = await action; if (!result.ok) { report(result.error); return; } return result.value; }
    catch (error) { report(error instanceof Error ? error.message : 'Could not complete this edit.'); }
  }
  async function submit() {
    if (!root || !prompt.trim() || workspace.busy || pending || codingBusy) return;
    setPending(true);
    const next = await perform(desktop.startEdit({ prompt, target, film }));
    if (next) { update(next); setPrompt(''); }
    setPending(false);
  }
  async function switchChat(id?: string) {
    if (workspace.activeChatId) await perform(desktop.setEditDraft(workspace.activeChatId, prompt));
    const next = await perform(id ? desktop.selectEditChat(id) : desktop.freshEdit());
    if (next) { update(next); setPrompt(next.draft); }
  }
  return <section className="editing-assistant" aria-label="MotionKit editing assistant">
    <header className="editing-assistant-heading"><MessageSquare size={15} /><h2>tell us the edit.</h2><button type="button" onClick={onConnect}><Link2 size={12} />accounts</button></header>
    <div className="editing-chat-picker"><select aria-label="Editing chat" value={chats.some(chat => chat.id === workspace.activeChatId) ? workspace.activeChatId : ''} disabled={workspace.busy || pending || !root} onChange={event => switchChat(event.target.value)}>{chats.length ? chats.map(chat => <option key={chat.id} value={chat.id}>{chat.title}</option>) : <option value="">new editing chat</option>}</select><button type="button" aria-label="New editing chat" title="New editing chat" disabled={!root || workspace.busy || pending} onClick={() => switchChat()}><Plus size={14} /></button></div>
    <div className="editing-conversation" ref={feed} aria-label="Editing conversation" onScroll={() => { const el = feed.current; if (el) following.current = el.scrollHeight - el.scrollTop - el.clientHeight < 50; }}>
      {workspace.events.length ? workspace.events.map(event => <article key={event.id} className={`editing-message ${event.agent}`}><b>{event.agent === 'you' ? 'you' : event.agent === 'system' ? 'editing desk' : event.agent === 'codex' ? 'Codex / ChatGPT' : 'Claude'}</b>{['tool', 'output'].includes(event.kind) ? <details><summary>{event.kind === 'tool' ? event.text.slice(0, 90) : 'command output'}</summary><pre>{event.text}</pre></details> : <p>{event.text}{event.streaming && <span className="typing-caret" />}</p>}</article>) : <div className="editing-chat-empty"><MessageSquare size={24} strokeWidth={1.2} /><p>A tighter cut, a new scene, a different rhythm.<br />Tell your editor what you have in mind.</p></div>}
    </div>
    {workspace.busy && <div className="editing-live" role="status">{(['codex', 'claude'] as const).filter(agent => !['idle', 'done'].includes(workspace.status[agent])).map(agent => <span key={agent}><i />{agent === 'codex' ? 'Codex' : 'Claude'} · {workspace.status[agent] === 'approval' ? 'needs your input' : workspace.activity[agent]?.kind || workspace.status[agent]}</span>)}</div>}
    <form onSubmit={event => { event.preventDefault(); submit(); }} className="editing-prompt-form">
      <label htmlFor="edit-prompt">what would you like to change?</label>
      <textarea id="edit-prompt" data-chat-id={workspace.activeChatId} aria-label="Editing prompt" value={prompt} maxLength={32000} disabled={pending} placeholder="Make the opening faster and give the final line a little more room…" onChange={event => setPrompt(event.target.value)} onKeyDown={event => { if ((event.ctrlKey || event.metaKey) && event.key === 'Enter') { event.preventDefault(); submit(); } }} />
      <div className="editing-targets" aria-label="Choose editing agents">{(['codex', 'claude', 'both'] as const).map(agent => <button type="button" key={agent} aria-pressed={target === agent} disabled={pending || workspace.busy} onClick={() => setTarget(agent)}>{target === agent && <Check size={11} />}{agent === 'codex' ? 'ChatGPT / Codex' : agent === 'claude' ? 'Claude' : 'both'}</button>)}</div>
      <p className="editing-mode-help">{target === 'both' ? 'Codex edits. Claude reviews and asks for fixes.' : target === 'codex' ? 'Uses your existing local Codex connection.' : 'Claude edits the selected MotionKit project.'}</p>
      <div className="editing-send-row"><button type="button" className="editing-consent" aria-label="Auto-approve editing actions" aria-pressed={workspace.approvalMode === 'auto'} onClick={() => perform(desktop.editApprovalMode(workspace.approvalMode === 'auto' ? 'ask' : 'auto'))}><ShieldCheck size={12} />{workspace.approvalMode === 'auto' ? 'auto-approve on' : 'ask before actions'}</button>{workspace.busy ? <button type="button" className="bevel-button stop-button" onClick={() => perform(desktop.stopEdit())}><Square size={11} fill="currentColor" />stop edit</button> : <button type="submit" className="bevel-button studio-primary" disabled={!!blocked || pending} title={blocked || undefined} aria-describedby={blocked ? 'edit-blocked' : undefined}>{pending ? 'starting…' : 'make the edit'}<ArrowRight size={14} /></button>}</div>
      {blocked && !workspace.busy && !pending && <p id="edit-blocked" className="editing-blocked" role="status">{blocked}</p>}
    </form>
  </section>;
}
