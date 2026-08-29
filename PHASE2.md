# Phase 2 build brief

Handoff for building Phase 2 of the TruAido onboarding. Read `CLAUDE.md` first for
the product context, then the two design documents it links. This file covers what
is already live, what Phase 1 still owes, and what Phase 2 needs.

Written 2026-08-29, after Phase 1 shipped and took its first live test.

---

## Where things actually stand

**Phase 1 is built, deployed, and has processed a real live checkout end to end.**

| Thing | State |
|---|---|
| Form | `index.html`, 9 screens, live at **https://start.truaido.com** (Vercel, auto-deploys on push) |
| Endpoint | `apps-script.gs`, deployed as a web app, `ENDPOINT` in `index.html` points at it |
| Sheet | "TruAido Onboarding", tab `Onboarding` (90 columns) + hidden `_log` |
| Stripe | Live Payment Link, $297/mo, **10-day trial**, ToS URL set, redirect set to `start.truaido.com/?session_id={CHECKOUT_SESSION_ID}` |
| Branch | `claude/onboarding-phase1`, 22 commits |

The whole path works: pay -> redirect -> form -> row in sheet -> notification email.
Verified with a real `cs_live_` checkout on 2026-08-29.

---

## What Phase 1 still owes

Small, none of it blocking Phase 2 work.

1. **Redeploy the Apps Script.** `apps-script.gs` in the repo is ahead of what is
   deployed. The deployed copy still links notification emails at the spreadsheet
   file rather than the specific row. Paste the file in, save, then
   **Manage deployments -> pencil -> New version -> Deploy**. Saving alone does
   nothing; Apps Script serves the last deployed version. Use the pencil so the
   `/exec` URL stays the same and `ENDPOINT` keeps working.
2. **Delete the test rows** from the `Onboarding` tab so row 2 is the first real
   customer. Rows in `_log` are harmless to leave.
3. **Delete the empty `Sheet1` tab.** `File -> Download -> CSV` exports only the
   selected tab, so an empty first tab is a way to export a blank file by accident.
4. **Decide 10 vs 14 day trial.** Launch is meant to be ~day 7. Ten days leaves
   three days of slack against a Google invite nobody accepts or a rejected carrier
   registration, and the landing page and Terms both promise "you don't pay until
   your website is live" in writing. Fourteen days costs four days of revenue and
   buys a week of margin.
5. **Stripe branding contrast.** The brand colour is a very dark navy and Stripe's
   secondary pages (session expired, "let's get you to the right place") render
   dark text on it, which is unreadable. Main checkout is fine. Settings ->
   Business -> Branding.
6. **Merge the landing-page branch.** `wing9900/TruAido-Landing-page`, branch
   `claude/landing-page-onboarding-vhonau`: favicons and the billing-start clause
   in Terms 2, both pushed and unmerged.
7. **Stripe prefill is not wired.** Stripe passes only `session_id`; it does NOT
   append name, email, phone or address. So screen 1 currently shows its fallback
   ("First, who are we building for?") and the customer types nine fields. Fixing
   it needs a Vercel serverless function that exchanges `session_id` for the
   customer via the Stripe API. Also requires enabling phone and billing-address
   collection on the Payment Link, and adding a "Business name" custom field.
   Roughly half a day. This is the single biggest UX win still available.

---

## Phase 2 scope

8 screens, ~7 min, 38 columns already present in the sheet and currently blank.
Full question text is in the onboarding spec at sections 2.1 to 2.8.

| Screen | Columns |
|---|---|
| 2.1 Their story | `story_mode` `story_text` `story_recording_url` |
| 2.2 Brag | `years_in_business` `license_number` `insured` `bonded` `certifications` `team_size` |
| 2.3 How they run a job | `free_estimates` `emergency_service` `emergency_hours` `financing_offered` `warranty_terms` `payment_methods` `services_declined` |
| 2.4 Make it look like you | `logo_status` `logo_url` `brand_colors` `style_pick` `design_notes` |
| 2.5 The campaign | `reactivation_offer` `reactivation_type` `referral_offer` `referral_type` |
| 2.6 Capacity | `weekly_capacity` `slow_months` `do_not_contact` |
| 2.7 Guarantee baseline | `avg_job_value` `monthly_new_customers` `weekly_missed_calls` `baseline_locked_at` |
| 2.8 Tools and contact | `existing_crm` `crm_integration` `contact_phone` `text_ok` `cc_email` `best_time` |

**Add a ninth: photo routing.** No upload. Three taps: "I'll text them over" /
"Pull them from my Facebook or Instagram" / "Use stock for now". Sets
`photos_status`. Reasoning below.

### The prerequisite: update mode

Phase 1 **appends** a row. Phase 2 must **find that customer's existing row and
update it**, without duplicating them and without touching Phase 1 columns.

`doPost` needs a second mode keyed on `submission_id` (fall back to email). Look
the row up, write only the Phase 2 columns, leave everything else alone. Nothing
else in Phase 2 can be built until this exists, and the logo upload depends on it
too. Budget 2-3 hours.

### Identity: magic link, never a login

The brief is absolute: **"No account, ever. No password, no login."**

- Continuing straight from Phase 1: `submission_id` is already in localStorage.
- Coming back later, any device: `?id=<submission_id>` in the URL, texted to them.
- Neither available: ask for their email and look it up.

### Timing: this is more urgent than it looks

The spec says no Phase 2 question may block a launch. But the field map marks four
Phase 2 fields with the blocking dot: `avg_job_value`, `monthly_new_customers`,
`weekly_missed_calls`, `baseline_locked_at`.

Both are right about different things. Those four do not block the **build**, they
block the **guarantee**. The 90-day promise is arithmetic counted from launch, and
without a baseline captured and timestamped before launch, day 90 is an argument
rather than a calculation.

**So Phase 2 must exist before the first customer's launch day (~day 7), not before
their build starts (day 0).** For customer one the escape hatch is a text message
asking the four numbers and typing them into the sheet by hand.

---

## Decisions already made. Do not reopen.

**Voice note: text it, do not build a recorder.** The spec wants an in-form
"Record 60 seconds" because contractors talk about their work fluently and write
about it badly. A texted voice memo delivers that identically for zero code.
MediaRecorder is a full day, most of it Safari/Chrome format differences
(`audio/mp4` vs `audio/webm`), microphone permission states, and iOS Safari's
flaky history. Offer *Type it* / *Text me a voice note* / *Skip, write it from my
reviews*. Revisit only if the texted notes do not arrive.

**Logo: "text it to us", do not build upload yet.** Two of the three spec options
("text it to us", "I don't have one, make me one") need no upload at all. Drive
upload via Apps Script is 7-10 hours once update mode exists, with a real chance of
12 if HEIC gets awkward (iPhones shoot HEIC; Chrome desktop cannot decode it).
That is a lot of work for one optional small file that can arrive by text.

**Photos stay out of the form entirely.** A logo is one small file on a computer.
Job photos are 10-15 large files on a phone's camera roll, 50MB+, uploaded from a
truck on cell data. That upload fails, and a failed upload mid-form is worse than
no upload. Photos are also explicitly non-blocking (launch on trade stock imagery,
swap live any time), and putting them in the form makes them feel mandatory. The
best photos are often ones taken *after* being asked, which a text can prompt and a
form cannot. Route them in the form, collect them by text.

**Style picker (2.4): skip for now.** It calls for "three thumbnails of our own
builds, tap one". There are no builds yet. Generic stock undercuts the premium
framing. Add the screen once there are two or three real sites to show.

**Google Places lookup: still deferred.** Costs money, and the decision stands.

---

## Content that needs Jordan, not the model

**33 reactivation offers.** Screen 2.5 shows three pre-written offers per trade as
editable cards. The spec's example is HVAC: an $89 pre-season tune-up, a free
system health check, or a seasonal reminder with no discount. That is 11 trades x 3
offers, and it is genuinely his pricing judgment. Draft them for his review; do not
put invented pricing in front of a customer unreviewed.

**Certification chips per trade**, seeded: GAF and Owens Corning for roofers,
Carrier/Trane/NATE for HVAC, IICRC for restoration, BBB for everyone. Draft, then
have him sanity-check.

The 11 trades are already in `index.html` as the `TRADES` object, taken from the
landing page: Tree service, Plumbing, Restoration, HVAC, Electrical, Paving,
Moving, Roofing, Remodeling, Auto repair, Other service trade.

---

## Conventions Phase 2 must follow

Match `index.html`. It is the reference implementation.

**Design.** Tokens and type are in `CLAUDE.md`. Archivo variable font, width axis
in use. `color-scheme: light only`. Headings `font-stretch: 120%; font-weight: 780;
letter-spacing: -0.02em`. Buttons `border-radius: 6px; padding: 15px 28px`.
Container `max-width: 1080px; padding: 0 24px`.

**Friction rules.** One decision per screen (not one input: Phase 1 averages three
controls per screen and that is correct). Chips over text fields wherever a set of
options exists. Every optional question carries a visible skip styled as a real
answer. Honest progress ("4 of 8"). Autosave to localStorage on every change.
Validation that offers rather than scolds. Confirm rather than ask where a value is
already known.

**No em dashes or en dashes anywhere**, in copy or in comments. Rewrite the
sentence so it does not need one. `grep -c '—\|–' index.html` must return 0.

**US spelling.** authorize, not authorise. check/uncheck, not tick/untick.

**Voice.** "we" is TruAido, "you" is the customer. Never write a sentence where
"you" could be read as either.

**The format contract is enforced at the output boundary**, in
`normalizeForOutput()`, not in per-screen validation. Validation only runs for
screens visited in the current session, so a resumed draft would otherwise submit
whatever display format was restored. Phones to E.164, money as bare digits, dates
`YYYY-MM-DD`, multi-selects comma-joined, Yes/No spelled out.

**Never clear localStorage without a positive receipt.**

---

## Traps found the hard way in Phase 1

Every one of these was a real bug. Do not re-introduce them.

- **`[hidden]` needs `display: none !important`.** Any class with an explicit
  `display` beats the UA rule and the element stays visible.
- **Programmatic `.focus()` draws a focus ring.** Screens move focus to their
  heading for screen readers; suppress the outline on `tabindex="-1"` headings.
- **`beforeunload -> save()` resurrects a draft the user just cleared.** "Start
  over" needs a flag that suppresses the unload save.
- **Guard navigation past the last screen.** `next()` must return early once on
  the status board, or a stray click advances into a blank state.
- **A new Stripe `session_id` must start a fresh onboarding.** Otherwise a paying
  customer whose device holds a finished draft lands on someone else's status
  board and is never asked anything. Back the old draft up, never delete it.
- **`navigator.share` and the clipboard API need a secure context.** Both are
  inert over plain http, which makes local testing lie about them.
- **Stripe passes no customer data.** Only `session_id`, plus UTMs.
- **Test against a mock endpoint, not the live one.** A test submission writes a
  real row to the production sheet and emails the owner.
- **Stale localStorage makes tests lie.** A page that already restored a submitted
  draft renders the board at load and never re-renders, so later interactions look
  broken when they are not. Reset properly between test runs.
- **Never prefill `legal_business_name` from `company_name`.** They are different
  fields on purpose. For an LLC the legal name almost always carries a suffix the
  trading name lacks, and for a sole proprietor it is often the owner's own name.
  A prefilled box gets confirmed without being read, and the error surfaces days
  later as a rejected carrier registration. Offer it as an explicit tap instead.

---

## Suggested order

1. Update-mode endpoint in `apps-script.gs` (2-3 hrs)
2. The 8 screens plus photo routing (6-8 hrs)
3. Trade content library: certifications and the 33 offers, drafted for review (2-3 hrs)
4. Entry points, identity, resume (1-2 hrs)
5. Testing, including a resumed-draft run and a fresh-checkout run (2-3 hrs)

**Roughly a day and a half to two days**, skipping the recorder and the upload.
