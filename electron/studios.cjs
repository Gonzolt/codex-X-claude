const { EventEmitter } = require('node:events');
const { spawn, execFile } = require('node:child_process');
const { StringDecoder } = require('node:string_decoder');
const { randomUUID } = require('node:crypto');
const fs = require('node:fs/promises');
const path = require('node:path');
const http = require('node:http');

const emptyJob = () => ({ status: 'idle', stage: 'Ready when you are.', logs: [], video: null });
const inside = (root, candidate) => { const relative = path.relative(root, candidate); return relative !== '..' && !relative.startsWith('..' + path.sep) && !path.isAbsolute(relative); };
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.woff2': 'font/woff2', '.woff': 'font/woff', '.png': 'image/png', '.jpg': 'image/jpeg', '.svg': 'image/svg+xml', '.wav': 'audio/wav', '.mp3': 'audio/mpeg', '.m4a': 'audio/mp4', '.mp4': 'video/mp4', '.json': 'application/json' };

class Studios extends EventEmitter {
  constructor(initial = {}, dependencies = {}) {
    super(); this.dependencies = dependencies;
    this.state = { editing: { root: null, films: [] }, faceless: { root: null, job: emptyJob() } };
    this.initial = initial; this.child = null; this.server = null;
  }
  publish() { this.emit('state', this.state); }
  serialize() { return { editing: this.state.editing.root, faceless: this.state.faceless.root }; }
  async initialize() {
    for (const kind of ['editing', 'faceless']) if (typeof this.initial[kind] === 'string') {
      try { await this.configure(kind, this.initial[kind]); } catch { /* A moved installation can be selected again. */ }
    }
  }
  async configure(kind, folder) {
    if (!['editing', 'faceless'].includes(kind)) throw new Error('Unknown studio.');
    if (kind === 'faceless' && (this.child || this.starting)) throw new Error('Stop the video before switching workflow folders.');
    const root = await fs.realpath(folder);
    if (kind === 'editing') {
      let manifest;
      try { manifest = JSON.parse(await fs.readFile(path.join(root, 'package.json'), 'utf8')); } catch {}
      if (manifest?.name !== 'motionkit') throw new Error('Choose the standalone MotionKit folder containing its package.json.');
      const films = [];
      const brands = await fs.readdir(path.join(root, 'brands'), { withFileTypes: true });
      for (const brand of brands) if (brand.isDirectory() && /^[\w-]+$/.test(brand.name)) {
        let entries = [];
        try { entries = await fs.readdir(path.join(root, 'brands', brand.name, 'films')); } catch {}
        for (const file of entries) if (/^[\w-]+\.html$/.test(file)) films.push({ id: `${brand.name}/${file.slice(0, -5)}`, name: file.slice(0, -5), brand: brand.name });
      }
      this.closePreview(); this.state.editing = { root, films: films.sort((a, b) => a.id.localeCompare(b.id)) };
    } else {
      for (const file of ['automatic.py', 'make_video.py', 'workflow.py', 'commons_footage.py']) {
        if (!(await fs.stat(path.join(root, file)).catch(() => null))?.isFile()) throw new Error('Choose the faceless workflow folder containing automatic.py and commons_footage.py.');
      }
      this.state.faceless = { root, job: emptyJob() };
    }
    this.publish(); return this.state;
  }
  async previewFilm(id) {
    const { root, films } = this.state.editing;
    if (!root || !films.some(film => film.id === id)) throw new Error('Choose a film from your MotionKit project.');
    if (!this.server) {
      this.server = http.createServer(async (request, response) => {
        try {
          if (!['GET', 'HEAD'].includes(request.method)) { response.writeHead(405); response.end(); return; }
          const pathname = decodeURIComponent(new URL(request.url, 'http://localhost').pathname);
          if (!/^\/(brands|lib)\//.test(pathname) || pathname.includes('\0')) throw new Error('Unavailable asset');
          const file = await fs.realpath(path.resolve(root, '.' + pathname));
          if (!inside(root, file) || ![path.join(root, 'brands'), path.join(root, 'lib')].some(folder => inside(folder, file))) throw new Error('Unavailable asset');
          const type = TYPES[path.extname(file).toLowerCase()];
          if (!type) throw new Error('Unavailable asset');
          const info = await fs.stat(file);
          if (!info.isFile()) throw new Error('Unavailable asset');
          response.writeHead(200, { 'Content-Type': type, 'Content-Length': info.size, 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' });
          response.end(request.method === 'HEAD' ? undefined : await fs.readFile(file));
        } catch { if (!response.headersSent) response.writeHead(404); response.end(); }
      });
      const server = this.server;
      try {
        await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
      } catch (error) { this.closePreview(); throw error; }
    }
    return `http://127.0.0.1:${this.server.address().port}/brands/${id.split('/')[0]}/films/${id.split('/')[1]}.html`;
  }
  closePreview() { this.server?.close(); this.server = null; }
  async outputPath(target) {
    const root = this.state.faceless.root, file = this.state.faceless.job.video;
    if (!root || !file) throw new Error('Make a video first.');
    const real = await fs.realpath(file);
    if (!inside(path.join(root, 'projects'), real) || path.basename(real) !== 'video.mp4' || !(await fs.stat(real)).isFile()) throw new Error('The video is no longer available inside this workflow.');
    const status = await fs.readFile(path.join(path.dirname(real), 'status.txt'), 'utf8');
    if (status.trim() !== 'READY_FOR_REVIEW') throw new Error('This render has not finished successfully.');
    return target === 'video' ? real : path.dirname(real);
  }
  async openPath(kind, target) {
    if (!['editing', 'faceless'].includes(kind)) throw new Error('Unknown studio.');
    if (kind === 'faceless' && ['video', 'output'].includes(target)) return this.outputPath(target);
    if (target !== 'root' || !this.state[kind].root) throw new Error('Select the studio folder first.');
    return fs.realpath(this.state[kind].root);
  }
  async runFaceless(input) {
    if (this.closed) throw new Error('The studio is closing.');
    if (this.child || this.starting) throw new Error('A video is already being made.');
    const { topic, genre, scenes, notes = '' } = input || {};
    if (typeof topic !== 'string' || !topic.trim() || topic.trim().length > 500 || !['reflection', 'fiction', 'factual'].includes(genre) || !Number.isInteger(scenes) || scenes < 1 || scenes > 20 || typeof notes !== 'string' || notes.length > 16000) throw new Error('Enter a topic, a supported mode, and 1–20 scenes.');
    if (genre === 'factual' && !notes.trim()) throw new Error('Add checked facts and source links for a factual video.');
    const root = this.state.faceless.root;
    if (!root) throw new Error('Select your faceless workflow folder first.');
    this.starting = true;
    let notesPath;
    try {
      const python = path.join(root, '.venv', process.platform === 'win32' ? 'Scripts/python.exe' : 'bin/python');
      if (!(await fs.stat(python).catch(() => null))?.isFile()) throw new Error('Run 01_SETUP.cmd in the workflow folder first.');
      const args = ['automatic.py', '--topic', topic.trim(), '--genre', genre, '--scenes', String(scenes), '--footage', 'commons'];
      if (notes.trim()) {
        const cache = path.join(root, '.cache'); await fs.mkdir(cache, { recursive: true });
        notesPath = path.join(cache, `studio-notes-${randomUUID()}.txt`); await fs.writeFile(notesPath, notes, 'utf8');
        args.push('--notes', notesPath);
      }
      const spawnProcess = this.dependencies.spawn || spawn;
      if (this.closed) throw new Error('The studio is closing.');
      const child = spawnProcess(python, args, { cwd: root, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'], env: { ...process.env, PYTHONUNBUFFERED: '1', PYTHONIOENCODING: 'utf-8' } });
      this.child = child; this.stopped = false;
      const job = this.state.faceless.job = { ...emptyJob(), status: 'running', stage: 'Writing your script locally…' };
      const line = value => {
        if (this.child !== child || !value.trim()) return;
        const text = value.trim().slice(-2000); job.logs.push(text); job.logs = job.logs.slice(-60);
        if (/Writing script/.test(text)) job.stage = 'Writing your script locally…';
        if (/^Scene \d+\/\d+:/.test(text)) job.stage = text;
        const result = text.match(/^(?:Ready:|Automatic production complete:)\s*(.+video\.mp4)$/);
        if (result) job.video = result[1];
        this.publish();
      };
      for (const stream of [child.stdout, child.stderr]) {
        const decoder = new StringDecoder('utf8'); let pending = '';
        stream.on('data', chunk => {
          pending += decoder.write(chunk); let index;
          while ((index = pending.indexOf('\n')) !== -1) { line(pending.slice(0, index)); pending = pending.slice(index + 1); }
          if (pending.length > 8000) { line(pending); pending = ''; }
        });
        stream.on('end', () => line(pending + decoder.end()));
      }
      let failure;
      child.on('error', error => { failure = error; });
      this.completion = new Promise(resolve => child.once('close', async code => {
        if (notesPath) await fs.unlink(notesPath).catch(() => {});
        if (this.child !== child) { resolve(); return; }
        try {
          if (this.stopped) { job.status = 'stopped'; job.stage = 'Video stopped. Existing project files are saved.'; job.video = null; }
          else if (failure || code !== 0) { job.status = 'error'; job.stage = failure?.message || job.logs.at(-1) || 'Video generation stopped. Check the log below.'; job.video = null; }
          else { await this.outputPath('video'); job.status = 'done'; job.stage = 'Ready for you to watch and review.'; }
        } catch (error) { job.status = 'error'; job.stage = error.message; job.video = null; }
        this.child = null; this.publish(); resolve();
      }));
      this.publish(); return this.state;
    } catch (error) { if (notesPath) await fs.unlink(notesPath).catch(() => {}); throw error; }
    finally { this.starting = false; }
  }
  async stopFaceless() {
    if (!this.child) return;
    this.stopped = true; const child = this.child;
    if (process.platform === 'win32' && child.pid) {
      await new Promise((resolve, reject) => execFile('taskkill.exe', ['/pid', String(child.pid), '/t', '/f'], { windowsHide: true }, error => { if (error && this.child === child) reject(error); else resolve(); }));
    } else child.kill('SIGTERM');
    await this.completion;
  }
  async close() { this.closed = true; this.closePreview(); await this.stopFaceless(); }
}

module.exports = { Studios, inside };
