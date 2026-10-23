export type Agent = 'codex' | 'claude';
export type Status = 'idle' | 'working' | 'waiting' | 'approval' | 'done' | 'stopped' | 'error';
export type Appearance = { accent: 'mint' | 'lavender' | 'peach'; theme: 'light' | 'dark'; pattern: boolean; fontSize: number };
export type Activity = { id: string; agent: Agent | 'you' | 'system'; text: string; kind: string; time: number; streaming?: boolean };
export type Connection = { installed: boolean; signedIn: boolean; version?: string; path?: string | null };
export type Approval = { id: string; agent: Agent; title: string; detail: string };
export type Workspace = {
  project: string | null; events: Activity[]; appearance: Appearance;
  agents: Record<Agent, Connection>; status: Record<Agent, Status>; busy: boolean; approvals: Approval[];
};
export type Task = { prompt: string; target: Agent | 'both'; mode: 'build' | 'compare' };
export type Changes = { files: { path: string; status: string }[]; isGit: boolean };
export type Result<T = void> = { ok: true; value: T } | { ok: false; error: string };
export type Desktop = {
  getState(): Promise<Result<Workspace>>;
  chooseProject(): Promise<Result<string | null>>;
  refresh(): Promise<Result<Workspace>>;
  start(task: Task): Promise<Result<Workspace>>;
  stop(agent?: Agent): Promise<Result>;
  approve(id: string, allow: boolean): Promise<Result>;
  signIn(agent: Agent): Promise<Result<string>>;
  fresh(): Promise<Result>;
  changes(): Promise<Result<Changes>>;
  diff(name: string): Promise<Result<string>>;
  appearance(value: Appearance): Promise<Result>;
  openLink(name: 'repository' | Agent): Promise<Result>;
  window(action: 'minimize' | 'maximize' | 'close'): Promise<Result>;
  subscribe(callback: (state: Workspace) => void): () => void;
};
declare global { interface Window { desktop?: Desktop; } }
