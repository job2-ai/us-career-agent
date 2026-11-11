// The entry-level years cap (modes/_shared.md "Hard caps"): jd-years.mjs's
// CLI says when a JD's stated minimum puts the score at 2.5, and the scoring
// instructions point at it.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { yearsScoreCap, YEARS_SCORE_CAP } from '../jd-years.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const jd = (line) => `About the role\nBuild things.\n\nRequirements\n- ${line}\n`;

test('a clear minimum more than a year above the band caps; one within it does not', () => {
  assert.equal(yearsScoreCap(jd('5+ years of professional software engineering experience'), { years: 0 }).cap, YEARS_SCORE_CAP);
  assert.equal(yearsScoreCap(jd('3+ years of experience building web services'), { years: 1 }).cap, YEARS_SCORE_CAP);
  assert.equal(yearsScoreCap(jd('2+ years of experience building web services'), { years: 1 }).cap, null);
  assert.equal(yearsScoreCap(jd('0-2 years of experience'), { years: 0 }).cap, null);
});

test('preferred, skill-only, "or equivalent" and unstated figures never cap', () => {
  for (const line of [
    'Preferred: 5+ years of experience in distributed systems',
    '5+ years of experience with Kubernetes',
    "Bachelor's degree and 5 years of experience, or an equivalent combination of education and experience",
    'A strong grasp of data structures',
  ]) {
    const r = yearsScoreCap(jd(line), { years: 0 });
    assert.equal(r.cap, null, `${line} -> ${JSON.stringify(r)}`);
  }
});

test('the CLI reads the JD from stdin and prints the cap with a reason', () => {
  const res = spawnSync(process.execPath, [join(ROOT, 'jd-years.mjs'), '--years', '0'], {
    input: jd('4+ years of professional experience'), encoding: 'utf8',
  });
  assert.equal(res.status, 0, res.stderr);
  const out = JSON.parse(res.stdout);
  assert.equal(out.verdict, 'out');
  assert.equal(out.cap, 2.5);
  assert.match(out.reason, /4\+ years/);
  const bad = spawnSync(process.execPath, [join(ROOT, 'jd-years.mjs')], { input: '', encoding: 'utf8' });
  assert.equal(bad.status, 1);
});

test('modes/_shared.md caps the score at 2.5 for the three entry-level facts', () => {
  const shared = readFileSync(join(ROOT, 'modes', '_shared.md'), 'utf8');
  const section = shared.split('### Hard caps for entry-level candidates')[1]?.split('**Score interpretation:**')[0] ?? '';
  assert.ok(section, 'no Hard caps section before Score interpretation');
  assert.match(section, /node jd-years\.mjs --years/);
  for (const cap of ['Years', 'Sponsorship', 'Graduation window']) assert.match(section, new RegExp(`\\| ${cap} \\|`));
  assert.match(section, /\*\*Capped at 2\.5:\*\*/);
});
