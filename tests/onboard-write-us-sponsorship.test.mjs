// US work authorization during onboarding: the profile keys it implies, the
// visa_filter it turns on, the h1b-sponsor plugin it enables (printing the
// index install command, never running it), and the US refusal phrases the
// visa filter's default vocabulary now carries.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import * as yaml from 'js-yaml';
import { describeSpawn } from './helpers/describe-spawn.mjs';
import { normalizeAnswers } from '../onboard-write.mjs';
import { buildVisaFilter } from '../scan.mjs';
import { indexPath as h1bIndexPath } from '../plugins/h1b-sponsor/lib/index.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const SCRIPT = join(ROOT, 'onboard-write.mjs');

const BASE = {
  candidate: { full_name: 'Avery Quinn', email: ['avery.quinn', 'example.test'].join('@'), location: 'Austin, TX', years_of_experience: 0 },
  target_roles: ['Software Engineer'],
  compensation: { target_range: '$110K-130K', currency: 'USD' },
  location: { country: 'United States', timezone: 'America/Chicago' },
  portals: { positive: ['Software Engineer'], negative: [] },
};
const withAuth = (location) => ({ ...BASE, location: { ...BASE.location, ...location } });

function run(answers, setup) {
  const dir = mkdtempSync(join(tmpdir(), 'onboard-sponsor-'));
  mkdirSync(join(dir, 'config'));
  setup?.(dir);
  const file = join(dir, 'answers.json');
  writeFileSync(file, JSON.stringify(answers));
  const env = { ...process.env };
  for (const k of ['CAREER_OPS_ROOT', 'CAREER_OPS_DATA_DIR', 'CAREER_OPS_PROFILE', 'CAREER_OPS_PORTALS', 'H1B_INDEX_PATH']) delete env[k];
  const res = spawnSync(process.execPath, [SCRIPT, '--answers', file, '--target', dir], { encoding: 'utf8', env });
  return { dir, res, read: (p) => readFileSync(join(dir, p), 'utf8') };
}

test('work_authorization fills the profile keys the evaluation reads', () => {
  for (const [auth, needs, authorized] of [
    ['us_citizen', false, true], ['green_card', false, true],
    ['f1_opt', true, false], ['stem_opt', true, false], ['h1b', true, false],
  ]) {
    const a = normalizeAnswers(withAuth({ work_authorization: auth }));
    assert.equal(a.location.needs_sponsorship, needs, auth);
    assert.equal(a.location.authorized_in.includes('United States'), authorized, auth);
    assert.equal(a.sponsorship_here, needs, auth);
    assert.ok(a.location.visa_status, auth);
  }
  const other = normalizeAnswers(withAuth({ work_authorization: 'other' }));
  assert.equal(other.location.needs_sponsorship, false);
  assert.equal(other.location.visa_status, '');
});

test('an explicit answer wins over the work authorization, and an unknown one is refused', () => {
  const a = normalizeAnswers(withAuth({ work_authorization: 'f1_opt', needs_sponsorship: false, visa_status: 'OPT, then a cap-exempt employer' }));
  assert.equal(a.location.needs_sponsorship, false);
  assert.equal(a.location.visa_status, 'OPT, then a cap-exempt employer');
  assert.throws(() => normalizeAnswers(withAuth({ work_authorization: 'j1' })), /work_authorization must be/);
});

test('needing sponsorship somewhere else only does not count as needing it here', () => {
  const a = normalizeAnswers(withAuth({ needs_sponsorship: true, authorized_in: ['USA'] }));
  assert.equal(a.sponsorship_here, false);
});

test('an OPT candidate gets visa_filter, the plugin, and the install command printed', () => {
  const { dir, res, read } = run(withAuth({ work_authorization: 'f1_opt' }));
  try {
    assert.equal(res.status, 0, describeSpawn(res));
    const out = JSON.parse(res.stdout);
    assert.deepEqual(out.plugins_enabled, ['h1b-sponsor']);
    if (!existsSync(h1bIndexPath())) {
      assert.deepEqual(out.next, ['node plugins/h1b-sponsor/install-h1b-index.mjs']);
      assert.match(res.stderr, /install-h1b-index\.mjs/);
    }
    assert.equal(yaml.load(read('portals.yml')).visa_filter.enabled, true);
    assert.equal(yaml.load(read('config/plugins.yml')).plugins['h1b-sponsor'].enabled, true);
    const profile = yaml.load(read('config/profile.yml'));
    assert.equal(profile.location.needs_sponsorship, true);
    assert.equal(existsSync(join(dir, 'data', 'h1b')), false, 'nothing is downloaded');
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('a citizen gets neither, and a plugin entry the user already has is left alone', () => {
  const citizen = run(withAuth({ work_authorization: 'us_citizen' }));
  try {
    assert.equal(citizen.res.status, 0, describeSpawn(citizen.res));
    assert.deepEqual(Object.keys(JSON.parse(citizen.res.stdout)), ['written', 'kept']);
    assert.equal(yaml.load(citizen.read('portals.yml')).visa_filter, undefined);
    assert.equal(existsSync(join(citizen.dir, 'config', 'plugins.yml')), false);
  } finally { rmSync(citizen.dir, { recursive: true, force: true }); }

  const off = run(withAuth({ work_authorization: 'h1b' }), (dir) => {
    writeFileSync(join(dir, 'config', 'plugins.yml'), 'plugins:\n  h1b-sponsor:\n    enabled: false\n  notion:\n    enabled: true\n');
  });
  try {
    assert.equal(off.res.status, 0, describeSpawn(off.res));
    assert.equal(JSON.parse(off.res.stdout).plugins_enabled, undefined);
    const cfg = yaml.load(off.read('config/plugins.yml'));
    assert.equal(cfg.plugins['h1b-sponsor'].enabled, false);
    assert.equal(cfg.plugins.notion.enabled, true);
  } finally { rmSync(off.dir, { recursive: true, force: true }); }
});

test('the default visa vocabulary drops US refusals and keeps postings that only mention clearance', () => {
  const keep = buildVisaFilter({ enabled: true });
  for (const jd of [
    'Applicants must be a U.S. citizen.',
    'We offer no sponsorship now or in the future.',
    'We are unable to sponsor employment visas.',
    'Green card holders only.',
    'This role requires an active security clearance.',
    'Candidates must be able to work without the need for sponsorship.',
    'Open to US citizens or green card holders.',
  ]) assert.equal(keep(jd), false, jd);
  for (const jd of ['No security clearance required. H-1B sponsorship available.', 'We hire globally.', '']) {
    assert.equal(keep(jd), true, jd);
  }
});
