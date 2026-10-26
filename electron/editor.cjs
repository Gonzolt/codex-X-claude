const { EventEmitter } = require('node:events');
const { Coordinator } = require('./coordinator.cjs');
const path = require('node:path');
const { assertTask } = require('./protocol.cjs');

class MotionEditor extends EventEmitter {
  constructor(initial = {}, dependencies = {}) {
    super(); this.context = '';
    this.coordinator = Coordinator.launch(initial, { ...dependencies, taskContext: () => this.context });
    this.coordinator.on('state', state => this.emit('state', state));
  }
  get state() { return this.coordinator.state; }
  serialize() { return this.coordinator.serialize(); }
  attach(root) {
    if (this.state.project !== root) this.coordinator.setProject(root);
    return this.state;
  }
  fresh(root) {
    if (!root) throw new Error('Select your standalone MotionKit folder first.');
    this.attach(root); return this.coordinator.fresh();
  }
  select(id, root) {
    const chat = this.coordinator.chats.find(chat => chat.id === id && chat.project === root);
    if (!root || !chat) throw new Error('Choose an editing chat for the selected MotionKit project.');
    return this.coordinator.selectChat(id);
  }
  async start(input, studios, coding) {
    if (coding.state.busy) throw new Error('Finish or stop the coding task before starting an edit.');
    const task = assertTask({ ...input, mode: 'build' });
    const { root, films, exportDir } = studios.state.editing;
    if (!root) throw new Error('Select your standalone MotionKit folder first.');
    const film = input.film || null;
    if (film && !films.some(item => item.id === film)) throw new Error('Choose a film from the selected MotionKit project.');
    if (this.state.busy) throw new Error('An edit is already running.');
    this.attach(root); this.state.agents = coding.state.agents;
    this.context = [
      'This is a MotionKit editing task in the selected standalone project.',
      film ? `Selected film: ${film}. Its HTML is brands/${film.split('/')[0]}/films/${film.split('/')[1]}.html.` : 'No existing film is selected. Create a new film only if the user requests one.',
      'Read README.md and applicable project instructions before editing. Work in the actual MotionKit files, not the Codex x Claude application.',
      'Preserve deterministic render(t), theme tokens and voice/scene timing where relevant. Inspect dependencies before using the project preview or export commands; follow its Windows/WSL instructions.',
      'Make the requested changes, run relevant checks and report the files changed and how to preview the result. Do not claim an export succeeded unless it actually ran.',
      exportDir ? `Save every finished export (video, GIF or still you hand over) in the user's export folder: ${exportDir}. Pass the full path, e.g. node tools/export.mjs --film <brand>/<film> --out "${path.join(exportDir, '<film>.mp4')}". Keep scratch renders, strips and contact sheets out of it.` : 'Save finished exports in the project out/ folder (the default of tools/export.mjs).',
      'Use existing assets and free local tools. Do not purchase, upload, publish, or call paid generation/voice services without an explicit user request.',
      '\nUSER EDITING REQUEST:\n'
    ].join('\n');
    const state = await this.coordinator.start(task);
    this.coordinator.current.then(async () => {
      if (studios.state.editing.root === root) await studios.refreshFilms();
    }).catch(error => this.coordinator.event('system', `Could not refresh the film list: ${error.message}`, 'notice'));
    return state;
  }
  close() { this.coordinator.close(); }
}

module.exports = { MotionEditor };
