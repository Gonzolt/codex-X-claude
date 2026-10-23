export type Agent = 'codex' | 'claude';
export type Status = 'idle' | 'working' | 'waiting' | 'approval' | 'done' | 'stopped' | 'error';
export type Appearance = { accent: 'mint' | 'lavender' | 'peach'; theme: 'light' | 'dark'; pattern: boolean; fontSize: number };
export type Activity = { id: string; agent: Agent | 'you' | 'system'; text: string; kind: string; time: number; streaming?: boolean };
export type Connection = { installed: boolean; signedIn: boolean; version?: string; path?: string | null };
export type InputField = { type?: string; title?: string; description?: string; enum?: (string | number)[]; default?: unknown; oneOf?: { const: string; title?: string }[]; items?: InputField; minimum?: number; maximum?: number };
export type Approval = { id: string; agent: Agent; title: string; detail: string; kind: 'permission' | 'form' | 'url'; url?: string; schema?: { properties?: Record<string, InputField>; required?: string[] } };
export type Chat = { id: string; title: string; project: string | null; updatedAt: number; messageCount: number };
export type Workspace = {
  project: string | null; events: Activity[]; appearance: Appearance;
  agents: Record<Agent, Connection>; status: Record<Agent, Status>; busy: boolean; approvals: Approval[];
  activeChatId: string; chats: Chat[]; approvalMode: 'ask' | 'auto'; reviewPass: number; reviewLimit: number;
  activity: Record<Agent, { kind: string; text: string } | null>;
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
  approve(id: string, allow: boolean, content?: unknown): Promise<Result>;
  approvalMode(mode: 'ask' | 'auto'): Promise<Result>;
  openInputUrl(id: string): Promise<Result>;
  selectChat(id: string): Promise<Result<Workspace>>;
  signIn(agent: Agent): Promise<Result<string>>;
  fresh(): Promise<Result<Workspace>>;
  changes(): Promise<Result<Changes>>;
  diff(name: string): Promise<Result<string>>;
  appearance(value: Appearance): Promise<Result>;
  openLink(name: 'repository' | Agent): Promise<Result>;
  window(action: 'minimize' | 'maximize' | 'close'): Promise<Result>;
  subscribe(callback: (state: Workspace) => void): () => void;
};
declare global { interface Window { desktop?: Desktop; } }
