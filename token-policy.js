'use strict';
const defaults = Object.freeze({ requestLimit: 32000, outputTarget: 600, contextLimit: 24000 });
function count(text) { return Math.ceil(Buffer.byteLength(String(text || ''), 'utf8') / 3); }
function settings(value = {}) {
  const n = (key, min, max) => Math.max(min, Math.min(max, Math.round(Number(value[key]) || defaults[key])));
  return { requestLimit: n('requestLimit', 2000, 200000), outputTarget: n('outputTarget', 100, 8000), contextLimit: n('contextLimit', 4000, 100000) };
}
function usage(value = {}) {
  const n = key => Math.max(0, Number(value[key]) || 0);
  const input = n('input'), output = n('output'), cached = n('cached');
  return { input, output, cached, total: input + output + cached };
}
function estimate({ text, imageCount = 0, fileBytes = 0, context = 0, engine }) {
  const prompt = count(text), images = Math.max(0, imageCount) * 1600;
  const files = Math.ceil(Math.max(0, fileBytes) / 3), history = Math.max(0, Number(context) || 0);
  const overhead = history ? 0 : ({ claude: 1500, codex: 4000, gemini: 2000 }[engine] || 2000);
  return { prompt, images, files, history, overhead, total: prompt + images + files + history + overhead, approximate: true };
}
module.exports = { defaults, count, settings, usage, estimate };
