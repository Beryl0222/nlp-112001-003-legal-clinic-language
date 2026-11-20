const STRONG_BREAKS = new Set(['。', '；', '！', '？', ';', '!', '?']);
const SOFT_BREAKS = new Set(['，']);

function isFullStop(text, index) {
  if (text[index] !== '.') return false;
  const next = text[index + 1];
  const previous = text[index - 1] || '';
  if (next !== undefined && !/\s/.test(next)) return false;
  if (/\d/.test(previous)) return false;
  return true;
}

function pushPart(parts, text, start, end) {
  const raw = text.slice(start, end);
  const leading = raw.length - raw.trimStart().length;
  const value = raw.trim();
  if (!value) return;
  const from = start + leading;
  parts.push({ text: value, start: from, end: from + value.length });
}

function splitOn(text, breaks, { fullStop = false } = {}) {
  const parts = [];
  let start = 0;
  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    if (breaks.has(char) || (fullStop && isFullStop(text, index))) {
      pushPart(parts, text, start, index);
      start = index + 1;
    }
  }
  pushPart(parts, text, start, text.length);
  return parts;
}

/**
 * Split an utterance into clauses while retaining its source offsets.
 * Chinese lists joined by "、" stay together; a comma starts a new clause.
 */
export function splitClauses(text) {
  return splitOn(text, new Set([...SOFT_BREAKS, ...STRONG_BREAKS]), { fullStop: true });
}

/**
 * Split a translated passage into sentences. Commas stay inside a sentence so
 * that a leading "No," remains attached to the correction it introduces.
 */
export function splitSentences(text) {
  return splitOn(text, new Set(['。', '；', '！', '？', '!', '?']), { fullStop: true });
}

export function splitList(value) {
  return String(value)
    .split(/[、,，;；/|]+/u)
    .map(part => part.trim())
    .filter(Boolean);
}

export function compact(text) {
  return String(text).replace(/\s+/gu, ' ').trim();
}

export function overlapCount(a, b) {
  const left = new Set(splitList(a));
  return splitList(b).filter(item => left.has(item)).length;
}
