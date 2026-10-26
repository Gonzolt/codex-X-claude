const fs = require('node:fs/promises');
const path = require('node:path');

class WorkspaceStore {
  constructor(file, io = fs) { this.file = file; this.io = io; this.queue = Promise.resolve(); }
  save(value) {
    const snapshot = JSON.stringify(value);
    const write = this.queue.catch(() => {}).then(async () => {
      await this.io.mkdir(path.dirname(this.file), { recursive: true });
      await this.io.writeFile(this.file + '.tmp', snapshot, { encoding: 'utf8', flush: true });
      await this.io.rename(this.file + '.tmp', this.file);
    });
    this.queue = write;
    return write;
  }
}

module.exports = { WorkspaceStore };
