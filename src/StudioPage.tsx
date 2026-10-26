import { useState } from 'react';
import type { ReactNode } from 'react';
import { ArrowRight, ArrowUpRight, Check, Clapperboard, Download, ExternalLink, Film, FolderOpen, FolderOutput, Play, RefreshCw, RotateCcw, Sparkles, Square, Video } from 'lucide-react';
import type { Desktop, Result, StudioKind, Studios, VideoInput } from './types';
import './studios.css';

export const EMPTY_STUDIOS: Studios = { editing: { root: null, films: [] }, faceless: { root: null, job: { status: 'idle', stage: 'Ready when you are.', logs: [], video: null } } };

export function StudioPage({ kind, state, desktop, report, update, input, setInput, editingAssistant, editorBusy = false }: {
  kind: StudioKind; state: Studios; desktop: Desktop; report(message: string): void;
  update(state: Studios): void; input: VideoInput; setInput(value: VideoInput): void;
  editingAssistant?(film: string | null): ReactNode; editorBusy?: boolean;
}) {
  const [pending, setPending] = useState(false), [selected, setSelected] = useState('');
  const editing = kind === 'editing', root = state[kind].root, job = state.faceless.job;
  const running = job.status === 'running';
  const film = state.editing.films.find(item => item.id === selected)?.id || state.editing.films[0]?.id || '';
  async function perform<T,>(action: Promise<Result<T>>) {
    try { const result = await action; if (!result.ok) { report(result.error); return; } return result.value; }
    catch (error) { report(error instanceof Error ? error.message : 'Could not complete this action.'); }
  }
  async function choose() {
    setPending(true);
    const next = await perform(desktop.chooseStudio(kind));
    if (next) { update(next); setSelected(''); }
    setPending(false);
  }
  async function install() {
    setPending(true);
    const next = await perform(desktop.installMotionKit());
    if (next) { update(next); setSelected(''); }
    setPending(false);
  }
  const installing = editing && !!state.editing.installing;
  async function exportFolder(action: 'choose' | 'reset') {
    setPending(true);
    const next = await perform(desktop.exportFolder(action));
    if (next) update(next);
    setPending(false);
  }
  async function generate() {
    if (pending || running) return;
    setPending(true); const next = await perform(desktop.runFaceless(input));
    if (next) update(next); setPending(false);
  }
  return <div className={`studio-page ${kind}`}>
    <header className="studio-heading"><div className="heading-crumb"><span className="tiny-dot green" />{editing ? 'a studio of its own' : 'from a little idea to a finished video'}</div>
      <div className="studio-title-row"><div><h1>{editing ? 'motionkit' : 'faceless'}<span>.</span></h1><p>{editing ? 'make things move. on your own terms.' : 'one topic. a whole little film.'}</p></div><span className="studio-stamp">{editing ? <Clapperboard size={24} /> : <Video size={24} />}</span></div>
    </header>
    <div className="studio-scroll">
      <section className="studio-location"><div className="studio-location-label"><FolderOpen size={17} /><div><b>{editing ? 'your MotionKit project' : 'your video workflow'}</b><span title={root || undefined}>{root || (installing ? 'Downloading MotionKit from GitHub…' : editing ? 'MotionKit is not on this computer yet. Get it, or choose a checkout you already have.' : 'Choose the folder with 03_AUTOMATIC_VIDEO.cmd.')}</span></div></div>
        <div className="studio-location-actions">
          {editing && !root && <button className="bevel-button studio-primary" disabled={pending || installing || editorBusy} onClick={install}>{installing ? <RefreshCw size={13} className="spin" /> : <Download size={13} />}{installing ? 'downloading…' : 'get MotionKit'}</button>}
          <button className="bevel-button" disabled={pending || installing || (editing ? editorBusy : running)} onClick={choose}><FolderOpen size={13} />{pending && !installing ? 'opening…' : root ? 'change folder' : 'choose folder'}</button>
        </div>
      </section>
      {editing && root && <section className="studio-location export-location"><div className="studio-location-label"><FolderOutput size={17} /><div><b>where exports go</b><span title={state.editing.exportDir || undefined}>{state.editing.exportDir || 'MotionKit’s out/ folder (default). Choose any folder for finished videos.'}</span></div></div>
        <div className="studio-location-actions">
          <button className="bevel-button" onClick={() => perform(desktop.openStudio('editing', 'exports'))}><ArrowUpRight size={13} />open</button>
          {state.editing.exportDir && <button className="bevel-button" disabled={pending || editorBusy} title="Use MotionKit’s out/ folder again" onClick={() => exportFolder('reset')}><RotateCcw size={13} />default</button>}
          <button className="bevel-button" disabled={pending || editorBusy} onClick={() => exportFolder('choose')}><FolderOpen size={13} />{state.editing.exportDir ? 'change folder' : 'choose folder'}</button>
        </div>
      </section>}
      {editing ? <>
        <div className="motion-edit-layout">
        <section className="motion-workbench"><div className="motion-stage" aria-hidden="true"><div className="motion-grid" /><span className="motion-guide horizontal" /><span className="motion-guide vertical" /><span className="motion-corner top" /><span className="motion-corner bottom" /><div className="motion-word"><span>make</span><b>it move.</b></div><span className="motion-timecode">00:00:00 / your next idea</span><span className="motion-spark">✳</span></div>
          <div className="motion-film-picker"><label htmlFor="motion-film">the film</label><select id="motion-film" value={film} disabled={editorBusy || !state.editing.films.length} onChange={event => setSelected(event.target.value)}>{state.editing.films.length ? state.editing.films.map(item => <option key={item.id} value={item.id}>{item.brand} / {item.name}</option>) : <option value="">{root ? 'no films found' : 'select a MotionKit project first'}</option>}</select>
            <button className="bevel-button studio-primary" disabled={!film} onClick={() => perform(desktop.previewMotion(film))}><Play size={13} />open live preview<ArrowUpRight size={12} /></button></div>
        </section>
        {editingAssistant?.(film || null)}
        </div>
        <div className="studio-detail-grid"><section className="studio-note"><span className="studio-note-icon"><Film size={18} /></span><h2>its own creative space.</h2><p>Describe your changes to ChatGPT / Codex, Claude, or both. They edit the files in your standalone MotionKit project; open the preview to inspect the result.</p><button disabled={!root} onClick={() => perform(desktop.openStudio('editing', 'root'))}>open project folder<ArrowUpRight size={12} /></button></section>
          <section className="studio-note"><span className="studio-note-icon peach"><Clapperboard size={18} /></span><h2>plain code. real motion.</h2><p>Kinetic type, transitions, camera moves and frame-by-frame exports. Keep creating with the tools in your MotionKit project.</p><button onClick={() => perform(desktop.openLink('motionkit'))}>open MotionKit repository<ExternalLink size={12} /></button></section></div>
      </> : <>
        <div className="faceless-layout"><form className="video-brief" onSubmit={event => { event.preventDefault(); generate(); }}><div className="studio-section-title"><Sparkles size={16} /><h2>what’s the story?</h2><span>01 / the brief</span></div>
          <label htmlFor="video-topic">your topic</label><textarea id="video-topic" placeholder="A quiet moment beside the ocean…" maxLength={500} value={input.topic} disabled={running} onChange={event => setInput({ ...input, topic: event.target.value })} />
          <div className="brief-fields"><label>the kind of video<select aria-label="Video style" value={input.genre} disabled={running} onChange={event => setInput({ ...input, genre: event.target.value as VideoInput['genre'] })}><option value="reflection">personal reflection</option><option value="fiction">fictional story</option><option value="factual">facts from your notes</option></select></label><label>scenes<input type="number" aria-label="Number of scenes" min={1} max={20} value={input.scenes} disabled={running} onChange={event => setInput({ ...input, scenes: Number(event.target.value) })} /></label></div>
          {input.genre === 'factual' && <><label htmlFor="video-notes">checked facts & source links</label><textarea id="video-notes" className="video-notes" placeholder="Paste the facts you checked, with their source links." maxLength={16000} value={input.notes} disabled={running} onChange={event => setInput({ ...input, notes: event.target.value })} /><p className="brief-help">The script uses these notes. It does not research or verify facts for you.</p></>}
          <div className="free-note"><Check size={13} />local script + voice · free Commons footage</div>
          <button type="submit" className="bevel-button studio-primary generate-video" disabled={!root || !input.topic.trim() || pending || running || (input.genre === 'factual' && !input.notes.trim())}>{pending ? <RefreshCw size={14} className="spin" /> : <Sparkles size={14} />}{pending ? 'starting…' : 'make my video'}<ArrowRight size={14} /></button>
        </form>
          <section className={`video-progress ${job.status}`} aria-label="Video generation"><div className="studio-section-title"><Video size={16} /><h2>the production desk</h2><span>02 / the film</span></div>
            <div className="video-status-art" aria-hidden="true"><span className="video-reel"><Film size={34} strokeWidth={1.2} /></span><span className="video-status-spark">✧</span></div>
            <p className="video-stage" role="status">{job.stage}</p><p className="production-help">{job.status === 'done' ? 'Watch the full video, check the framing and keep its footage credits with your upload.' : 'Script → footage → local narration → captions → your MP4.'}</p>
            {running && <button className="bevel-button stop-button" type="button" onClick={() => perform(desktop.stopFaceless())}><Square size={11} fill="currentColor" />stop video</button>}
            {job.status === 'done' && <div className="video-result-actions"><button className="bevel-button studio-primary" onClick={() => perform(desktop.openStudio('faceless', 'video'))}><Play size={13} />watch video</button><button className="bevel-button" onClick={() => perform(desktop.openStudio('faceless', 'output'))}><FolderOpen size={13} />files & credits</button></div>}
            {job.logs.length > 0 && <details className="production-log" open={job.status === 'error'}><summary>production log <span>{job.logs.length} lines</span></summary><pre>{job.logs.join('\n')}</pre></details>}
          </section></div>
        <section className="studio-note workflow-note"><span className="studio-note-icon"><Check size={18} /></span><div><h2>ready for your final look.</h2><p>No paid API key needed. Footage selection and framing still deserve a human check. Review and upload when you’re happy.</p></div><button disabled={!root} onClick={() => perform(desktop.openStudio('faceless', 'root'))}>open workflow folder<ArrowUpRight size={12} /></button></section>
      </>}
    </div>
  </div>;
}
