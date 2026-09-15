# CLAUDE.md

Guidance for Claude Code when working in this repo.

## What this is

The personal portfolio site for Christian Bolorinos (cbolorinos.com). A static,
single-page site — no build step, no framework, no package manager. Open
`index.html` in a browser and it runs.

The distinguishing feature is **personalization**: a two-question onboarding
chatbot asks what skills and sector the visitor cares about, then reorders the
portfolio, rewrites the About copy, filters resume bullets, and reveals hidden
case studies to match. There is also a general-purpose chat bubble backed by an
n8n webhook.

## Layout

```
index.html                  entire page + all 14 case-study modals (~860 lines)
assets/css/style.css        all styles, CSS custom properties in :root
assets/js/main.js           UI behavior: preloader, cursor, nav, reveals,
                            typewriter, portfolio filter, modals, chatbot
assets/js/personalize.js    the personalization engine (largest file)
assets/images/works/        case-study images and video
resume_cbolorinos.pdf       downloadable resume
```

Cache-busting is manual: bump the `?v=N` query string on the `<link>` / `<script>`
tags in `index.html` whenever you change CSS or JS, or returning visitors get a
stale file.

## Personalization engine (`personalize.js`)

Read the section banners in the file before editing — it is organized top to
bottom as config → tag maps → flow → apply.

**Two dimensions**, both defined in `QUESTIONS`:

- `skill`: `design`, `strategy`, `creative`, `research`, `automation`
- `sector`: `fintech`, `events`, `learning`, `wellness`, `delivery`, `legal`,
  `relocation`, `industrial`

Options marked `hidden: true` are never shown as buttons. They still exist as
real categories so a free-text "Other" answer or the reconcile webhook can
resolve to them. That is deliberate — AI & Automation and UX Research are only
reachable by visitors who actually ask for them. Do not "fix" this by unhiding
them.

**Either dimension may be left unanswered.** The sector question carries
`skippable: true`, which renders a "No preference" button (`passQuestion`); the
key is simply deleted from `answers` rather than stored as a sentinel. Deep
links behave the same way — `?for=design` answers only the skill. So any code
reading `answers.skill` / `answers.sector`, or the keys from `resolveKey`, must
treat a falsy value as "don't weight this dimension", never as an error. The
existing scorers, `setAboutCopy`, and `applyTagRules` already do.

**The closing summary screen is conditional.** `finish()` only shows the "here's
what I'll do / Okay — show me" step when `usedFreeText` is set, i.e. the visitor
went through "Other" and reconcile. All-preset answers apply straight away —
restating labels the visitor just clicked is a click that tells them nothing.

**Content is tagged in three places**, and all three must stay in sync when a
project or role is added:

| What | Where the tags live |
|---|---|
| Portfolio cards | `PROJECT_TAGS` in `personalize.js`, keyed by `data-modal` |
| Resume bullets | `data-bullet-tags` attribute on each `<li>` in `index.html` |
| Resume roles / skill cards | `RESUME_TAGS` / `SKILL_ITEM_TAGS` in `personalize.js`, matched by a substring of the `<h4>` |

**Skill résumé links (`?skill=design|research|creative`).** These three skills each
have a PDF (`Resume_Product/UX/Branding_cbolorinos.pdf`). A URL naming one swaps
the Resume button to that PDF and makes the Experience section show exactly that
PDF's bullets in the PDF's order (`RESUME_VIEWS` in `personalize.js`, keyed by
`data-bullet` id). The `design` / `research` / `creative` bullet tags mirror the
same lists. When a skill PDF changes, update its `RESUME_VIEWS` list and those
tags together.

Resume bullets tagged `default` are the baseline set shown before any
personalization. Every role should keep at least one.

**Conditional cards** carry `class="card--conditional is-hidden"` plus
`data-reveal-skill`, `data-reveal-sector`, `data-reveal-kw`, and
`data-reveal-filter`. They stay hidden until a visitor's answers match, or until
the matching portfolio filter tab is clicked. `data-reveal-kw` names a key in
`KW_SETS`.

**Curated views (`SECTOR_VIEWS`)** are the one mechanism that can take a
default-visible card OFF the page. The tag scorer only reorders and reveals; a
recruiter link sometimes needs a card gone. Keyed by resolved sector, each view
has `suppress` (data-modal keys removed from the grid) and `feature` (keys pinned
to the front, and revealed even if conditional). Suppression uses
`.card--suppressed`, which is `display:none !important` precisely because the
filter tabs in `main.js` toggle `.is-hidden` and would otherwise put the card
back. `reset()` clears it. Currently one view: `corporate` — drops Nomads and
Hilti, leads with the WSA Global Congress branding and the Ria corporate comms
study. Reached at `?skill=design&sector=corporate`.

**Deep links** let a shared URL pre-answer the onboarding — `?for=design,fintech`,
`?skill=research`, `?for=ai`. Aliases live in `URL_ALIASES`; unrecognized values
are ignored rather than throwing. When adding a category, add its aliases here
too or the deep link silently does nothing.

## External services

Three n8n webhooks, hardcoded near the top of their respective files:

- `main.js` → chat bubble conversation
- `personalize.js` `RESUME_WEBHOOK` → Claude-powered resume bullet filtering
- `personalize.js` `RECONCILE_WEBHOOK` → resolves free-text "Other" answers

Every one has a local fallback. **Personalization must keep working with the
network off** — if you touch these paths, verify the offline path still degrades
to the local tag logic rather than leaving the page blank or mid-transition.

Google Analytics (`G-DXTX6L52LL`) is inline in `<head>`.

## Conventions

- Tabs for indentation, in HTML, CSS, and JS alike.
- Plain ES5-style JS in IIFEs, `var`, no modules, no transpiler. Match it.
- Colors, spacing, radii, and easing come from the CSS custom properties in
  `:root`. Use the variables; don't hardcode hex values.
- Palette: gold `--gold-1/2/deep`, navy `--navy-1/2/3`, ink `--ink`, cream
  `--cream/--cream-2`. Fonts are Montserrat and PT Sans Narrow via Google Fonts.
- Section IDs (`#home`, `#about`, `#works`, `#resume`, `#skills`, `#contact`) are
  load-bearing for the nav scrollspy and smooth scrolling.

## Adding a case study

1. Add the `<article class="card">` in the `#works` grid with `data-groups`
   (a JSON array) and `data-modal`.
2. Add the matching modal in the `<!-- Modals -->` block with `data-modal-id`
   equal to the card's `data-modal`.
3. Add an entry to `PROJECT_TAGS`.
4. Drop assets in `assets/images/works/`.
5. Bump the `?v=` on any file you edited.

## Verifying changes

There are no tests. Check by hand, and check the personalized paths — they are
where regressions hide:

- Load with a cleared `localStorage` and complete the onboarding with preset
  buttons only — it should apply and close itself with no summary step.
- Do it again via "Other" and free text — the summary and confirm button return.
- Answer the skill question, then hit "No preference" on the sector — the
  portfolio should still reorder by skill and the About copy should lose its
  sector sentence rather than showing a blank one.
- Load with `?for=design,fintech` and confirm the reorder happens without the
  onboarding appearing. Then try `?for=design` alone.
- Use the reset control to confirm the page returns to its original order.
- Load with the network blocked and confirm the fallbacks hold.
- Check mobile width — nav toggle, card grid, and modal scrolling.
