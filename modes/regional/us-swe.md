# Mode: us-swe — US SWE Application Calibration

Use this mode when the candidate is targeting software engineering roles in the United States and wants market-specific application calibration before CV generation, form answers, or interview prep. It is written for new grads and early-career candidates first, including F-1 students on OPT or STEM OPT, and works for experienced candidates too.

This mode is advisory. It must not replace official immigration, tax, or labor research, or advice from the candidate's school DSO or an immigration attorney.

## Inputs

1. **JD text or URL** — role title, city and state, work model, stack, level, graduation window, work-authorization wording, and application portal.
2. **CV** at `cv.md` + `article-digest.md` — proof points, real achievements, and graduation date.
3. **Profile** at `config/profile.yml` + `modes/_profile.md` — `candidate.years_of_experience`, `location.visa_status`, `location.needs_sponsorship`, `cv.max_pages`, targets, compensation, and user-specific rules.
4. **Evaluation report** in `reports/` if one already exists.

## Step 1 — Market and Role Classification

Classify the opportunity:

- city and state, or remote with any stated US-state limits
- role family: backend, frontend, full-stack, platform, data, ML, DevOps, mobile, security, embedded
- level: intern, new grad / university grad, entry (Software Engineer I, Associate), mid, senior and above
- graduation window, if the JD names one ("graduating between December 2026 and June 2027", "Class of 2027")
- work model: remote, hybrid, office-first, relocation offered
- core stack and domain
- employer type: private company, staffing or consulting firm, university or research nonprofit, government or defense contractor
- application portal (Workday, Greenhouse, Lever, Ashby, iCIMS, company site) and required fields

If the location or level is unclear, say so and proceed with generic US SWE guidance.

## Step 2 — Hard Filters

Build a table:

| Filter | JD signal | Candidate signal | Risk | Action |
|--------|-----------|------------------|------|--------|
| Level / years | | | pass/risk/blocker/unknown | |
| Graduation window | | | pass/risk/blocker/unknown | |
| Sponsorship | | | pass/risk/blocker/unknown | |
| F-1 / OPT / CPT | | | pass/risk/blocker/unknown | |
| Citizenship / clearance | | | pass/risk/blocker/unknown | |
| Location / work model | | | pass/risk/blocker/unknown | |
| Core stack | | | pass/risk/blocker/unknown | |
| Compensation feasibility | | | pass/risk/blocker/unknown | |

How to fill the rows:

- **Level / years:** run `node jd-years.mjs --years {candidate years} --file {jd file}` and use its verdict. A preferred-only, skill-specific or "or equivalent experience" figure is a risk at most, never a blocker.
- **Graduation window:** compare the JD's window with the graduation date in `cv.md`. If `cv.md` has no date, mark unknown and ask.
- **Sponsorship:** only the JD's own words count ("will not sponsor", "must be authorized to work without sponsorship now or in the future"). A JD that says nothing is unknown, not pass. When `location.needs_sponsorship` is true, run `node plugins/h1b-sponsor/check.mjs "{company}" --json` (if the plugin is enabled) and report the tier and counts as `plugins/h1b-sponsor/skill.md` describes. Filing history is evidence, not a promise for this role.
- **F-1 / OPT / CPT:** a JD that turns away F-1, OPT or CPT candidates, or says the employer is not in E-Verify, is a blocker for an OPT or STEM OPT candidate.
- **Citizenship / clearance:** a JD that requires US citizenship, a green card, or a security clearance is a blocker unless the candidate's profile meets it.

These rows apply the same facts as the entry-level hard caps in `modes/_shared.md`. When a report already exists, reuse its capped score and `hard_stop` entries rather than re-deciding them.

Do not guess missing candidate facts. Mark unknowns and ask only when the answer changes apply/no-apply or generated text.

## Step 3 — Work Authorization Notes

Use these as prompts for what to verify, not as final legal advice.

| Situation | What to check for this application |
|-----------|-----------------------------------|
| F-1 OPT | The job must relate to the candidate's field of study. Check the candidate's OPT dates and unemployment-day limits on official sources (USCIS, Study in the States) at runtime; never state a number from memory. |
| F-1 STEM OPT | The employer must be enrolled in E-Verify. There is no downloadable list: tell the candidate to search https://www.e-verify.gov/e-verify-employer-search , and say it is unverified unless the JD states it. Remind the candidate that a STEM OPT job needs a training plan (Form I-983) with the employer. |
| H-1B needed later | Report DOL filing history from the `h1b-sponsor` plugin. Universities, their affiliated nonprofits, and nonprofit or government research organizations may be cap-exempt; if the employer looks like one, tell the candidate to confirm cap-exempt status from USCIS sources and with the employer, and never assert it. |
| Staffing or consulting firm | If the plugin tier is `staffing-shop`, flag client-site placement so the candidate can weigh it. It is not a reject signal on its own. |
| Government or defense | Clearance and citizenship rules come from the JD and the agency. Mark unknown when the JD is vague. |
| US citizen or green card | Sponsorship and OPT rows pass. Say so in one line and move on. |

Never hardcode current thresholds, fees, lottery numbers, or day counts. If one matters, search official government sources before advising, and cite the page.

## Step 4 — Application Calibration

Produce a concise addendum:

```markdown
## US SWE Calibration: {Company} — {Role}

**Location:** {city, state / remote / unknown}
**Level:** {level}{, graduation window if stated}
**Primary hard filters:** {top 3}
**Main reviewer doubts:** {top 3}

### CV Adjustments
- {one-page check against cv.max_pages; what to cut if it runs over}
- {stack/domain keyword adjustment, only from real experience}
- {impact bullet adjustment: numbers the CV already supports}

### Application Answers
- {"Are you legally authorized to work in the US?" — truthful answer from the profile}
- {"Will you now or in the future require sponsorship?" — truthful answer from the profile}
- {graduation date / availability answer if asked}
- {location / relocation answer if asked}
- {compensation strategy if asked}
- {voluntary self-identification (gender, race/ethnicity, veteran, disability): the candidate's own choice; "decline to answer" is an option on these forms}

### Interview Prep Handoff
- {recruiter screen risks, including how to answer the sponsorship question}
- {hiring-manager proof points}
- {technical topics to prep}

### Facts To Verify
- {official-source checks, with links}
- {candidate facts to confirm}
```

## Step 5 — Handoff

- Use `pdf` mode for the submit-ready CV after calibration.
- Use `apply` mode for portal answers after calibration. It never submits.
- Use `interview-prep` mode when the candidate reaches recruiter, hiring-manager, or technical rounds.
- Store user-specific rules in `modes/_profile.md` or `config/profile.yml`, not in this mode.

## Rules

- Do not invent work authorization, visa status, graduation date, clearance, compensation targets, or relocation availability.
- Never suggest a false answer to a work-authorization or sponsorship question, even to get past a screen.
- Never fill the voluntary self-identification questions for the candidate; leave them to the candidate.
- Do not put visa status, age, a photo, or other personal details on the CV unless the user explicitly asks.
- Do not provide legal advice. Provide verification prompts and cite official sources when legal facts are used.
- Write output in `language.output`, whatever the JD language: that setting is how the user asks for a language.
