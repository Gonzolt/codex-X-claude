const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const { EventEmitter } = require('node:events');
const { PassThrough } = require('node:stream');
const { Studios } = require('../electron/studios.cjs');

async function folder(t) {
  const cache = path.resolve(__dirname, '../.cache'); await fs.mkdir(cache, { recursive: true });
  const root = await fs.mkdtemp(path.join(cache, 'studio-test-'));
  t.after(async () => { assert.equal(path.dirname(root), cache); assert.ok(path.basename(root).startsWith('studio-test-')); await fs.rm(root, { recursive: true, force: true }); });
  return root;
}
async function faceless(root) {
  for (const name of ['automatic.py', 'make_video.py', 'workflow.py', 'commons_footage.py']) await fs.writeFile(path.join(root, name), '# test fixture');
  const bin = path.join(root, '.venv', process.platform === 'win32' ? 'Scripts' : 'bin');
  await fs.mkdir(bin, { recursive: true }); await fs.writeFile(path.join(bin, process.platform === 'win32' ? 'python.exe' : 'python'), 'fixture');
}
function processFixture() {
  let invocation;
  const child = new EventEmitter(); child.stdout = new PassThrough(); child.stderr = new PassThrough(); child.kill = () => { child.emit('close', 1); };
  const studios = new Studios({}, { spawn: (exe, args, options) => { invocation = { exe, args, options }; return child; } });
  return { studios, child, invocation: () => invocation };
}
const brief = { topic: 'A quiet ocean', genre: 'reflection', scenes: 3, notes: '' };

test('MotionKit previews stay standalone and serve only project assets', async t => {
  const root = await folder(t);
  await fs.mkdir(path.join(root, 'brands/lab/films'), { recursive: true });
  await fs.mkdir(path.join(root, 'lib'), { recursive: true });
  await fs.writeFile(path.join(root, 'package.json'), JSON.stringify({ name: 'motionkit' }));
  await fs.writeFile(path.join(root, 'brands/lab/films/demo.html'), '<h1>Standalone film</h1>');
  await fs.writeFile(path.join(root, 'lib/test.js'), 'export const n = 1;');
  const studios = new Studios(); t.after(() => studios.close());
  await studios.configure('editing', root);
  assert.deepEqual(studios.state.editing.films.map(film => film.id), ['lab/demo']);
  const url = await studios.previewFilm('lab/demo');
  assert.match(url, /^http:\/\/127\.0\.0\.1:\d+\//);
  assert.match(await (await fetch(url)).text(), /Standalone film/);
  assert.equal((await fetch(new URL('/package.json', url))).status, 404);
  assert.equal((await fetch(new URL('/lib/test.js', url))).status, 200);
  assert.equal((await fetch(new URL('/lib/%2e%2e%2fpackage.json', url))).status, 404);
  await assert.rejects(studios.previewFilm('../outside'), /Choose a film/);
  assert.equal(studios.state.faceless.root, null);
});
test('studio folders must match the selected toolkit', async t => {
  const root = await folder(t), studios = new Studios();
  await fs.writeFile(path.join(root, 'package.json'), JSON.stringify({ name: 'other-project' }));
  await assert.rejects(studios.configure('editing', root), /standalone MotionKit/);
  await assert.rejects(studios.configure('faceless', root), /automatic.py/);
  await assert.rejects(studios.configure('other', root), /Unknown studio/);
});
test('faceless starts with explicit argument boundaries and key-free Commons', async t => {
  const root = await folder(t); await faceless(root);
  const { studios, child, invocation } = processFixture(); await studios.configure('faceless', root);
  const starting = studios.runFaceless({ ...brief, topic: 'A topic & echo should stay text' });
  await assert.rejects(studios.configure('faceless', root), /Stop the video/);
  await starting;
  const call = invocation();
  assert.equal(call.args[2], 'A topic & echo should stay text');
  assert.deepEqual(call.args.slice(-2), ['--footage', 'commons']);
  assert.equal(call.options.shell, undefined); assert.equal(call.options.windowsHide, true);
  child.stdout.write(Buffer.from('Scene 1/3: ocean\n'));
  assert.equal(studios.state.faceless.job.stage, 'Scene 1/3: ocean');
  await assert.rejects(studios.runFaceless(brief), /already being made/);
  await studios.stopFaceless(); assert.equal(studios.state.faceless.job.status, 'stopped');
});
test('factual notes are passed as a file and cleaned up after the process ends', async t => {
  const root = await folder(t); await faceless(root);
  const { studios, child, invocation } = processFixture(); await studios.configure('faceless', root);
  await assert.rejects(studios.runFaceless({ ...brief, genre: 'factual' }), /checked facts/);
  await studios.runFaceless({ ...brief, genre: 'factual', notes: 'Checked fact with source link.' });
  const notesPath = invocation().args.at(-1); assert.equal(await fs.readFile(notesPath, 'utf8'), 'Checked fact with source link.');
  child.stderr.end('Network unavailable\n'); child.emit('close', 1); await studios.completion;
  assert.equal(studios.state.faceless.job.status, 'error');
  await assert.rejects(fs.stat(notesPath), { code: 'ENOENT' });
});
test('a successful exit cannot open an arbitrary or partial output path', async t => {
  const root = await folder(t); await faceless(root);
  const { studios, child } = processFixture(); await studios.configure('faceless', root);
  await studios.runFaceless(brief);
  child.stdout.end(`Ready: ${path.join(root, 'outside/video.mp4')}\n`); child.emit('close', 0); await studios.completion;
  assert.equal(studios.state.faceless.job.status, 'error'); assert.equal(studios.state.faceless.job.video, null);
  await assert.rejects(studios.outputPath('video'), /Make a video/);
});
test('completed video and credits are available only after READY_FOR_REVIEW', async t => {
  const root = await folder(t); await faceless(root);
  const output = path.join(root, 'projects/demo/output/job'); await fs.mkdir(output, { recursive: true });
  await fs.writeFile(path.join(output, 'video.mp4'), 'test fixture'); await fs.writeFile(path.join(output, 'status.txt'), 'READY_FOR_REVIEW');
  const { studios, child } = processFixture(); await studios.configure('faceless', root); await studios.runFaceless(brief);
  child.stdout.end(`Ready: ${path.join(output, 'video.mp4')}\n`); child.emit('close', 0); await studios.completion;
  assert.equal(studios.state.faceless.job.status, 'done'); assert.equal(await studios.outputPath('output'), output);
  await fs.writeFile(path.join(output, 'status.txt'), 'FAILED');
  await assert.rejects(studios.outputPath('video'), /has not finished/);
  assert.deepEqual(studios.serialize(), { editing: null, faceless: root });
});
