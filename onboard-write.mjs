#!/usr/bin/env node
// Writes config/profile.yml and portals.yml from one JSON file of onboarding
// answers. The templates are copied line for line and only the answered
// fields change, so every comment and every tracked company survives.

import { existsSync, mkdirSync, readFileSync } from 'fs';
import { dirname, join, resolve } from 'path';
import { fileURLToPath } from 'url';
import { loadYaml } from './lib/yaml-document.mjs';
import { compileKeyword, foldTitle } from './title-keywords.mjs';
import { getCareerOpsRoot, getProfilePath } from './path-resolver.mjs';
import { writeFileAtomic } from './tracker-utils.mjs';
import { isMainModule } from './lib/is-main-module.mjs';
import { parsePluginConfig, setPluginEnabled } from './plugins.mjs';
import { indexPath as h1bIndexPath } from './plugins/h1b-sponsor/lib/index.mjs';

const CODE_ROOT = dirname(fileURLToPath(import.meta.url));
const PROFILE_TEMPLATE = join(CODE_ROOT, 'config', 'profile.example.yml');
const PORTALS_TEMPLATE = join(CODE_ROOT, 'templates', 'portals.example.yml');
const DEFAULT_MAX_AGE_DAYS = 45;
const CONTACT_KEYS = ['phone', 'linkedin', 'portfolio_url', 'github', 'twitter'];
const NOT_A_PLACE = /^(remote|hybrid|anywhere|on-?site)$/i;
// AGENTS.md Step 3's entry-level test: under 2 years of experience, or a
// target archetype whose level is Entry, Junior or Graduate. A level that names
// an internship or a student job counts too, and also wants those titles.
const ENTRY_LEVEL = /\b(entry|junior|graduate|new grad)\b/i;
const INTERN_LEVEL = /\b(intern|interns|internship|student|werkstudent|praktikum|praktikant)\b/i;
// Shipped title_filter.negative entries (folded) that reject the titles such
// a search is for. Thesis, apprenticeship and dual-study entries stay.
const ENTRY_LEVEL_NEGATIVES = ['junior'];
const INTERN_LEVEL_NEGATIVES = ['word:intern', 'word:interns', 'internship', 'werkstudent', 'praktikant', 'praktikum'];
// Portal presets layered over the template (portals.preset). newgrad-us is
// picked on its own for an entry-level candidate whose country is the US.
const PRESETS = { 'newgrad-us': join(CODE_ROOT, 'templates', 'portals.newgrad-us.yml') };
const US = /^(united states( of america)?|usa?|u\.s\.(a\.)?)$/i;
// US work authorization (location.work_authorization). A student on OPT or
// STEM OPT can work today but needs H-1B sponsorship to stay, so for the
// evaluation's work-authorization check the US is not in authorized_in.
const WORK_AUTH = {
  us_citizen: { visa_status: 'US citizen', authorized: true },
  green_card: { visa_status: 'US permanent resident (green card)', authorized: true },
  f1_opt: { visa_status: 'F-1 OPT; will need H-1B sponsorship', authorized: false },
  stem_opt: { visa_status: 'F-1 STEM OPT; will need H-1B sponsorship', authorized: false },
  h1b: { visa_status: 'H-1B; needs a sponsor for the transfer', authorized: false },
  other: null,
};
const H1B_PLUGIN = 'h1b-sponsor';
const H1B_INSTALL = 'node plugins/h1b-sponsor/install-h1b-index.mjs';

const USAGE = `
  onboard-write.mjs: write config/profile.yml and portals.yml from onboarding answers

  node onboard-write.mjs --answers <file.json | -> [--target <dir>] [--force] [--only profile|portals]

  Existing files are kept unless --force. --only limits the run to one file. Prints {"written":[],"kept":[]} as JSON.
  Answers shape:
  {
    "candidate": { "full_name", "email", "location", "phone"?, "linkedin"?, "portfolio_url"?, "github"?, "twitter"?, "years_of_experience"? },
    "target_roles": ["..."],
    "compensation": { "target_range", "currency"?, "minimum"?, "location_flexibility"? },
    "location": { "country", "timezone", "city"?, "visa_status"?, "authorized_in"?, "needs_sponsorship"?,
                  "work_authorization"?: "us_citizen" | "green_card" | "f1_opt" | "stem_opt" | "h1b" | "other" },
    "spend_tier": "economy" | "standard" | "premium",
    "cv"?: { "max_pages"?: 1, "strict_pages"?: true },
    "archetypes": [{ "name", "level", "fit": "primary" | "secondary" | "adjacent" }]?,
    "narrative": { "headline"?, "exit_story"?, "superpowers"?: ["..."], "proof_points"?: [{ "name", "url"?, "hero_metric"? }] }?,
    "portals": {
      "positive": ["title keyword", ...],
      "negative": ["extra excluded word", ...],
      "countries": ["United States"],
      "cities": ["Berlin"],
      "max_posting_age_days": 45,
      "experience_filter"?: { "stretch_years"?: 1, "action"?: "label" | "drop" },
      "preset"?: "newgrad-us" | "none"
    }
  }
`;

class AnswerError extends Error {}

function parseArgs(argv) {
  const opts = { force: false };
  const value = (i, flag) => {
    const v = argv[i];
    if (v === undefined || (v.startsWith('-') && v !== '-')) throw new AnswerError(`${flag} needs a value`);
    return v;
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--answers') opts.answers = value(++i, a);
    else if (a === '--target') opts.target = value(++i, a);
    else if (a === '--force') opts.force = true;
    else if (a === '--only') opts.only = value(++i, a);
    else if (a === '--help' || a === '-h') opts.help = true;
    else throw new AnswerError(`unknown argument: ${a}`);
  }
  if (opts.only !== undefined && !['profile', 'portals'].includes(opts.only)) {
    throw new AnswerError(`--only takes profile or portals, got "${opts.only}"`);
  }
  return opts;
}

function list(value) {
  return Array.isArray(value) ? value.map((v) => String(v).trim()).filter(Boolean) : [];
}

function required(value, field) {
  const text = typeof value === 'string' ? value.trim() : '';
  if (!text) throw new AnswerError(`missing answer: ${field}`);
  return text;
}

/**
 * AGENTS.md Step 3's entry-level test, on normalized answers.
 * @returns {false | 'entry' | 'intern'}
 */
export function entryLevel(a) {
  const levels = (a.archetypes || []).map((x) => x.level || '');
  if (levels.some((l) => INTERN_LEVEL.test(l))) return 'intern';
  const years = a.years_of_experience;
  return (typeof years === 'number' && years < 2) || levels.some((l) => ENTRY_LEVEL.test(l)) ? 'entry' : false;
}

function loadPreset(name) {
  const doc = loadYaml(readFileSync(PRESETS[name], 'utf8'));
  return {
    name,
    positive: list(doc.positive),
    // Untrimmed: the template's "Java " carries its trailing space.
    drop_negative: (doc.drop_negative || []).map((n) => foldTitle(String(n))),
    seniority_boost: list(doc.seniority_boost),
  };
}

export function normalizeAnswers(raw) {
  const a = raw && typeof raw === 'object' ? raw : {};
  const candidate = a.candidate || {};
  const location = a.location || {};
  const compensation = a.compensation || {};
  const portals = a.portals || {};
  const roles = list(a.target_roles);
  if (!roles.length) throw new AnswerError('missing answer: target_roles');
  const positive = list(portals.positive);
  if (!positive.length) throw new AnswerError('missing answer: portals.positive');
  const tier = a.spend_tier ?? 'standard';
  if (!['economy', 'standard', 'premium'].includes(tier)) {
    throw new AnswerError(`spend_tier must be economy, standard or premium, got "${tier}"`);
  }
  const places = [...list(portals.countries), ...list(portals.cities)];
  const notPlace = places.find((p) => NOT_A_PLACE.test(p));
  if (notPlace) {
    throw new AnswerError(`portals.countries and portals.cities take places only, not "${notPlace}". An allow-list entry like that admits every country, so leave it out.`);
  }
  const archetypes = Array.isArray(a.archetypes) ? a.archetypes.map((x, i) => ({
    name: required(x?.name, `archetypes[${i}].name`),
    level: x?.level?.trim() || '',
    fit: ['primary', 'secondary', 'adjacent'].includes(x?.fit) ? x.fit : 'primary',
  })) : [];
  const narrative = a.narrative || {};
  const age = portals.max_posting_age_days ?? DEFAULT_MAX_AGE_DAYS;
  if (!Number.isInteger(age) || age < 0) {
    throw new AnswerError('portals.max_posting_age_days must be a whole number of days (0 turns it off)');
  }
  const years = candidate.years_of_experience ?? null;
  if (years !== null && (typeof years !== 'number' || !Number.isFinite(years) || years < 0 || years > 60)) {
    throw new AnswerError('candidate.years_of_experience must be a number from 0 to 60');
  }
  const ef = portals.experience_filter;
  let experienceFilter = null;
  if (ef !== undefined && ef !== null && ef !== false) {
    if (years === null) throw new AnswerError('portals.experience_filter needs candidate.years_of_experience');
    const opts = typeof ef === 'object' ? ef : {};
    const stretch = opts.stretch_years ?? 1;
    if (typeof stretch !== 'number' || !Number.isFinite(stretch) || stretch < 0 || stretch > 60) {
      throw new AnswerError('portals.experience_filter.stretch_years must be a number from 0 to 60');
    }
    const action = opts.action ?? 'label';
    if (action !== 'drop' && action !== 'label') throw new AnswerError('portals.experience_filter.action must be drop or label');
    experienceFilter = { stretch_years: stretch, action };
  }
  // #6325: an optional CV page budget. An entry-level candidate gets one
  // strict page without being asked (US new-grad resumes are one page); a
  // cv answer still wins. Otherwise absent keys stay commented out.
  const cv = a.cv && typeof a.cv === 'object' ? a.cv : {};
  const entry = entryLevel({ years_of_experience: years, archetypes });
  const maxPages = cv.max_pages ?? (entry ? 1 : null);
  if (maxPages !== null && (!Number.isInteger(maxPages) || maxPages < 1)) {
    throw new AnswerError('cv.max_pages must be a whole number of pages, 1 or more');
  }
  const strictPages = cv.strict_pages ?? (entry && maxPages === 1 ? true : null);
  if (strictPages !== null && typeof strictPages !== 'boolean') {
    throw new AnswerError('cv.strict_pages must be true or false');
  }
  const negative = list(portals.negative);
  for (const n of negative) {
    const matches = compileKeyword(foldTitle(n));
    const title = positive.find((p) => matches(foldTitle(p)));
    if (title) throw new AnswerError(`portals.negative "${n}" rejects the title "${title}"`);
  }
  const country = required(location.country, 'location.country');
  const workAuth = location.work_authorization ?? null;
  if (workAuth !== null && !Object.hasOwn(WORK_AUTH, workAuth)) {
    throw new AnswerError(`location.work_authorization must be ${Object.keys(WORK_AUTH).join(', ')}, got "${workAuth}"`);
  }
  const auth = workAuth ? WORK_AUTH[workAuth] : null;
  const authorizedIn = list(location.authorized_in);
  if (auth?.authorized && !authorizedIn.some((c) => US.test(c))) authorizedIn.push('United States');
  // An explicit answer wins over the one the work authorization implies.
  const needsSponsorship = typeof location.needs_sponsorship === 'boolean' ? location.needs_sponsorship : Boolean(auth && !auth.authorized);
  const presetName = portals.preset ?? (entry && US.test(country) ? 'newgrad-us' : 'none');
  if (presetName !== 'none' && !Object.hasOwn(PRESETS, presetName)) {
    throw new AnswerError(`portals.preset must be ${[...Object.keys(PRESETS), 'none'].join(', ')}, got "${presetName}"`);
  }
  const preset = presetName === 'none' ? null : loadPreset(presetName);
  // The preset's keywords go after the candidate's own. One the candidate's
  // negatives reject, or one they already have, is left out.
  const negativeMatchers = negative.map((n) => compileKeyword(foldTitle(n)));
  const seen = new Set(positive.map((x) => foldTitle(x)));
  for (const x of preset?.positive ?? []) {
    if (seen.has(foldTitle(x)) || negativeMatchers.some((m) => m(foldTitle(x)))) continue;
    seen.add(foldTitle(x));
    positive.push(x);
  }
  return {
    candidate: {
      full_name: required(candidate.full_name, 'candidate.full_name'),
      email: required(candidate.email, 'candidate.email'),
      location: required(candidate.location, 'candidate.location'),
      ...Object.fromEntries(CONTACT_KEYS.map((k) => [k, typeof candidate[k] === 'string' ? candidate[k].trim() : ''])),
    },
    years_of_experience: years,
    target_roles: roles,
    compensation: {
      target_range: required(compensation.target_range, 'compensation.target_range'),
      currency: required(compensation.currency, 'compensation.currency'),
      minimum: compensation.minimum?.trim() || '',
      location_flexibility: compensation.location_flexibility?.trim() || '',
    },
    location: {
      country,
      city: location.city?.trim() || '',
      timezone: required(location.timezone, 'location.timezone'),
      visa_status: location.visa_status?.trim() || auth?.visa_status || '',
      authorized_in: authorizedIn,
      needs_sponsorship: needsSponsorship,
    },
    // Needs sponsorship to work in the country they live and search in.
    sponsorship_here: needsSponsorship && !authorizedIn.some((c) => foldTitle(c) === foldTitle(country) || (US.test(c) && US.test(country))),
    // An F-1 student on OPT or STEM OPT: the visa filter also drops postings that turn away F-1, OPT or CPT.
    f1_opt: workAuth === 'f1_opt' || workAuth === 'stem_opt',
    spend_tier: tier,
    cv: { max_pages: maxPages, strict_pages: strictPages },
    archetypes,
    narrative: {
      headline: narrative.headline?.trim() || '',
      exit_story: narrative.exit_story?.trim() || '',
      superpowers: list(narrative.superpowers),
      proof_points: (Array.isArray(narrative.proof_points) ? narrative.proof_points : []).map((x, i) => ({
        name: required(x?.name, `narrative.proof_points[${i}].name`),
        url: x?.url?.trim() || '',
        hero_metric: x?.hero_metric?.trim() || '',
      })),
    },
    portals: {
      positive,
      negative,
      countries: list(portals.countries),
      cities: list(portals.cities),
      max_posting_age_days: age,
      experience_filter: experienceFilter,
      preset,
    },
  };
}

const q = (s) => JSON.stringify(s);

function sectionBounds(lines, section) {
  const start = lines.findIndex((l) => l === `${section}:`);
  if (start < 0) throw new Error(`template has no top-level "${section}:"`);
  let end = start + 1;
  while (end < lines.length && !/^[A-Za-z_]/.test(lines[end])) end++;
  return [start, end];
}

function keyLine(lines, section, key) {
  const [start, end] = sectionBounds(lines, section);
  for (let i = start + 1; i < end; i++) {
    if (lines[i].startsWith(`  ${key}:`)) return i;
  }
  throw new Error(`template has no ${section}.${key}`);
}

function setScalar(lines, section, key, value) {
  const i = keyLine(lines, section, key);
  const comment = lines[i].match(/\s+#[^"]*$/)?.[0] ?? '';
  lines[i] = `  ${key}: ${value}${comment}`;
}

function replaceNested(lines, at, nested) {
  let end = at + 1;
  while (end < lines.length && lines[end].startsWith('    ')) end++;
  lines.splice(at + 1, end - at - 1, ...nested);
}

function setList(lines, section, key, items) {
  const at = keyLine(lines, section, key);
  if (items.length) {
    lines[at] = `  ${key}:`;
    replaceNested(lines, at, items);
  } else {
    lines[at] = `  ${key}: []`;
    replaceNested(lines, at, []);
  }
}

function replaceItems(lines, at, items, indent) {
  let end = at + 1;
  while (end < lines.length && lines[end].startsWith(`${indent}- `)) end++;
  lines.splice(at + 1, end - at - 1, ...items.map((s) => `${indent}- ${q(s)}`));
}

export function buildProfile(template, a) {
  const lines = template.split('\n');
  for (const [k, v] of Object.entries(a.candidate)) setScalar(lines, 'candidate', k, q(v));
  replaceItems(lines, keyLine(lines, 'target_roles', 'primary'), a.target_roles, '    ');
  setList(lines, 'target_roles', 'archetypes', a.archetypes.map((x) => `    - { name: ${q(x.name)}, level: ${q(x.level)}, fit: ${x.fit} }`));
  setScalar(lines, 'narrative', 'headline', q(a.narrative.headline));
  setScalar(lines, 'narrative', 'exit_story', q(a.narrative.exit_story));
  setList(lines, 'narrative', 'superpowers', a.narrative.superpowers.map((x) => `    - ${q(x)}`));
  setList(lines, 'narrative', 'proof_points', a.narrative.proof_points.map((x) => `    - { name: ${q(x.name)}, url: ${q(x.url)}, hero_metric: ${q(x.hero_metric)} }`));
  for (const [k, v] of Object.entries(a.compensation)) setScalar(lines, 'compensation', k, q(v));
  const { authorized_in, needs_sponsorship, ...loc } = a.location;
  for (const [k, v] of Object.entries(loc)) setScalar(lines, 'location', k, q(v));
  setScalar(lines, 'location', 'authorized_in', `[${authorized_in.map(q).join(', ')}]`);
  setScalar(lines, 'location', 'needs_sponsorship', String(needs_sponsorship));
  if (a.years_of_experience !== null && a.years_of_experience !== undefined) {
    const at = lines.findIndex((l) => /^  # years_of_experience: /.test(l));
    if (at < 0) throw new Error('template has no "# years_of_experience" line');
    lines[at] = `  years_of_experience: ${a.years_of_experience}`;
  }
  const tier = lines.findIndex((l) => l.startsWith('spend_tier:'));
  if (tier < 0) throw new Error('template has no spend_tier');
  lines[tier] = `spend_tier: ${a.spend_tier}`;
  // #6325: uncomment the page-budget lines the example profile ships under cv:.
  for (const key of ['max_pages', 'strict_pages']) {
    const value = a.cv?.[key];
    if (value === null || value === undefined) continue;
    const at = lines.findIndex((l) => l.startsWith(`  # ${key}: `));
    if (at < 0) throw new Error(`template has no "# ${key}" line`);
    lines[at] = `  ${key}: ${value}`;
  }
  return lines.join('\n');
}

function blockAfter(lines, header, nextHeader) {
  const start = lines.findIndex((l) => l === header);
  const next = lines.findIndex((l, i) => i > start && l === nextHeader);
  if (start < 0 || next < 0) throw new Error(`template has no "${header.trim()}" block`);
  return [start, next];
}

/**
 * Shipped negatives (folded) an entry-level candidate's search should not
 * carry: "Junior" for an entry-level candidate, and the internship and student
 * entries too when an archetype's level names one. Empty for everyone else.
 */
export function entryLevelNegatives(a) {
  const level = entryLevel(a);
  if (!level) return [];
  return level === 'intern' ? [...ENTRY_LEVEL_NEGATIVES, ...INTERN_LEVEL_NEGATIVES] : [...ENTRY_LEVEL_NEGATIVES];
}

export function buildPortals(template, a) {
  const p = a.portals;
  const lines = template.split('\n');
  const shippedNegatives = loadYaml(template).title_filter.negative.map((n) => foldTitle(String(n)));

  // Drop shipped negatives that would reject a user positive under the same
  // word:/stem:/substring rules the scanner uses, and the junior/intern ones an
  // entry-level search is looking for, unless the user named them again.
  const userNegatives = new Set(p.negative.map((n) => foldTitle(n)));
  const levelDrops = [...entryLevelNegatives(a), ...(p.preset?.drop_negative ?? [])].filter((n) => !userNegatives.has(n));
  const conflicting = new Set(shippedNegatives.filter((negative) => {
    if (levelDrops.includes(negative)) return true;
    const matches = compileKeyword(negative);
    return p.positive.some((positive) => matches(foldTitle(positive)));
  }));
  const [negStart, negEnd] = blockAfter(lines, '  negative:', '  seniority_boost:');
  for (let i = negEnd - 1; i > negStart; i--) {
    const match = lines[i].match(/^\s+-\s+(.+)$/);
    if (!match) continue;
    let value;
    try { value = loadYaml(match[1]); } catch { continue; }
    if (typeof value === 'string' && conflicting.has(foldTitle(value))) lines.splice(i, 1);
  }
  const [, filteredNegEnd] = blockAfter(lines, '  negative:', '  seniority_boost:');
  let negInsert = filteredNegEnd;
  while (lines[negInsert - 1].trim() === '') negInsert--;
  const extra = [...new Set(p.negative)].filter((n) => !shippedNegatives.includes(foldTitle(n)));
  lines.splice(negInsert, 0, ...extra.map((n) => `    - ${q(n)}`));

  if (p.preset) {
    // The preset's seniority_boost replaces the template's items; the
    // comment under the key stays.
    const at = lines.findIndex((l) => l === '  seniority_boost:');
    if (at < 0) throw new Error('template has no "  seniority_boost:" block');
    let first = at + 1;
    while (/^\s+#/.test(lines[first])) first++;
    let end = first;
    while (end < lines.length && lines[end].startsWith('    - ')) end++;
    lines.splice(first, end - first, `    # From the ${p.preset.name} preset (templates/portals.${p.preset.name}.yml).`,
      ...p.preset.seniority_boost.map((s) => `    - ${q(s)}`));
  }

  // Replace active positive entries only; keep the template's keyword guidance.
  const [posStart, posEnd] = blockAfter(lines, '  positive:', '  negative:');
  const keptPositiveNotes = [];
  for (let i = posStart + 1; i < posEnd; i++) {
    const line = lines[i];
    if (/^\s*#/.test(line) || line.trim() === '') keptPositiveNotes.push(line);
  }
  lines.splice(posStart + 1, posEnd - posStart - 1, ...keptPositiveNotes, ...p.positive.map((s) => `    - ${q(s)}`));

  if (p.max_posting_age_days > 0) {
    const age = lines.findIndex((l) => /^# max_posting_age_days: \d+$/.test(l));
    if (age < 0) throw new Error('template has no "# max_posting_age_days" line');
    lines[age] = `max_posting_age_days: ${p.max_posting_age_days}`;
  }

  if (p.experience_filter) {
    const at = lines.findIndex((l) => l.startsWith('# -- Title filter --'));
    if (at < 0) throw new Error('template has no title-filter section to anchor experience_filter');
    lines.splice(at, 0, 'experience_filter:', '  enabled: true',
      `  stretch_years: ${p.experience_filter.stretch_years}`, `  action: ${p.experience_filter.action}`, '');
  }

  if (a.sponsorship_here) {
    // Drops postings that say they will not sponsor (scan.mjs's default
    // vocabulary); postings that say nothing stay.
    const at = lines.findIndex((l) => l.startsWith('# -- Experience filter'));
    if (at < 0) throw new Error('template has no experience-filter section to anchor visa_filter');
    lines.splice(at, 0, '# Set by onboarding: you need sponsorship where you search.', 'visa_filter:', '  enabled: true',
      ...(a.f1_opt ? ['  f1_opt: true   # also drops postings that turn away F-1, OPT or CPT, or are not in E-Verify'] : []), '');
  }

  if (p.countries.length || p.cities.length) {
    const at = lines.findIndex((l) => l.startsWith('# -- Country-eligibility filter'));
    if (at < 0) throw new Error('template has no country-eligibility section to anchor location_filter');
    const block = ['location_filter:'];
    if (p.countries.length) block.push('  always_allow:', ...p.countries.map((c) => `    - ${q(c)}`));
    block.push('  allow:', ...[...p.countries, ...p.cities].map((c) => `    - ${q(c)}`), '');
    lines.splice(at, 0, ...block);
  }
  return lines.join('\n');
}

function checkProfile(text, a) {
  const p = loadYaml(text);
  const ok = p.candidate.full_name === a.candidate.full_name
    && JSON.stringify(p.target_roles.primary) === JSON.stringify(a.target_roles)
    && p.location.country === a.location.country
    && p.spend_tier === a.spend_tier
    && (a.years_of_experience === null || a.years_of_experience === undefined || p.candidate.years_of_experience === a.years_of_experience)
    && ['max_pages', 'strict_pages'].every((k) => a.cv?.[k] === null || a.cv?.[k] === undefined || p.cv?.[k] === a.cv[k]);
  if (!ok) throw new Error('profile.yml did not read back as written');
}

function checkPortals(text, templateText, a) {
  const c = loadYaml(text);
  const t = loadYaml(templateText);
  const ok = JSON.stringify(c.title_filter.positive) === JSON.stringify(a.portals.positive)
    && c.tracked_companies.length === t.tracked_companies.length
    && (!a.portals.preset || JSON.stringify(c.title_filter.seniority_boost) === JSON.stringify(a.portals.preset.seniority_boost))
    && (a.portals.max_posting_age_days > 0 ? c.max_posting_age_days === a.portals.max_posting_age_days : c.max_posting_age_days === undefined)
    && (a.portals.experience_filter
      ? c.experience_filter?.stretch_years === a.portals.experience_filter.stretch_years && c.experience_filter?.action === a.portals.experience_filter.action
      : c.experience_filter === undefined)
    && (a.sponsorship_here ? c.visa_filter?.enabled === true && (c.visa_filter.f1_opt === true) === Boolean(a.f1_opt) : c.visa_filter === undefined);
  if (!ok) throw new Error('portals.yml did not read back as written');
}

/**
 * Turn the h1b-sponsor plugin on in config/plugins.yml for a US candidate who
 * needs sponsorship. An entry already there, on or off, is the user's and is
 * left alone. Returns whether this run enabled it.
 */
export function enableSponsorPlugin(root) {
  const file = join(root, 'config', 'plugins.yml');
  const cfg = parsePluginConfig(existsSync(file) ? readFileSync(file, 'utf8') : null, file);
  if (cfg.plugins?.[H1B_PLUGIN] && typeof cfg.plugins[H1B_PLUGIN].enabled === 'boolean') return false;
  setPluginEnabled(root, H1B_PLUGIN, true);
  return true;
}

function readAnswers(source) {
  if (!source) throw new AnswerError('--answers <file.json | -> is required');
  const text = source === '-' ? readFileSync(0, 'utf8') : readFileSync(resolve(source), 'utf8');
  try {
    return JSON.parse(text);
  } catch (err) {
    throw new AnswerError(`answers are not valid JSON: ${err.message}`);
  }
}

export function main(argv = process.argv.slice(2)) {
  const opts = parseArgs(argv);
  if (opts.help) {
    console.log(USAGE);
    return 0;
  }
  const answers = normalizeAnswers(readAnswers(opts.answers));
  const root = opts.target ? resolve(opts.target) : getCareerOpsRoot();
  const targets = [
    {
      key: 'profile',
      rel: 'config/profile.yml',
      path: getProfilePath(opts.target ? root : undefined),
      build: () => {
        const text = buildProfile(readFileSync(PROFILE_TEMPLATE, 'utf8'), answers);
        checkProfile(text, answers);
        return text;
      },
    },
    {
      key: 'portals',
      rel: 'portals.yml',
      path: opts.target ? join(root, 'portals.yml') : (process.env.CAREER_OPS_PORTALS || join(root, 'portals.yml')),
      build: () => {
        const template = readFileSync(PORTALS_TEMPLATE, 'utf8');
        const text = buildPortals(template, answers);
        checkPortals(text, template, answers);
        return text;
      },
    },
  ];
  const planned = targets.map((t) => ({
    ...t,
    keep: (opts.only !== undefined && opts.only !== t.key) || (existsSync(t.path) && !opts.force),
  }));
  const texts = planned.map((t) => (t.keep ? null : t.build()));
  planned.forEach((t, i) => {
    if (t.keep) return;
    mkdirSync(dirname(t.path), { recursive: true });
    writeFileAtomic(t.path, texts[i]);
  });
  const out = {
    written: planned.filter((t) => !t.keep).map((t) => t.rel),
    kept: planned.filter((t) => t.keep).map((t) => t.rel),
  };
  // The plugin reads a local index of DOL filings (about 8 MiB). Installing it
  // is the user's one network step, so it is printed, never run from here.
  const profileWritten = !planned.find((t) => t.key === 'profile').keep;
  if (profileWritten && answers.sponsorship_here && US.test(answers.location.country) && enableSponsorPlugin(root)) {
    out.plugins_enabled = [H1B_PLUGIN];
    let installed = false;
    try { installed = existsSync(h1bIndexPath()); } catch { /* a blank H1B_INDEX_PATH: not installed */ }
    if (!installed) {
      out.next = [H1B_INSTALL];
      console.error(`onboard-write: enabled ${H1B_PLUGIN}. Install its sponsor index once with: ${H1B_INSTALL}`);
    }
  }
  console.log(JSON.stringify(out));
  return 0;
}

if (isMainModule(import.meta.url)) {
  try {
    process.exitCode = main();
  } catch (err) {
    console.error(`onboard-write: ${err.message}`);
    if (err instanceof AnswerError) console.error(USAGE);
    process.exitCode = 1;
  }
}
