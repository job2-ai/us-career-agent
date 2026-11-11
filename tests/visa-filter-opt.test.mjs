// visa_filter.f1_opt: an F-1 student on OPT or STEM OPT also drops postings that turn away F-1, OPT or CPT, or that
// say the employer is not in E-Verify, matched as whole phrases; and onboarding sets it only for OPT and STEM OPT.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildVisaFilter, DEFAULT_OPT_NEGATIVE } from '../scan.mjs';

const opt = buildVisaFilter({ enabled: true, f1_opt: true });
const sponsorOnly = buildVisaFilter({ enabled: true });

test('an OPT candidate skips postings that turn away F-1, OPT or CPT', () => {
  for (const jd of [
    'Note: F-1 students are not eligible for this position.',
    'OPT/CPT not accepted at this time.',
    'Candidates on OPT or CPT candidates will not be considered.',
    'We are unable to support STEM OPT.',
    'This employer does not participate in E-Verify.',
    'Requirements: no OPT, no H-1B transfers.',
  ]) assert.equal(opt(jd), false, jd);
});

test('whole phrases only: option, optimize and adopt are not OPT', () => {
  for (const jd of [
    'You will have the option to work remotely.',
    'No option to relocate; we optimize data pipelines and adopt new tools.',
    'There is no optional travel.',
    'STEM OPT candidates welcome.',
  ]) assert.equal(opt(jd), true, jd);
});

test('a candidate who is not on OPT is not affected by the OPT phrases', () => {
  assert.equal(sponsorOnly('OPT/CPT not accepted at this time.'), true);
  assert.equal(sponsorOnly('We will not sponsor visas.'), false);
});

test('every OPT phrase is lower case, so it matches the lower-cased JD', () => {
  for (const phrase of DEFAULT_OPT_NEGATIVE) assert.equal(phrase, phrase.toLowerCase());
});
