// An entry-level candidate's profile gets a strict one-page CV budget without
// a cv answer; a cv answer still wins, and nobody else gets a budget.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as yaml from 'js-yaml';
import { buildProfile, normalizeAnswers } from '../onboard-write.mjs';
import { cvPageBudgetFrom } from '../theme-style.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const TEMPLATE = readFileSync(join(ROOT, 'config', 'profile.example.yml'), 'utf8');

const BASE = {
  candidate: { full_name: 'Avery Quinn', email: ['avery.quinn', 'example.test'].join('@'), location: 'Lyon, France' },
  target_roles: ['Data Analyst'],
  compensation: { target_range: '38K-45K', currency: 'EUR' },
  location: { country: 'France', timezone: 'Europe/Paris' },
  portals: { positive: ['Data Analyst'], negative: [] },
};

const cvOf = (extra) => {
  const text = buildProfile(TEMPLATE, normalizeAnswers({ ...BASE, ...extra, candidate: { ...BASE.candidate, ...extra.candidate } }));
  return { text, cv: yaml.load(text).cv };
};

test('under two years, or an entry-level archetype, writes one strict page', () => {
  for (const extra of [
    { candidate: { years_of_experience: 0 } },
    { candidate: { years_of_experience: 1.5 } },
    { archetypes: [{ name: 'Analytics', level: 'Graduate', fit: 'primary' }] },
  ]) {
    const { cv } = cvOf(extra);
    assert.equal(cv.max_pages, 1, JSON.stringify(extra));
    assert.equal(cv.strict_pages, true, JSON.stringify(extra));
  }
});

test('a cv answer overrides the entry-level default', () => {
  let { cv } = cvOf({ candidate: { years_of_experience: 1 }, cv: { max_pages: 2 } });
  assert.equal(cv.max_pages, 2);
  assert.equal(cv.strict_pages, undefined, 'two pages chosen by the candidate is not made strict');
  ({ cv } = cvOf({ candidate: { years_of_experience: 1 }, cv: { strict_pages: false } }));
  assert.equal(cv.max_pages, 1);
  assert.equal(cv.strict_pages, false);
});

test('a candidate with two or more years gets no page budget', () => {
  const { text, cv } = cvOf({ candidate: { years_of_experience: 2 } });
  assert.equal(cv.max_pages, undefined);
  assert.equal(cv.strict_pages, undefined);
  assert.match(text, /^ {2}# max_pages: 1$/m);
});

test('generate-pdf reads the written budget as one strict page', () => {
  const { text } = cvOf({ candidate: { years_of_experience: 0 } });
  assert.deepEqual(cvPageBudgetFrom(yaml.load(text).cv), { maxPages: 1, strictPages: true });
});
