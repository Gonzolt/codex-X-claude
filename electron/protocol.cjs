const { EventEmitter } = require('node:events');

// stdout is a stream: a JSON object can span any number of chunks.
class JsonLines extends EventEmitter {
  buffer = '';
  push(chunk) {
    this.buffer += chunk;
    if (this.buffer.length > 8 * 1024 * 1024) {
      this.buffer = '';
      this.emit('invalid', new Error('Agent output exceeded the message limit.'));
      return;
    }
    let end;
    while ((end = this.buffer.indexOf('\n')) !== -1) {
      const line = this.buffer.slice(0, end).trim();
      this.buffer = this.buffer.slice(end + 1);
      if (!line) continue;
      try { this.emit('message', JSON.parse(line)); }
      catch { this.emit('invalid', new Error('An agent sent an invalid JSON message.')); }
    }
  }
}

function describeItem(item) {
  if (item.type === 'commandExecution') return item.command || 'Running a command';
  if (item.type === 'fileChange') return (item.changes || []).map(c => c.path).join(', ') || 'Editing files';
  if (item.type === 'mcpToolCall') return `${item.server}: ${item.tool}`;
  if (item.type === 'webSearch') return item.query || 'Searching the web';
  return null;
}

function assertTask(value) {
  if (!value || typeof value.prompt !== 'string' || !value.prompt.trim()) throw new Error('Write a task first.');
  if (value.prompt.length > 32000) throw new Error('Keep the task under 32,000 characters.');
  if (!['codex', 'claude', 'both'].includes(value.target)) throw new Error('Choose an agent.');
  if (!['build', 'compare'].includes(value.mode)) throw new Error('Choose a collaboration mode.');
  return { prompt: value.prompt.trim(), target: value.target, mode: value.mode };
}

module.exports = { JsonLines, describeItem, assertTask };
