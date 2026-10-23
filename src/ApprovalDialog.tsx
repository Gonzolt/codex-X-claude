import { useState } from 'react';
import { Check, ExternalLink, ShieldCheck, Square } from 'lucide-react';
import type { Approval, Desktop, InputField } from './types';

export function ApprovalDialog({ item, desktop, report }: { item: Approval; desktop: Desktop; report(message: string): void }) {
  const properties = item.schema?.properties || {};
  const [values, setValues] = useState<Record<string, unknown>>(() => Object.fromEntries(Object.entries(properties).filter(([, field]) => field.default !== undefined || field.type === 'boolean').map(([key, field]) => [key, field.default ?? false])));
  const [pending, setPending] = useState(false);
  const [error, setError] = useState('');
  async function action(run: () => ReturnType<Desktop['approve']>) {
    setPending(true); setError('');
    try { const result = await run(); if (!result.ok) setError(result.error); }
    catch (reason) { setError(reason instanceof Error ? reason.message : 'Could not answer this request.'); }
    finally { setPending(false); }
  }
  function answer() {
    try {
      const content = Object.fromEntries(Object.entries(values).filter(([, value]) => value !== '').map(([key, value]) => {
        const field = properties[key];
        return [key, ['number', 'integer'].includes(field.type || '') ? Number(value) : !simple(field) ? JSON.parse(String(value)) : value];
      }));
      action(() => desktop.approve(item.id, true, content));
    } catch { setError('Please enter valid JSON in the detailed answer field.'); }
  }
  function fieldInput(key: string, field: InputField) {
    const required = item.schema?.required?.includes(key);
    const label = field.title || key;
    const update = (value: unknown) => setValues(previous => ({ ...previous, [key]: value }));
    const choices = field.enum?.map(value => ({ value, title: String(value) })) || field.oneOf?.map(choice => ({ value: choice.const, title: choice.title || choice.const }));
    return <label className="request-field" key={key}><span>{label}{required && field.type !== 'boolean' ? ' *' : ''}</span>{field.description && <small>{field.description}</small>}
      {field.type === 'boolean' ? <input type="checkbox" checked={values[key] === true} onChange={event => update(event.target.checked)} />
        : choices ? <select required={required} value={String(values[key] ?? '')} onChange={event => update(field.type === 'number' || field.type === 'integer' ? Number(event.target.value) : event.target.value)}><option value="">choose an answer</option>{choices.map(choice => <option key={String(choice.value)} value={String(choice.value)}>{choice.title}</option>)}</select>
        : field.type === 'array' && field.items?.enum ? <select multiple required={required} value={(values[key] as string[]) || []} onChange={event => update(Array.from(event.target.selectedOptions, option => option.value))}>{field.items.enum.map(value => <option key={String(value)} value={String(value)}>{value}</option>)}</select>
        : !simple(field) ? <textarea required={required} placeholder="Answer as JSON" value={String(values[key] ?? '')} onChange={event => update(event.target.value)} />
        : <input required={required} type={['number', 'integer'].includes(field.type || '') ? 'number' : 'text'} step={field.type === 'integer' ? 1 : 'any'} min={field.minimum} max={field.maximum} value={String(values[key] ?? '')} onChange={event => update(event.target.value)} />}
    </label>;
  }
  return <div className="modal-backdrop approval-backdrop"><section className="retro-dialog" role="dialog" aria-modal="true" aria-labelledby="approval-title"><header className="dialog-titlebar"><h2 id="approval-title">{item.kind === 'permission' ? 'a quick check with you.' : 'a little input, please.'}</h2><ShieldCheck size={16} /></header><form className="dialog-content" onSubmit={event => { event.preventDefault(); answer(); }}>
    <p className="dialog-intro">{item.agent === 'codex' ? 'Codex' : 'Claude'}: {item.title}</p><pre className="approval-detail">{item.detail}</pre>
    {item.kind === 'form' && <div className="request-fields">{Object.entries(properties).map(([key, field]) => fieldInput(key, field))}</div>}
    {item.kind === 'url' && <><p className="request-help">Complete this step in your browser, then confirm below.</p><button type="button" className="bevel-button" onClick={async () => { const result = await desktop.openInputUrl(item.id); if (!result.ok) report(result.error); }}>open requested page<ExternalLink size={13} /></button></>}
    {error && <p role="alert" className="request-error">{error}</p>}
    <div className="approval-actions"><button type="button" className="bevel-button" disabled={pending} onClick={() => action(() => desktop.stop())}><Square size={11} />stop</button><button type="button" className="bevel-button" disabled={pending} onClick={() => action(() => desktop.approve(item.id, false))}>decline</button>{item.kind === 'permission' && <button type="button" className="bevel-button" disabled={pending} onClick={() => action(() => desktop.approvalMode('auto'))}>allow for this chat</button>}<button type={item.kind === 'form' ? 'submit' : 'button'} className="bevel-button send-button" disabled={pending} onClick={item.kind === 'form' ? undefined : () => action(() => desktop.approve(item.id, true))}>{item.kind === 'permission' ? 'allow once' : item.kind === 'url' ? 'done in browser' : 'send answer'}<Check size={14} /></button></div>
  </form></section></div>;
}

function simple(field: InputField) { return ['string', 'boolean', 'number', 'integer'].includes(field.type || '') || Boolean(field.enum || field.oneOf || (field.type === 'array' && field.items?.enum)); }
