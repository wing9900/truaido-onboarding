# TruAido Onboarding

Post-checkout onboarding for **The TruAido System**, a $297/mo marketing system for
contractors and local service businesses. This repo holds the onboarding form the
customer fills out immediately after paying. **Phase 1 is built, deployed and live**
at https://start.truaido.com, and has processed a real checkout end to end. Phase 2 is
specified but not built. This file is the context; **`PHASE2.md` is the current build
brief and the place to start.**

Owner: Jordan Ewing (ewing9900@gmail.com). Solo founder, pre-first-customer.

---

## What the customer bought

$297/mo, month to month, no contract. Deliverables promised on the landing page:

- Custom website build, made to rank locally
- Google Business Profile audit and full optimization
- Missed-call text-back on their business line
- Google review engine (past-customer push, low ratings routed privately to the owner)
- Job generation: week-one reactivation campaign, then repeat and referral campaigns
- Support and site updates included

Guarantees: 30 days money-back, and a 90-day pays-for-itself (billing pauses if jobs
booked through the system haven't covered what they've paid).

**Three promises the onboarding must keep:**
1. "A 10-minute onboarding form" — that is the actual budget, not a marketing round-up.
2. "Same-day build start" — the form must fire day-0 actions on submit.
3. "Nothing is charged today; you don't pay until your website is live."

Stack the product runs on: **HighLevel** (CRM, messaging, campaigns), **Twilio**
(telephony), **Stripe** (billing), **Google** (Business Profile). Jordan is *not*
currently subscribed to HighLevel — the trial expired. Plan is to subscribe when the
first customer pays. Nothing in this repo may depend on HighLevel existing.

---

## The two design documents

Read both before writing code. They are the specification; this file is the context.

- **Onboarding spec** — every question, the phase structure, and the reasoning:
  https://claude.ai/code/artifact/dae82bfa-991a-4dd4-9e76-13f9dd38e95b
- **Field map** — every column name, type, format, and HighLevel mapping:
  https://claude.ai/code/artifact/cd1f2942-b7fe-45ce-86c9-0563a8d1d42c

---

## Architecture

Static site. No build step, no framework, no backend server.

```
index.html          Phase 1 interview (BUILT, live at start.truaido.com)
apps-script.gs      Google Apps Script endpoint (BUILT, deployed)
PHASE2.md           Phase 2 build brief, current state, and what Phase 1 still owes
```

Hosting: Vercel, auto-deploying from `claude/onboarding-phase1` on push. DNS on
Cloudflare, `start` CNAME to Vercel, grey cloud.

Data path: **form → Google Apps Script web app → Google Sheet → (later) CSV → HighLevel.**
Free at every step, no vendor caps.

Deliberately rejected: Tally and other form builders. Reasons, in order — a coded form
emits the field map's exact column formats by construction rather than needing cleanup
before every import; this is the screen a customer sees seconds after paying $297, so it
must match the landing page rather than carry another company's branding; and Phase 1
has no file uploads, which is the main thing form builders buy you.

### The two-phase split — do not collapse this

**Phase 1 (9 screens, ~3 min)** is the only part that blocks anything. It must be
independently submittable and must produce a buildable brief on its own.

**Phase 2 (8 screens, ~7 min)** is site content and campaign detail. **No question in
Phase 2 may block a launch.** Everything there has a defensible default.

This split is the entire abandonment strategy: someone who closes the tab at minute four
still gets a website, still has carrier registration in flight. Building this as one
continuous wizard that only commits at the end destroys that. Build Phase 1 first and
ship it alone.

### Phase 1 screens

1. Confirm name / business / email / mobile (prefilled, one tap)
2. Business phone + optional Google Maps link — identifies their listing
3. Which email owns the Google listing
4. Carrier registration: legal name, entity type, EIN (+ no-EIN branch), registered
   address, authorized rep, verification mobile
5. Business line carrier + where missed-call alerts go
6. Domain: have it with login / have it no access / need one
7. Trade → services chips → top 3 money services
8. Service area (radius or cities)
9. TCPA attestation + agency authorization + typed signature

Then a **status board with live timestamps**, not a thank-you page — "Carrier
registration submitted 2:41pm. Domain secured. Build started." This is the highest-anxiety
moment in the relationship and proof of motion does more for retention than anything in
week one.

---

## Design language — inherit from the landing page

Source: `wing9900/TruAido-Landing-page` → `index.html`. The onboarding must look like a
continuation of it, not a different product.

```
Ink            #10203A     Body text, dark header bar
Secondary      #47546B     Sub-copy
Green CTA      #0E8A5F     hover #0B6E4C
Deep green     #17402A     #1E5B31
Orange         #F5901E     hover #E07F0F
Accent blue    #1D4E89
Rules          #E5E6E8     #E9EBEE
Border grey    #C9CBCF
Selection      #CDEBDD
```

Font: Archivo variable, width axis in use —
`https://fonts.googleapis.com/css2?family=Archivo:wdth,wght@62..125,100..900&display=swap`

Headings use `font-stretch: 120%; font-weight: 780; letter-spacing: -0.02em`.
Buttons: `border-radius: 6px; padding: 15px 28px; font-size: 16px`.
Container: `max-width: 1080px; padding: 0 24px`.

The landing page sets `color-scheme: light only`. **Match it** — this is a branded flow,
not a theme-aware document. Single theme is the correct choice here.

---

## Implementation requirements

From the spec's friction rules. These are not optional polish.

- **No account, ever.** No password, no login.
- **One question per screen.** Thumb-sized targets, numeric keypads for EIN and phone.
- **Chips, not text fields**, wherever a set of options exists. Only four typed fields
  survive the whole of Phase 1: legal name, EIN, signature, and the "don't do" line.
- **Skipping is a visible, legitimate answer** on every optional question.
- **Honest progress** — "4 of 9" and a real elapsed timer, not a bar stuck at 80%.
- **Autosave to localStorage on every change**, resume on return.
- **Validation that offers, never scolds** — a malformed EIN gets "that doesn't look like
  nine digits", never a red wall.
- **Confirm, don't ask** — where a value is known, show it and ask for a nod.

### Format on submit — the field map is an output contract

- Phones to **E.164** (`+19163822904`) before they leave the browser
- EIN as **text**, 9 digits, no dash, leading zeros preserved
- Money as bare digits — no `$`, no commas
- Dates `YYYY-MM-DD`
- Multi-selects comma-joined into one cell
- Yes / No spelled out, consistently

### Known technical traps

**Apps Script and CORS.** A `fetch` with `Content-Type: application/json` triggers a
preflight that Apps Script cannot answer. Use a simple request — `text/plain;charset=utf-8`
with a JSON string body, read server-side via `e.postData.contents`. If reading the
response still fails, fall back to `mode: 'no-cors'` and treat delivery as
sent-but-unconfirmed. **Never clear localStorage until submission is positively
confirmed** — losing a paying customer's onboarding is unrecoverable.

**Google Sheets eats leading characters.** Format the EIN, ZIP, and phone columns as
plain text *before* any data lands. Otherwise a Massachusetts EIN beginning `04-` becomes
`4`, ZIP `02134` becomes `2134`, and a leading `+` can be parsed as a formula. This will
not surface until carrier registration is rejected.

**Never accept a Social Security number.** Not in the EIN field, not in a note. The
registry doesn't want it either — the no-EIN path uses a mobile passcode. An SSN in a log
is a breach-notification obligation in exchange for nothing.

---

## Verified facts — do not re-research

Checked against HighLevel docs and carrier registry sources in August 2026.

**A2P 10DLC branch:** it is not a choice. **With an EIN you must register a Standard
brand; without one you can only register Sole Proprietor.** Sole Prop verifies by
one-time passcode to a **real mobile** — VoIP, CPaaS and app-based numbers fail, which
matters because a contractor's business line often is one. TCR caps the same mobile at
3 sole-prop registrations.

**Sole Proprietor limits:** 1 campaign, 1 phone number, ~1 message/second, 1,000/day to
T-Mobile, 15/min to AT&T. No trust score, no secondary vetting, so **the limits can never
be raised.** Marketing and promotional messages **are permitted** — an earlier draft of
the spec wrongly said otherwise. A first blast to a few hundred contacts fits fine; the
real constraint is that all five message types share one campaign and one fixed pool.

Mitigation: push everyone to the free IRS EIN (irs.gov, ~10 min, issued on screen). The
customer-facing disclosure copy is written verbatim in the spec at 1.4 — use it as-is and
log which version they were shown alongside their choice.

**HighLevel import:** CSV only, not .xlsx and not a live Sheet. Under 30MB. Every row
needs at least one of name, email, phone. The importer is a mapping screen that
auto-matches common fields and can create custom fields inline, so column names need to be
*consistent*, not magic.

**HighLevel standard contact fields:** `firstName` `lastName` `name` `email` `phone`
`companyName` `address1` `city` `state` `postalCode` `country` `website` `timezone`
`dateOfBirth` `gender` `tags` `dnd` `assignedTo` `source`. Map to these rather than
creating duplicates. Note `dnd` is **inverted** — "OK to text: No" means `dnd = true`.

---

## Settled decisions — don't reopen these

- **Google Places API lookup: deferred.** Jordan didn't want the integration cost. The
  form asks for the business phone (and optionally a Maps link) to identify the listing;
  he looks it up manually in ~60 seconds before building. This costs one extra field.
- **EIN is collected on the form**, in the same sheet as everything else, no separate
  file or special handling. It goes on every W-9 a contractor hands out. The one control
  that matters: the form must notify him a submission arrived without emailing the answers.
- **Flat on the contact record.** No HighLevel opportunities or pipeline yet. Add later
  when three builds run at once; nothing here blocks that.
- **HighLevel subscription waits for first revenue.** The form must work without it.
- **Domain live-availability checking** is optional and unbuilt. If wanted, RDAP is the
  cheap path — free, no API key, `404` means unregistered. Caveat: it reports registered
  vs. not, not premium pricing, so the UI should say "tap one and we'll confirm it."

---

## Related repo: the landing page

`wing9900/TruAido-Landing-page` — static, single `index.html` plus `terms.html` and
`privacy.html`. Branch `claude/landing-page-onboarding-vhonau` has two commits **pushed
but not merged**:

- `06080bb` — favicons (the site had never had one; icons generated from
  `images/truaido-icon.png`)
- `ed74a54` — a billing-start clause in Terms §2, because §2 said "billed in advance"
  while the landing page promises nothing is charged until launch, and §5's guarantee
  clocks had no defined start date

---

## Open items, roughly in order

Phase 1 shipped and took a live checkout on 2026-08-29. Sheet created, endpoint
deployed, Stripe ToS URL set, 10-day trial configured, success redirect live.
**`PHASE2.md` carries the full list with reasoning.** In short:

1. **Redeploy the Apps Script.** The repo copy is ahead of the deployed one.
2. **Delete the test rows** from `Onboarding`, and the empty `Sheet1` tab.
3. **Decide 10 vs 14 day trial.** Launch is ~day 7; ten days leaves three days of
   slack against a promise made in writing.
4. **Fix Stripe branding contrast** on the secondary checkout pages.
5. **Wire Stripe prefill.** Stripe passes only `session_id`, so screen 1 currently
   falls back to asking for nine fields. A Vercel function that exchanges the
   session for the customer is about half a day, and is the biggest UX win left.
6. **Build Phase 2.** See `PHASE2.md`.
7. **Merge the landing-page branch.**

## Open questions

- Whether moving from Sole Proprietor to Standard later requires porting the number or
  just re-registering. The disclosure copy says "registering again and waiting on another
  carrier review", true either way, but if there's a porting step it should be stated
  before someone picks the capped path.
- Where the form will be hosted, and therefore the final URL for the Stripe redirect.
