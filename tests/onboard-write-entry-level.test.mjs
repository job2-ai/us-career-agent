// An entry-level candidate's portals.yml must not reject the titles their
// search is for: the template's "Junior" negative goes, and the intern and
// student negatives go too when the level names an internship.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as yaml from 'js-yaml';
import { buildPortals, entryLevelNegatives, normalizeAnswers } from '../onboard-write.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const TEMPLATE_TEXT = readFileSync(join(ROOT, 'templates', 'portals.example.yml'), 'utf8');
const TEMPLATE = yaml.load(TEMPLATE_TEXT);
const INTERN_ENTRIES = ['word:Intern', 'word:Interns', 'Internship', 'Werkstudent', 'Praktikant', 'Praktikum'];

const BASE = {
  candidate: { full_name: 'Avery Quinn', email: ['avery.quinn', 'example.test'].join('@'), location: 'Leeds, UK' },
  target_roles: ['Software Engineer'],
  compensation: { target_range: '30K-38K', currency: 'GBP' },
  location: { country: 'United Kingdom', timezone: 'Europe/London' },
  portals: { positive: ['Software Engineer', 'Graduate Engineer'], negative: [] },
};

function negatives(extra) {
  const a = normalizeAnswers({ ...BASE, ...extra, portals: { ...BASE.portals, ...extra.portals } });
  return yaml.load(buildPortals(TEMPLATE_TEXT, a)).title_filter.negative;
}

test('the template ships the negatives this fix is about', () => {
  for (const n of ['Junior', ...INTERN_ENTRIES]) assert.ok(TEMPLATE.title_filter.negative.includes(n), n);
});

test('under two years of experience drops "Junior" and keeps the intern entries', () => {
  const neg = negatives({ candidate: { ...BASE.candidate, years_of_experience: 0 } });
  assert.equal(neg.includes('Junior'), false);
  for (const n of INTERN_ENTRIES) assert.ok(neg.includes(n), `${n} was dropped`);
  assert.ok(neg.includes('Ausbildung') && neg.includes('Master Thesis'), 'other student entries stay');
});

test('an Entry, Junior or Graduate archetype level drops "Junior" with no years given', () => {
  for (const level of ['Entry', 'Junior', 'Graduate', 'Entry-level', 'New Grad']) {
    const neg = negatives({ archetypes: [{ name: 'Backend', level, fit: 'primary' }] });
    assert.equal(neg.includes('Junior'), false, level);
    assert.ok(neg.includes('word:Intern'), level);
  }
});

test('an internship or student level also drops the intern and student entries', () => {
  for (const level of ['Intern', 'Internship', 'Student', 'Working Student']) {
    const neg = negatives({ archetypes: [{ name: 'Backend', level, fit: 'primary' }] });
    for (const n of ['Junior', ...INTERN_ENTRIES]) assert.equal(neg.includes(n), false, `${level}: ${n} kept`);
    assert.ok(neg.includes('Ausbildung') && neg.includes('Bachelor Thesis'), level);
  }
});

test('a mid-level or senior candidate keeps every shipped negative', () => {
  for (const extra of [
    { candidate: { ...BASE.candidate, years_of_experience: 2 } },
    { candidate: { ...BASE.candidate, years_of_experience: 8 }, archetypes: [{ name: 'Backend', level: 'Senior', fit: 'primary' }] },
    { archetypes: [{ name: 'Backend', level: 'Mid-Senior', fit: 'primary' }] },
    {},
  ]) {
    const neg = negatives(extra);
    for (const n of TEMPLATE.title_filter.negative) assert.ok(neg.includes(n), `${n} was dropped`);
  }
});

test('a negative the user names again is kept for an entry-level candidate', () => {
  const neg = negatives({
    candidate: { ...BASE.candidate, years_of_experience: 1 },
    archetypes: [{ name: 'Backend', level: 'Intern', fit: 'primary' }],
    portals: { negative: ['Junior', 'Internship'] },
  });
  assert.equal(neg.filter((n) => n === 'Junior').length, 1);
  assert.equal(neg.filter((n) => n === 'Internship').length, 1);
  assert.equal(neg.includes('word:Intern'), false);
});

test('entryLevelNegatives reads years and levels the way Step 3 does', () => {
  assert.deepEqual(entryLevelNegatives({ years_of_experience: 1.5, archetypes: [] }), ['junior']);
  assert.deepEqual(entryLevelNegatives({ years_of_experience: null, archetypes: [] }), []);
  assert.deepEqual(entryLevelNegatives({ years_of_experience: 3, archetypes: [{ level: 'Senior' }] }), []);
  assert.ok(entryLevelNegatives({ years_of_experience: 5, archetypes: [{ level: 'Student' }] }).includes('internship'));
});
