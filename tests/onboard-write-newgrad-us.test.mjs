// The newgrad-us portals preset (templates/portals.newgrad-us.yml): picked on
// its own for an entry-level US candidate, layered over the template without
// replacing it, and off for everyone else or with `preset: none`.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as yaml from 'js-yaml';
import { buildPortals, normalizeAnswers } from '../onboard-write.mjs';
import { compileKeyword, foldTitle } from '../title-keywords.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const TEMPLATE_TEXT = readFileSync(join(ROOT, 'templates', 'portals.example.yml'), 'utf8');
const TEMPLATE = yaml.load(TEMPLATE_TEXT);
const PRESET = yaml.load(readFileSync(join(ROOT, 'templates', 'portals.newgrad-us.yml'), 'utf8'));

const BASE = {
  candidate: { full_name: 'Avery Quinn', email: ['avery.quinn', 'example.test'].join('@'), location: 'Austin, TX', years_of_experience: 0 },
  target_roles: ['Software Engineer'],
  compensation: { target_range: '$110K-130K', currency: 'USD' },
  location: { country: 'United States', timezone: 'America/Chicago' },
  portals: { positive: ['Software Engineer'], negative: [] },
};

function build(extra = {}) {
  const a = normalizeAnswers({
    ...BASE, ...extra,
    candidate: { ...BASE.candidate, ...extra.candidate },
    location: { ...BASE.location, ...extra.location },
    portals: { ...BASE.portals, ...extra.portals },
  });
  return yaml.load(buildPortals(TEMPLATE_TEXT, a)).title_filter;
}

const passes = (filter, title) => {
  const t = foldTitle(title);
  return filter.positive.some((k) => compileKeyword(foldTitle(String(k)))(t))
    && !filter.negative.some((k) => compileKeyword(foldTitle(String(k)))(t));
};

test('an entry-level US candidate gets the new-grad keywords after their own', () => {
  const f = build();
  assert.equal(f.positive[0], 'Software Engineer');
  for (const k of PRESET.positive) assert.ok(f.positive.includes(k), k);
  for (const k of ['Junior', 'word:Intern', 'word:Interns', 'Internship', 'Java ']) assert.equal(f.negative.includes(k), false, k);
  assert.ok(f.negative.includes('.NET') && f.negative.includes('Werkstudent'), 'the rest of the template stays');
  assert.deepEqual(f.seniority_boost, PRESET.seniority_boost);
  assert.equal(f.seniority_boost.includes('Senior'), false);
});

test('new-grad titles pass the written filter, senior and level-two titles do not match a preset keyword', () => {
  const f = build({ portals: { positive: ['Backend Engineer'] } });
  for (const title of ['Software Engineer, New Grad 2027', 'Entry-Level Software Developer', 'Software Engineer I',
    'Associate Software Engineer', 'Junior Backend Engineer', 'Java Backend Engineer', 'Early Career Data Scientist']) {
    assert.ok(passes(f, title), title);
  }
  for (const title of ['Software Engineer II', 'Senior Software Engineer', 'Staff Engineer']) assert.equal(passes(f, title), false, title);
});

test('the preset is off outside the US, for a mid-level candidate, and with preset: none', () => {
  for (const extra of [
    { location: { country: 'Canada', timezone: 'America/Toronto' } },
    { candidate: { years_of_experience: 4 } },
    { portals: { preset: 'none' } },
  ]) {
    const f = build(extra);
    assert.equal(f.positive.includes('New Grad'), false, JSON.stringify(extra));
    assert.deepEqual(f.seniority_boost, TEMPLATE.title_filter.seniority_boost);
    assert.ok(f.negative.includes('Java '));
  }
});

test('preset: newgrad-us turns it on for anyone, and an unknown preset is refused', () => {
  const f = build({ candidate: { years_of_experience: 6 }, location: { country: 'Canada', timezone: 'America/Toronto' }, portals: { preset: 'newgrad-us' } });
  assert.ok(f.positive.includes('New Grad'));
  assert.equal(f.negative.includes('Java '), false);
  assert.equal(f.negative.includes('Junior'), false, 'an explicit preset drops "Junior" whatever the years');
  assert.throws(() => build({ portals: { preset: 'newgrad-eu' } }), /portals\.preset must be/);
});

test('the candidate\'s own negatives win over the preset', () => {
  const f = build({ portals: { negative: ['Junior', 'Associate'] } });
  assert.equal(f.negative.filter((n) => n === 'Junior').length, 1);
  assert.equal(f.positive.includes('Associate Software Engineer'), false);
});
