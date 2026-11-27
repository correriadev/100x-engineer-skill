import { CliError } from './errors.mjs';

// The keys a person or agent writes. Everything else in run.json is computed by 100x finish.
export const RUN_KEYS = ['title', 'pitch', 'verdict', 'verdictWhy', 'moment', 'url', 'runCmd', 'hero', 'tryFirst', 'mustNotBreak', 'review', 'polishPasses', 'features', 'nextAsks', 'ship', 'matrixSkipped', 'mode', 'engineering'];

const LIST_KEYS = new Set(['tryFirst', 'nextAsks', 'features', 'mustNotBreak']);
const UNSAFE = new Set(['__proto__', 'constructor', 'prototype']);
const VERDICT_WORDS = ['ship', 'fine', 'dud'];

const TEXT_KEYS = new Set(['title', 'pitch', 'verdict', 'verdictWhy', 'moment', 'url', 'runCmd', 'hero', 'matrixSkipped', 'tryFirst', 'nextAsks', 'mode']);

// Legacy runs and registry rows used the verdict 'wow' and the key `wow` for the signature moment. This is the one place
// that translates them: 'wow' as a verdict becomes 'ship', and a `wow` key becomes `moment`. A run that already uses the
// new words is returned unchanged, so readers can apply this to every run or row they read with no migration step.
export function modern(run) {
  if (!run || typeof run !== 'object' || Array.isArray(run)) return run;
  const hasOld = Object.prototype.hasOwnProperty.call(run, 'wow');
  if (run.verdict !== 'wow' && !hasOld) return run;
  const out = { ...run };
  if (out.verdict === 'wow') out.verdict = 'ship';
  if (hasOld) {
    if (!Object.prototype.hasOwnProperty.call(out, 'moment')) out.moment = out.wow;
    delete out.wow;
  }
  return out;
}

// The current name of a key a caller may have spelled with its legacy name, worked out through modern() so no other
// place has to spell the old words. Unknown names come back as they were, and keysOf turns them away as before.
const currentKey = (key) => Object.keys(modern({ [key]: null }))[0];
export const canonicalKey = (dotted) => String(dotted).split('.').map((key, at) => (at === 0 ? currentKey(key) : key)).join('.');
// Lists of sentences. Pushing adds one sentence as typed. Setting takes the whole list as JSON, and every entry is text.
const SENTENCE_LISTS = new Set(['tryFirst', 'nextAsks']);

const isFeature = (value) => Boolean(value) && typeof value === 'object' && !Array.isArray(value);
const isFeatureList = (value) => Array.isArray(value) && value.every(isFeature);

// What a list key says when it holds the wrong thing. run set and run push turn the write away with it. finish and report say it
// about a file that was edited by hand, because they walk these lists and a wrong shape would end the night in a TypeError.
const listWords = (key) => (key === 'features'
  ? 'features is a list of features, each with a name and a cutHint. Add one with `100x run push features \'{"name":"Prestige","cutHint":"delete src/prestige"}\'`.'
  : `${key} is a list. Add one with \`100x run push ${key} "<one line>"\`, or write the whole list with \`100x run set ${key} '["first","second"]'\`.`);

export function listProblems(run) {
  const problems = [...SENTENCE_LISTS].filter((key) => run[key] != null && !Array.isArray(run[key])).map(listWords);
  if (run.features != null && !isFeatureList(run.features)) problems.push(listWords('features'));
  return problems;
}

// A value is JSON when it parses as JSON. A key that holds text keeps its text as typed, so a title of 2048 stays a string.
export function parseValue(dotted, text, { push = false } = {}) {
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch {
    return text;
  }
  if (!push && SENTENCE_LISTS.has(dotted) && Array.isArray(parsed)) return parsed.map(String);
  return TEXT_KEYS.has(currentKey(String(dotted).split('.')[0])) && typeof parsed !== 'string' ? text : parsed;
}

function keysOf(dotted) {
  const keys = String(dotted).split('.').filter((key) => key !== '');
  if (keys.length === 0) throw new CliError('A key is needed, for example verdict or review.status.');
  if (keys.some((key) => UNSAFE.has(key))) throw new CliError(`The key "${dotted}" is not allowed.`);
  keys[0] = currentKey(keys[0]);
  if (!RUN_KEYS.includes(keys[0])) throw new CliError(`Unknown key "${keys[0]}". The keys are ${RUN_KEYS.join(', ')}.`);
  return keys;
}

const isIndex = (key) => /^\d+$/.test(key);

function check(keys, value) {
  if (keys.length > 1) return;
  const [key] = keys;
  if (key === 'verdict' && !VERDICT_WORDS.includes(value)) throw new CliError(`verdict must be one of ${VERDICT_WORDS.join(', ')}.`);
  if (key === 'polishPasses' && !(Number.isInteger(value) && value >= 0)) throw new CliError('polishPasses must be a whole number, for example 3.');
  if (key === 'mode' && !['mockup', 'solo', 'engineering'].includes(value)) throw new CliError('mode can only be mockup, solo or engineering. A normal prototype run has no mode.');
  if (SENTENCE_LISTS.has(key) && !Array.isArray(value)) throw new CliError(listWords(key));
  if (key === 'features' && !isFeatureList(value)) throw new CliError(listWords(key));
}

function container(parent, key, nextKey) {
  const existing = parent[key];
  if (existing && typeof existing === 'object') return existing;
  parent[key] = isIndex(nextKey) ? [] : {};
  return parent[key];
}

export function setPath(run, dotted, value) {
  const keys = keysOf(dotted);
  const checked = keys.length === 1 && keys[0] === 'verdict' ? modern({ verdict: value }).verdict : value;
  check(keys, checked);
  value = checked;
  let node = run;
  for (let i = 0; i < keys.length - 1; i += 1) node = container(node, keys[i], keys[i + 1]);
  node[keys.at(-1)] = value;
  return run;
}

export function pushPath(run, dotted, value) {
  const keys = keysOf(dotted);
  let node = run;
  for (let i = 0; i < keys.length - 1; i += 1) node = container(node, keys[i], keys[i + 1]);
  const last = keys.at(-1);
  const current = node[last];
  if (keys.length === 1 && last === 'features' && !isFeature(value)) throw new CliError(listWords(last));
  if (current === undefined && keys.length === 1 && !LIST_KEYS.has(last)) throw new CliError(`${dotted} is not a list, so nothing can be pushed onto it. Use set.`);
  if (current === undefined) node[last] = [value];
  else if (Array.isArray(current)) current.push(value);
  else if (current && typeof current === 'object' && keys.length === 1 && last === 'mustNotBreak') node[last] = [current, value];
  else throw new CliError(`${dotted} is not a list, so nothing can be pushed onto it. Use set to replace it.`);
  return run;
}

export function unsetPath(run, dotted) {
  const keys = keysOf(dotted);
  let node = run;
  for (const key of keys.slice(0, -1)) {
    node = node?.[key];
    if (!node || typeof node !== 'object') return false;
  }
  const last = keys.at(-1);
  if (!(last in node)) return false;
  if (Array.isArray(node) && isIndex(last)) node.splice(Number(last), 1);
  else delete node[last];
  return true;
}
