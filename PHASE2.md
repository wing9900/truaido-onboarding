# Phase 2: built. What is left.

Phase 2 is written and tested. This file was the build brief; it is now the
record of what got built, what was deliberately left out, and what has to happen
before any of it reaches a customer.

Read `CLAUDE.md` first for the product context, then the two design documents it
links.

Written 2026-08-29, after Phase 1 shipped and took its first live checkout, and
updated the same day when Phase 2 was built.

---

## Deploy this before anyone sees it

**Nothing in Phase 2 works until the Apps Script is redeployed.** The repo copy
was already ahead of the deployed one; it is now much further ahead, and update
mode does not exist in production at all.

1. **Redeploy `apps-script.gs`.** Paste the file in, save, then
   **Manage deployments -> pencil -> New version -> Deploy**. Saving alone does
   nothing; Apps Script serves the last deployed version. Use the pencil so the
   `/exec` URL stays the same and both forms keep working.
   The new script adds a 91st column, `submission_id`, on its next write. There
   is no migration to run.
2. **Merge to the deploy branch.** Vercel builds from `claude/onboarding-phase1`.
   Until this work lands there, `start.truaido.com/phase2.html` is a 404 and the
   button on the Phase 1 status board goes nowhere.

Order matters, but only a little. If `phase2.html` goes live against the old
deployed script, a Phase 2 submission fails loudly and safely: the old `doPost`
does not know the `mode` key, treats the payload as a new Phase 1 row, finds the
required fields missing, and returns an error. The customer sees "the server
turned this down, your answers are safe on this device". Nothing is written, and
nothing is corrupted. Still, redeploy first.

Then the rest of what Phase 1 owed, unchanged:

3. **Delete the test rows** from `Onboarding` so row 2 is the first real
   customer. Rows in `_log` are harmless to leave.
4. **Delete the empty `Sheet1` tab.** `File -> Download -> CSV` exports only the
   selected tab, so an empty first tab is a way to export a blank file by
   accident.
5. **Decide 10 vs 14 day trial.** Launch is meant to be ~day 7. Ten days leaves
   three days of slack against a Google invite nobody accepts or a rejected
   carrier registration, and the landing page and Terms both promise "you don't
   pay until your website is live" in writing. Fourteen days costs four days of
   revenue and buys a week of margin.
6. **Stripe branding contrast.** The brand color is a very dark navy and
   Stripe's secondary pages render dark text on it, which is unreadable. Main
   checkout is fine. Settings -> Business -> Branding.
7. **Merge the landing-page branch.** `wing9900/TruAido-Landing-page`, branch
   `claude/landing-page-onboarding-vhonau`: favicons and the billing-start
   clause in Terms 2, both pushed and unmerged.
8. **Stripe prefill is still not wired.** Stripe passes only `session_id`. Screen
   1 still shows its fallback and the customer types nine fields. Fixing it needs
   a Vercel serverless function that exchanges `session_id` for the customer via
   the Stripe API, plus phone and billing-address collection enabled on the
   Payment Link and a "Business name" custom field. Roughly half a day, and still
   the single biggest UX win available.
9. **Review the offer prices.** See `TRADE-CONTENT.md`. This is the one piece of
   Phase 2 that needs you rather than the model, and the form ships fine without
   it.

---

## What got built

| File | What it is |
|---|---|
| `index.html` | Phase 1, unchanged except for the hand-off card on the status board |
| `phase2.html` | Phase 2. Nine screens plus the completion board |
| `apps-script.gs` | Now three modes: append, update, lookup |
| `TRADE-CONTENT.md` | The 33 offers and the certification chips, drafted for your review |
| `test/mock-endpoint.js` | The real endpoint code over an in-memory sheet |
| `test/run.js` | 143 checks. `node test/run.js` |

### The endpoint

`doPost` dispatches on a `mode` key. Phase 1 sends no `mode` at all, so append
stays the default forever or the live form stops writing rows.

**append** is exactly what it was, plus one line: it writes the payload's
`submission_id` into the row.

**update** finds the customer's row and writes only the Phase 2 columns into it.
Two properties make this safe to point at a row that already holds a signed
consent, an EIN and a carrier filing:

- **A whitelist, not the client's word for it.** `PHASE2_COLUMNS` names the 39
  columns update mode may write. Those 39 happen to be contiguous in `COLUMNS`,
  running unbroken from `story_mode` to `photos_status`, so the write is one
  range operation over a span that contains nothing else. A malformed or hostile
  Phase 2 payload cannot reach a Phase 1 cell. There is a guard and a per-cell
  fallback in case someone later reorders `COLUMNS` and breaks the run.
- **Blank never overwrites.** A Phase 2 payload carries all 39 columns whether or
  not the customer answered them. Skipped questions must not blank what is
  already there, and `contact_phone` is the case that proves it: Phase 1 collects
  it on screen one and Phase 2 asks again at 2.8. The stated cost is that update
  mode cannot clear a cell back to blank. Nothing in Phase 2 needs to, and the
  alternative is a form that erases a paying customer's answers on a half-filled
  resubmit.

Tags are merged rather than replaced, with an explicit add and remove list.
Replacing would drop `phase1-complete` and the a2p path, which is how a build
silently stops being picked up by a workflow it was supposed to trigger.

**lookup** says who a row belongs to, given either an email or a `submission_id`.
It returns the key, the first name, the business and the trade. That is what the
form needs to greet them and seed the trade chips and the offer cards, and it is
all it returns. Never an EIN, never their answers.

Both directions earn their place. The email one is the fallback for someone who
lost their link. The key one is for the link itself: a magic link opened on a
phone that has never seen this customer's draft carries the key and nothing else,
so without it a roofer gets generic chips and generic offers. The call runs in the
background while they are still on screen one, and the generic set is a fine
fallback if it never comes back.

The trade being made there, named honestly: someone who guesses a customer's
email learns the address belongs to a TruAido customer, and their trade and
business name. Both are on that customer's own website. The alternative is a
password, and the first line of the spec's friction rules rules that out. Lookup
by key gives away less again, since the key is an opaque random string.

### The submission_id column

Update mode needed a stable key and the sheet had none. `submission_id` is
appended as the 91st and last column, so every existing column keeps its position
and any saved HighLevel import mapping still matches. `ensureSheet()` adds it on
the next write.

The one row written before this column existed, the real customer from
2026-08-29, has it blank. That row is found by email instead, and the lookup
adopts it by writing a fresh id into it the first time they come back. Row
numbers were considered as the key and rejected: you are about to delete the test
rows, and every stored row number would go stale the moment you did.

### Identity

No account, no password, no login, in that order of insistence.

1. **Straight from Phase 1**, same device: the status board's button carries
   `?id=<submission_id>`, and the Phase 1 draft in localStorage supplies the
   name, business, trade and mobile so nothing is asked twice.
2. **A magic link**, any device: `phase2.html?id=<submission_id>`. This is what
   the day-0 text should send.
3. **Neither**: one screen asking for the checkout email, which resolves through
   lookup mode. If the endpoint cannot be reached at all, they are let through
   keyed on the email rather than stopped, because the write matches on email
   anyway and nothing is lost locally if they mistyped.

### The nine screens

2.1 to 2.8 from the spec, in the spec's order, plus photo routing inserted at
five. It sits with the "what your site looks like" cluster and gives a three-tap
breather between the site block and the campaign block.

None of them blocks anything. The only validation that exists catches a value
that would land in the sheet wrong, never a customer who would rather not answer.
The nearest thing to a stop is on screen six: an offer card tapped but left with
its price blank would send "$____ off any roof repair" to their past customers,
so that gets pointed out once, with the two cards that need no number offered as
the way out. A second press goes through.

The format contract is enforced in `normalizeForOutput()` at the output
boundary, not per screen, for the same reason as Phase 1: validation only runs
for screens visited in this session, so a resumed draft would otherwise submit
whatever display format localStorage restored.

### The board

Not a thank-you. It says what their answers changed, one line each, derived from
what they actually said: whose words the copy comes from, which trust signals
went up, what happens with the logo and the photos, the offer that is now
written, and the send pace. Then the guarantee baseline shown back to them,
locked and dated, because a starting line filed away where they cannot see it is
the same argument on day 90 as no starting line at all.

---

## Decisions that held. Do not reopen.

**Voice note: texted, not recorded.** Offered as "text me, I'd rather say it out
loud". MediaRecorder is a full day of Safari and Chrome format differences and
iOS permission states for something a text message does identically.

**Logo: texted or emailed, no upload.** Both of the spec's non-upload options
are there, plus email, which the Phase 1 board already offers for photos.

**Photos: routed here, collected by text.** Three taps setting `photos_status`.
A failed 50MB upload from a truck on cell data is worse than no upload, and
putting photos in the form makes them feel mandatory when they are explicitly
not.

**Style picker: still skipped.** It calls for three thumbnails of our own
builds. There are none yet. `style_pick` stays blank and the screen appears the
day there are two or three real sites to show.

**Google Places lookup: still deferred.**

---

## Two values added to the field map

Both are additions to a dropdown's value list, not new columns. Noted here so
the field map and the sheet do not quietly drift apart.

- `photos_status` gains **`Pulling from social`**. The field map has
  Waiting / Received / Using stock. "I'll text them over" is Waiting and "use
  stock" is Using stock, but pulling from their Facebook or Instagram is neither:
  we are not waiting on them and we are not using stock.
- `logo_status` gains **`Emailing it`**, alongside Texting it and Need one made.
  `Uploaded` stays in the field map and stays unused until upload is built.

---

## Testing

`node test/run.js`. It needs Playwright and Chromium.

**Phase 1 is live and has taken a real checkout, so nothing is ever tested
against the deployed endpoint.** A test submission there writes a real row into
the production sheet and emails you. Instead, `test/mock-endpoint.js` loads the
**real** `apps-script.gs` into a sandbox with stand-ins for the Apps Script
globals, over an in-memory sheet, and serves both forms from the same origin.
Every call the forms make to `script.google.com` is intercepted and handed to the
mock. Testing a reimplementation of the endpoint would have proved nothing about
the endpoint.

The sheet stub models the format trap on purpose: a numeric-looking string
written to a column nobody plain-texted gets turned into a number, exactly as
Sheets does. So a regression that would eat a ZIP's leading zero fails a test
here rather than a carrier registration in three weeks.

The seven runs: the endpoint contract without a browser, Phase 1 end to end and
straight into Phase 2 from the board link, a magic link on a device with no
draft, the email lookup, a resumed draft with the output contract checked after
the round trip, typed answers that are not one of the chips, and the blind retry
when the first attempt does not come back.

One thing the harness cannot reproduce: the actual CORS failure. A Playwright
`route.fulfill` is not put through the browser's CORS check, and a rewritten
route URL cannot cross from https to http. The test fails the first call at the
network layer instead, which lands in the same place in the client. The mock's
`?cors=0` flag reproduces the real thing in a browser by hand.

---

## Traps from Phase 1, still true

Every one of these was a real bug. Phase 2 carries the same guards.

- **`[hidden]` needs `display: none !important`.** Any class with an explicit
  `display` beats the UA rule and the element stays visible.
- **Programmatic `.focus()` draws a focus ring.** Screens move focus to their
  heading for screen readers; the outline is suppressed on `tabindex="-1"`
  headings.
- **`beforeunload -> save()` resurrects a draft the user just cleared.** "Start
  over" sets a flag that suppresses the unload save.
- **Guard navigation past the last screen.** `next()` returns early once on the
  board.
- **A link for a different build must start a fresh brief.** Same reasoning as
  the Stripe `session_id` check in Phase 1. A forwarded link with a different
  `?id=` backs the old draft up under `_prev` and starts clean.
- **`navigator.share` and the clipboard API need a secure context.**
- **Never clear localStorage without a positive receipt.**
- **Never prefill `legal_business_name` from `company_name`.**

Two more, learned building Phase 2:

- **A skip is not the same as an absence.** "My trade doesn't license" writes
  `None required` into `license_number` rather than leaving it blank, so the
  build knows not to leave a licensed-and-insured badge waiting on a number that
  is never coming.
- **A typed answer needs somewhere to show.** Financing and warranty both accept
  "mine's different". Without a chip of its own, a customer who typed one and
  came back later saw every chip unpressed and no sign of what they said, which
  reads as the form having lost it.

---

## What Phase 2 hands to day 0

Two of the screens promise a text message: "we text you a number" for the voice
note, the logo and the photos. Those texts come from the day-0 sequence, which
needs HighLevel, which waits on first revenue. Until then they are a manual text
from your own phone, and the sheet tells you which ones to send:
`story_mode = Recorded`, `logo_status = Texting it`, `photos_status = Waiting`.

The `phase2-complete` tag releases the build brief. `needs-photos` is dropped
when they chose stock or social, so the reminder ladder does not chase someone
who already told us not to.
