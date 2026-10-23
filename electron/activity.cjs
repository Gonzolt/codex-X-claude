const LINES = {
  thinking: 'rearranging a few brain cells…',
  researching: 'following the breadcrumbs. tiny detective hat on.',
  reading: 'nose in the files. please send imaginary snacks.',
  running: 'tools out. tiny hard hat on.',
  editing: 'a little snip here, a little stitch there…',
  writing: 'turning brainwaves into words…'
};

function activityKind(tool, item = {}) {
  if (tool === 'agentMessage') return 'writing';
  if (/reasoning|thinking/i.test(tool)) return 'thinking';
  if (/web.?search|web.?fetch|browse|research/i.test(tool)) return 'researching';
  if (/fileChange|^Edit$|^Write$|NotebookEdit/i.test(tool)) return 'editing';
  if (/^Read$|^Glob$|^Grep$|read.?file|search.?file/i.test(tool)) return 'reading';
  if (tool === 'commandExecution' && item.commandActions?.some(action => ['read', 'search', 'listFiles'].includes(action.type))) return 'reading';
  if (tool === 'mcpToolCall' && /search|browse|fetch|research/i.test(item.tool || '')) return 'researching';
  return 'running';
}

module.exports = { LINES, activityKind };
