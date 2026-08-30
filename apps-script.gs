/**
 * TruAido onboarding: the Google Apps Script endpoint.
 *
 * Data path: index.html / phase2.html  ->  this web app  ->  Google Sheet  ->  CSV  ->  HighLevel.
 *
 * ---------------------------------------------------------------------------
 * SETUP, once
 * ---------------------------------------------------------------------------
 *  1. Create a Google Sheet. Extensions -> Apps Script. Paste this file in.
 *  2. Run setupSheet() once from the editor and grant the permissions it asks
 *     for. It writes the header row and, crucially,
 *     formats the EIN, ZIP and every phone column as plain text BEFORE any
 *     data lands. Skip it and Sheets silently turns a Massachusetts EIN
 *     starting 04- into 4, ZIP 02134 into 2134, and reads a leading + as the
 *     start of a formula. Nothing looks wrong until carrier registration is
 *     rejected.
 *  3. Set NOTIFY_EMAIL below.
 *  4. Deploy -> New deployment -> Web app.
 *       Execute as:        Me
 *       Who has access:    Anyone
 *     "Anyone" is required. The customer is not signed in to Google, and an
 *     unauthenticated POST is the whole point.
 *  5. Copy the /exec URL into ENDPOINT at the top of index.html AND phase2.html.
 *  6. Re-deploy as a NEW VERSION after any edit here. Apps Script serves the
 *     last deployed version, not the saved one, so an edit alone changes nothing.
 *     Use Manage deployments -> pencil -> New version -> Deploy so the /exec
 *     URL stays the same and both forms keep working.
 *
 * ---------------------------------------------------------------------------
 * THREE MODES
 * ---------------------------------------------------------------------------
 *  append  (default, and what Phase 1 posts)
 *      Adds a new row. Phase 1 sends no "mode" key at all, so the default has
 *      to stay append forever or the live form breaks.
 *
 *  update  (what Phase 2 posts)
 *      Finds that customer's existing row and writes ONLY the Phase 2 columns
 *      into it. It never duplicates the customer and never touches a Phase 1
 *      answer. The row is found by submission_id, falling back to email.
 *
 *  lookup  (how Phase 2 knows who it is talking to)
 *      Takes an email, or a submission_id, and hands back who that row belongs
 *      to. The email direction is the fallback for someone who lost their link.
 *      The submission_id direction is for the link itself: a magic link opened
 *      on a phone that has never seen this customer's draft knows the key and
 *      nothing else, so one call fills in their name and their trade and the
 *      form stops being generic. There is no password anywhere in this product.
 *
 * ---------------------------------------------------------------------------
 * THE submission_id COLUMN
 * ---------------------------------------------------------------------------
 *  Update mode needs a stable key, and the sheet had none. It is appended as
 *  the last column so every existing column keeps its position and any saved
 *  HighLevel import mapping still matches. ensureSheet() adds it on the next
 *  write, so there is no migration to run by hand.
 *
 *  Rows written before this column existed have it blank. Those customers are
 *  found by email instead, and the lookup adopts the row by writing a fresh
 *  submission_id into it the first time they come back.
 * ---------------------------------------------------------------------------
 */

/**
 * Bumped whenever this file changes in a way a form would notice.
 *
 * Stamped on every reply as "sv". Apps Script serves the last DEPLOYED version
 * rather than the last saved one, and it is easy to end up with a second
 * deployment on a second URL, or an old doPost still defined in another file in
 * the same project. When that happens the forms get answers from code nobody
 * is looking at. A reply with no sv is that, and the form says so out loud.
 */
var SCRIPT_VERSION = '2026-08-30a';

/** Where the "a submission arrived" ping goes. Never the answers themselves. */
var NOTIFY_EMAIL = 'ewing9900@gmail.com';

/** Tab names. */
var SHEET_NAME = 'Onboarding';
var LOG_NAME   = '_log';

/**
 * The output contract. Order and spelling must match COLUMNS in index.html
 * and PHASE2_COLUMNS in phase2.html.
 * Phase 2 and Phase 3 columns are created empty now so the sheet is shaped
 * once and never restructured. A later phase fills them in place.
 */
var COLUMNS = [
  // from Stripe, never asked twice
  'first_name','last_name','email','company_name','address1','city','state','postal_code','timezone','tags',
  // 1.2 / 1.3  Google Business Profile
  'gbp_url','gbp_owner_email','google_review_link','existing_website',
  // 1.4  carrier registration
  'legal_business_name','business_type','has_ein','ein','ein_path','ein_disclosure_version',
  'registered_address','auth_rep_name','auth_rep_title','otp_mobile',
  // 1.5  the business line
  'business_phone','phone_carrier','alert_number','alert_number_2',
  // 1.6 to 1.8  domain, trade, area
  'domain_status','domain_name','registrar','trade','services','top_services',
  'service_area_type','service_radius_mi','service_cities',
  // 1.9  consent
  'tcpa_attested','agency_authorized','signature_name','signed_at','signed_ip','list_source',
  // Phase 2, the build brief
  'story_mode','story_text','story_recording_url','years_in_business','license_number','insured','bonded',
  'certifications','team_size','free_estimates','emergency_service','emergency_hours','financing_offered',
  'warranty_terms','payment_methods','services_declined','logo_status','logo_url','brand_colors','style_pick','design_notes',
  'reactivation_offer','reactivation_type','referral_offer','referral_type','weekly_capacity','slow_months','do_not_contact',
  'avg_job_value','monthly_new_customers','weekly_missed_calls','baseline_locked_at','existing_crm','crm_integration',
  'contact_phone','text_ok','cc_email','best_time',
  // Phase 3, drop tracking, maintained by hand
  'photos_status','photos_url','list_status','list_url','list_count',
  'gbp_access_status','domain_access_status','a2p_status','launch_date',
  // operational key, set by this script, not asked
  'submission_id'
];

/**
 * The only columns update mode is allowed to write.
 *
 * This whitelist is the safety property that matters. A Phase 2 payload is a
 * write against a row that already holds a signed consent, an EIN and a
 * carrier filing. Naming what may be written, rather than trusting the client
 * to send only what it should, means a malformed or hostile Phase 2 post can
 * never reach any of that.
 *
 * photos_status is a Phase 3 tracking column, but the ninth Phase 2 screen
 * routes photos, so Phase 2 sets it and Jordan maintains it afterwards.
 *
 * These are contiguous in COLUMNS on purpose. See writeSpan().
 */
var PHASE2_COLUMNS = [
  'story_mode','story_text','story_recording_url',
  'years_in_business','license_number','insured','bonded','certifications','team_size',
  'free_estimates','emergency_service','emergency_hours','financing_offered','warranty_terms',
  'payment_methods','services_declined',
  'logo_status','logo_url','brand_colors','style_pick','design_notes',
  'reactivation_offer','reactivation_type','referral_offer','referral_type',
  'weekly_capacity','slow_months','do_not_contact',
  'avg_job_value','monthly_new_customers','weekly_missed_calls','baseline_locked_at',
  'existing_crm','crm_integration','contact_phone','text_ok','cc_email','best_time',
  'photos_status'
];

/** Columns Sheets would otherwise corrupt. Forced to plain text. */
var TEXT_COLUMNS = [
  'ein', 'postal_code',
  'business_phone', 'otp_mobile', 'alert_number', 'alert_number_2', 'contact_phone',
  'license_number', 'list_count', 'service_radius_mi'
];

/** Columns that must never be blank for a Phase 1 row to be worth having. */
var REQUIRED = [
  'first_name','last_name','email','company_name',
  'legal_business_name','business_type','has_ein',
  'business_phone','otp_mobile','alert_number',
  'domain_status','trade','top_services',
  'tcpa_attested','agency_authorized','signature_name'
];

/* ========================================================================= *
 * Web app entry points
 * ========================================================================= */

/**
 * The forms post text/plain on purpose. A Content-Type of application/json
 * triggers a CORS preflight, and Apps Script cannot answer an OPTIONS
 * request. The write succeeds and the browser reports a failure. Simple
 * request in, JSON string body, read here from e.postData.contents.
 */
function doPost(e) {
  try {
    if (!e || !e.postData || !e.postData.contents) {
      return json({ ok: false, error: 'empty_body' });
    }

    var payload = JSON.parse(e.postData.contents);

    /* Phase 1 shipped before modes existed and sends no mode key. Append has
       to stay the default or the live form stops writing rows. */
    var mode = String(payload.mode || 'append');

    if (mode === 'lookup') return handleLookup(payload);
    if (mode === 'update') return handleUpdate(payload, e);
    return handleAppend(payload, e);

  } catch (err) {
    try {
      logError(err, e && e.postData ? e.postData.contents : '');
    } catch (ignored) {}
    return json({ ok: false, error: String(err) });
  }
}

/** Health check. Open the /exec URL in a browser to confirm the deployment. */
function doGet() {
  return json({
    ok: true,
    service: 'truaido-onboarding',
    columns: COLUMNS.length,
    modes: ['append', 'update', 'lookup']
  });
}

function json(obj) {
  obj.sv = SCRIPT_VERSION;
  return ContentService
    .createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}

/* ========================================================================= *
 * append. Phase 1.
 * ========================================================================= */

function handleAppend(payload, e) {
  var row = payload.row || {};
  var sid = String(payload.submission_id || '');

  var missing = [];
  for (var i = 0; i < REQUIRED.length; i++) {
    if (!String(row[REQUIRED[i]] || '').trim()) missing.push(REQUIRED[i]);
  }
  if (missing.length) {
    return json({ ok: false, error: 'missing_fields', fields: missing });
  }

  /* Written server side rather than trusted from the payload, so the key in
     the sheet is always the key the log was written against. */
  row.submission_id = sid;

  // One lock around read-check-append. The form retries on a failed receipt,
  // so the same submission can legitimately arrive twice.
  var placed = null;
  var lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    if (sid && alreadySeen(sid)) {
      return json({ ok: true, duplicate: true, submission_id: sid });
    }
    var at = appendRow(row);
    logSubmission(sid, payload, e);
    placed = at;
  } finally {
    lock.releaseLock();
  }

  notify(row, placed);
  return json({ ok: true, submission_id: sid });
}

/* ========================================================================= *
 * update. Phase 2.
 * ========================================================================= */

/**
 * Finds the customer's row and writes the Phase 2 answers into it.
 *
 * Blank values are skipped rather than written. A Phase 2 payload carries all
 * 39 columns whether or not the customer answered them, and a skipped question
 * must not blank a value that is already there. contact_phone is the case that
 * proves it: Phase 1 collected it on screen one, and Phase 2 asks again at 2.8.
 * If they leave it alone, the Phase 1 answer has to survive.
 *
 * The consequence, stated plainly: update mode cannot clear a cell back to
 * blank. Nothing in Phase 2 needs to, and the alternative is a form that can
 * erase a paying customer's answers on a half-filled resubmit.
 */
function handleUpdate(payload, e) {
  var row = payload.row || {};
  var sid = String(payload.submission_id || '').trim();
  var email = String(payload.email || row.email || '').trim();

  if (!sid && !email) {
    return json({ ok: false, error: 'no_key' });
  }

  var result;
  var lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    var sh = ensureSheet();
    var found = findRow(sh, sid, email);
    if (!found) {
      return json({ ok: false, error: 'not_found' });
    }

    var written = writeSpan(sh, found.row, row);
    mergeTags(sh, found.row, payload.tags_add, payload.tags_remove);

    /* Adopt a row that predates the submission_id column, so any later write
       for this customer is keyed rather than guessed at from an email. */
    if (sid && !found.submission_id) {
      sh.getRange(found.row, COLUMNS.indexOf('submission_id') + 1).setValue(sid);
    }

    logSubmission(sid, payload, e, 'update row ' + found.row + ', ' + written + ' fields');
    result = { row: found.row, gid: sh.getSheetId(), written: written, matched: found.by };
  } finally {
    lock.releaseLock();
  }

  notifyPhase2(row, result);
  return json({
    ok: true,
    mode: 'update',
    submission_id: sid,
    row: result.row,
    written: result.written,
    matched: result.matched
  });
}

/**
 * Writes the Phase 2 answers as one range operation over one contiguous span.
 *
 * PHASE2_COLUMNS runs unbroken from story_mode to photos_status, so the span
 * between the first and last of them contains nothing else. Reading that span,
 * changing what the customer answered, and writing it back cannot touch a
 * Phase 1 cell, and it costs two calls rather than thirty-nine.
 *
 * The guard is there because that is a fact about COLUMNS, not a law. If
 * someone reorders COLUMNS and breaks the run, this falls back to writing the
 * whitelisted cells one at a time. Slower, and still correct.
 */
function writeSpan(sh, rowIndex, row) {
  var idx = {};
  var lo = COLUMNS.length, hi = -1;
  PHASE2_COLUMNS.forEach(function (c) {
    var i = COLUMNS.indexOf(c);
    if (i < 0) return;
    idx[i] = c;
    if (i < lo) lo = i;
    if (i > hi) hi = i;
  });
  if (hi < 0) return 0;

  var contiguous = true;
  for (var i = lo; i <= hi; i++) {
    if (idx[i] === undefined) { contiguous = false; break; }
  }

  var written = 0;

  if (contiguous) {
    var range = sh.getRange(rowIndex, lo + 1, 1, hi - lo + 1);
    var values = range.getValues()[0];
    for (var c = lo; c <= hi; c++) {
      var v = row[idx[c]];
      if (v === undefined || v === null) continue;
      v = String(v).trim();
      if (!v) continue;
      values[c - lo] = v;
      written++;
    }
    if (written) range.setValues([values]);
  } else {
    PHASE2_COLUMNS.forEach(function (name) {
      var col = COLUMNS.indexOf(name);
      if (col < 0) return;
      var v = row[name];
      if (v === undefined || v === null) return;
      v = String(v).trim();
      if (!v) return;
      sh.getRange(rowIndex, col + 1).setValue(v);
      written++;
    });
  }

  /* Same trap as on append: re-assert plain text on the row we just wrote so a
     leading zero or a leading + survives the write itself. */
  TEXT_COLUMNS.forEach(function (name) {
    var col = COLUMNS.indexOf(name);
    if (col > -1 && idx[col] !== undefined) sh.getRange(rowIndex, col + 1).setNumberFormat('@');
  });

  return written;
}

/**
 * Tags drive every automation HighLevel will ever run for this customer, so
 * Phase 2 adds to them rather than replacing them. Replacing would drop
 * phase1-complete and the a2p path, which is how a build silently stops being
 * picked up by a workflow.
 */
function mergeTags(sh, rowIndex, add, remove) {
  var col = COLUMNS.indexOf('tags');
  if (col < 0) return;
  var cell = sh.getRange(rowIndex, col + 1);
  var current = String(cell.getValue() || '').split(',');

  var out = [], seen = {};
  var drop = {};
  (remove || []).forEach(function (t) { drop[String(t).trim()] = true; });

  current.concat(add || []).forEach(function (t) {
    t = String(t).trim();
    if (!t || seen[t] || drop[t]) return;
    seen[t] = true;
    out.push(t);
  });

  cell.setValue(out.join(','));
}

/* ========================================================================= *
 * lookup. The magic-link fallback.
 * ========================================================================= */

/**
 * Says who a row belongs to, given either an email or a submission_id.
 *
 * Kept deliberately thin. It returns the key, the first name, the business and
 * the trade, which is what the form needs to greet them and seed the trade
 * chips and the offer cards. It does not return their answers, and never
 * anything from the carrier filing. An unauthenticated endpoint that reads back
 * a stranger's EIN would be a far worse trade than the one being made here.
 *
 * The trade it does make, named honestly: someone who guesses a customer's
 * email learns that the address belongs to a TruAido customer, and their trade
 * and business name. Both are on the customer's own website. The alternative
 * is a password, and the brief rules that out in the first line of its friction
 * rules: no account, ever. Lookup by submission_id gives away less again, since
 * the key is an opaque random string rather than something guessable.
 */
function handleLookup(payload) {
  var email = String(payload.email || '').trim();
  var key = String(payload.submission_id || '').trim();
  if (email.indexOf('@') < 1) email = '';
  if (!email && !key) {
    return json({ ok: true, found: false });
  }

  var sid, first, company, trade, done;
  var lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    var sh = ensureSheet();
    var found = findRow(sh, key, email);
    if (!found) {
      return json({ ok: true, found: false });
    }

    var values = sh.getRange(found.row, 1, 1, COLUMNS.length).getValues()[0];
    var at = function (name) {
      var i = COLUMNS.indexOf(name);
      return i > -1 ? String(values[i] == null ? '' : values[i]).trim() : '';
    };

    sid = found.submission_id || key;
    /* A row written before the submission_id column existed. Adopt it now so
       the customer's Phase 2 write is keyed rather than matched on email. */
    if (!found.submission_id) {
      sid = 'p1-adopted-' + Utilities.getUuid().slice(0, 8);
      sh.getRange(found.row, COLUMNS.indexOf('submission_id') + 1).setValue(sid);
    }

    first = at('first_name');
    company = at('company_name');
    trade = at('trade');
    done = !!at('baseline_locked_at');
  } finally {
    lock.releaseLock();
  }

  return json({
    ok: true,
    found: true,
    submission_id: sid,
    first_name: first,
    company_name: company,
    trade: trade,
    phase2_done: done
  });
}

/* ========================================================================= *
 * Row lookup
 * ========================================================================= */

/**
 * submission_id first, email second. Both scan bottom up so the most recent
 * row wins, which is the right answer if a customer ever checks out twice.
 * Returns { row, by, submission_id } or null.
 */
function findRow(sh, sid, email) {
  var last = sh.getLastRow();
  if (last < 2) return null;

  var sidCol = COLUMNS.indexOf('submission_id') + 1;
  var emailCol = COLUMNS.indexOf('email') + 1;
  var sids = sh.getRange(2, sidCol, last - 1, 1).getValues();

  var i;
  if (sid) {
    for (i = sids.length - 1; i >= 0; i--) {
      if (String(sids[i][0]).trim() === sid) {
        return { row: i + 2, by: 'submission_id', submission_id: sid };
      }
    }
  }

  if (email) {
    var want = email.toLowerCase();
    var emails = sh.getRange(2, emailCol, last - 1, 1).getValues();
    for (i = emails.length - 1; i >= 0; i--) {
      if (String(emails[i][0]).trim().toLowerCase() === want) {
        return { row: i + 2, by: 'email', submission_id: String(sids[i][0]).trim() };
      }
    }
  }

  return null;
}

/* ========================================================================= *
 * Sheet writes
 * ========================================================================= */

/** Appends the row and returns { row: <1-based index>, gid: <sheet id> }. */
function appendRow(row) {
  var sh = ensureSheet();
  var values = COLUMNS.map(function (c) {
    var v = row[c];
    return (v === undefined || v === null) ? '' : String(v);
  });
  sh.appendRow(values);

  // appendRow can re-infer a format on a fresh row; re-assert plain text on
  // the row we just wrote so a leading zero or + survives the write itself.
  var r = sh.getLastRow();
  TEXT_COLUMNS.forEach(function (name) {
    var idx = COLUMNS.indexOf(name);
    if (idx > -1) sh.getRange(r, idx + 1).setNumberFormat('@');
  });
  return { row: r, gid: sh.getSheetId() };
}

function logSubmission(sid, payload, e, note) {
  var log = ensureLog();
  log.appendRow([
    new Date(),
    sid,
    payload.phase || '',
    payload.client_submitted_at || '',
    note || (e && e.parameter && e.parameter.ua) || '',
    JSON.stringify(payload)
  ]);
}

function logError(err, body) {
  var log = ensureLog();
  log.appendRow([new Date(), 'ERROR', '', '', String(err), String(body).slice(0, 4000)]);
}

function alreadySeen(sid) {
  var log = ensureLog();
  var last = log.getLastRow();
  if (last < 2) return false;
  var ids = log.getRange(2, 2, last - 1, 1).getValues();
  for (var i = 0; i < ids.length; i++) {
    if (String(ids[i][0]) === sid) return true;
  }
  return false;
}

/* ========================================================================= *
 * Notifications
 * ========================================================================= */

/** Deep link at the tab and the row, not at the file. */
function rowLink(placed) {
  var link = SpreadsheetApp.getActiveSpreadsheet().getUrl();
  if (placed) {
    link += '#gid=' + placed.gid + '&range=A' + placed.row + ':CM' + placed.row;
  }
  return link;
}

/**
 * The four things that have to happen today, written out rather than named.
 *
 * Each one is worded from what the customer actually answered, because the
 * shorthand version of this list ("carrier registration, domain, Google
 * invite, build start") assumed the reader already knew what each one meant
 * and why it could not wait.
 */
function dayZeroSteps(row) {
  var steps = [];

  var a2p;
  if (row.has_ein === 'Yes') {
    a2p = 'Register them with the carriers as a Standard brand, using the EIN and legal\n' +
          '   name in the row. Start here: carrier review takes days, and their number\n' +
          '   cannot send a single text until it clears.';
  } else if (row.ein_path === 'Getting EIN') {
    a2p = 'They are getting a free EIN from the IRS and sending you the number. Text them\n' +
          '   the irs.gov link today, then register as a Standard brand the hour it lands.\n' +
          '   Nothing texts until that registration clears, so the sooner they have it the\n' +
          '   better.';
  } else {
    a2p = 'Register them as a Sole Proprietor brand. Verification is a one time passcode\n' +
          '   to the mobile in otp_mobile, and it has to be answered from that handset.\n' +
          '   Their limits are capped and cannot be raised later, so pace their sends.';
  }
  steps.push(['Get the carrier registration in', a2p]);

  var dom;
  if (row.domain_status === 'Need one') {
    dom = row.domain_name
      ? 'Check ' + row.domain_name + ' is free and register it IN THEIR NAME. If it has\n   gone, come back to them with the closest thing rather than picking silently.'
      : 'They asked us to choose. Register something clean in their name and tell them\n   what you picked.';
  } else if (row.domain_status === 'Have it with login') {
    dom = 'They own ' + (row.domain_name || 'a domain') + ' and have the login. Send the transfer\n' +
          '   request to approve. Chase it, because it sits in an inbox until they act.';
  } else {
    dom = 'They own ' + (row.domain_name || 'a domain') + ' but do not know who holds it. Run WHOIS\n' +
          '   and start chasing today, because this is the one that quietly costs a week.';
  }
  steps.push(['Sort the domain', dom]);

  var gbp;
  if (!row.gbp_owner_email) {
    gbp = 'They do not know who has access to their Google listing. Start the reclaim now\n' +
          '   rather than on day six. If there is no listing at all, create one and put it\n' +
          '   through verification.';
  } else {
    gbp = 'Send the manager invite to ' + row.gbp_owner_email + '. They have to accept it from\n' +
          '   that inbox, and that acceptance is the single most common thing that stalls a\n' +
          '   build in this trade. Text them when you send it.';
  }
  steps.push(['Get access to the Google Business Profile', gbp]);

  steps.push(['Start the site', 
    'Lead with ' + (row.top_services || 'their main services') + '. Those get their own pages\n' +
    '   and rank first. Their service area and everything else you need is in the row.']);

  return steps;
}

/**
 * Tells the owner a submission landed. Deliberately does NOT include the
 * answers. An EIN in an inbox lives there forever, and the sheet is the
 * record. Notify, don't email the data.
 */
function notify(row, placed) {
  if (!NOTIFY_EMAIL) return;
  try {
    var who = [row.first_name, row.last_name].filter(String).join(' ');
    var steps = dayZeroSteps(row).map(function (s, i) {
      return (i + 1) + '. ' + s[0] + '\n   ' + s[1];
    }).join('\n\n');

    var body =
      (row.company_name || who) + ' just finished part one' +
      (row.trade ? ' (' + row.trade + ')' : '') + '.\n' +
      (placed ? 'Sheet row ' + placed.row + '.\n' : '') + '\n' +
      'FOUR THINGS TO DO TODAY. The first three are all waiting on somebody outside\n' +
      'this building, so every hour they sit is an hour added to the launch date.\n\n' +
      steps + '\n\n' +
      'Their answers are in the sheet, at the link below. This email deliberately does\n' +
      'not repeat them: the row holds a tax ID, and an inbox is a bad place to keep one.\n\n' +
      rowLink(placed);

    MailApp.sendEmail(NOTIFY_EMAIL, 'New onboarding: ' + (row.company_name || who), body);
  } catch (err) {
    // A failed notification must never cost us the row.
  }
}

/** Same rule for Phase 2: say it arrived, say where, do not repeat it. */
function notifyPhase2(row, placed) {
  if (!NOTIFY_EMAIL) return;
  try {
    var waiting = [];
    if (row.story_mode === 'Recorded') waiting.push('a voice note about why people hire them');
    if (row.logo_status === 'Texting it') waiting.push('their logo, by text');
    if (row.logo_status === 'Emailing it') waiting.push('their logo, by email');
    if (row.photos_status === 'Waiting') waiting.push('ten or fifteen job photos');

    var body =
      'Part two is in' + (placed ? ' on row ' + placed.row : '') + '. ' +
      (placed ? placed.written + ' fields written.' : '') + '\n\n' +
      'THE BUILD BRIEF IS RELEASED. Everything the site needs to be theirs rather than\n' +
      'generic is now in the row: their story, their trust badges, how they run a job,\n' +
      'and the wording of the campaign that goes to their past customers.\n\n' +
      'THE GUARANTEE BASELINE IS LOCKED AND DATED. That is the starting line the 90 day\n' +
      'promise is measured from, and it can only be captured before launch. It is done.\n\n' +
      (waiting.length
        ? 'THEY STILL OWE YOU: ' + waiting.join(', ') + '.\n' +
          'They have the number, so no chasing text is needed yet. If nothing arrives in a\n' +
          'day or two, that is when to nudge.\n\n'
        : 'NOTHING IS OUTSTANDING FROM THEM. Photos and logo are both handled.\n\n') +
      'Send pace is set to ' + (row.weekly_capacity || 'an unset number of') + ' jobs a week. The campaign is throttled to\n' +
      'that, so do not send faster than the crew can absorb.\n\n' +
      'Their answers are in the sheet, at the link below. This email deliberately does\n' +
      'not repeat them.\n\n' +
      rowLink(placed);

    MailApp.sendEmail(NOTIFY_EMAIL, 'Phase 2 in: row ' + (placed ? placed.row : '?'), body);
  } catch (err) {
    // A failed notification must never cost us the write.
  }
}

/* ========================================================================= *
 * Setup. Run setupSheet() once, by hand, before the first customer.
 * ========================================================================= */

function setupSheet() {
  var sh = ensureSheet();
  ensureLog();
  SpreadsheetApp.getActiveSpreadsheet().toast('Sheet ready: ' + COLUMNS.length + ' columns, plain-text formats applied.');
  return sh.getName();
}

function ensureSheet() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sh = ss.getSheetByName(SHEET_NAME) || ss.insertSheet(SHEET_NAME);

  if (sh.getMaxColumns() < COLUMNS.length) {
    sh.insertColumnsAfter(sh.getMaxColumns(), COLUMNS.length - sh.getMaxColumns());
  }

  var header = sh.getRange(1, 1, 1, COLUMNS.length);
  var current = header.getValues()[0];
  if (String(current[0]) !== COLUMNS[0] || String(current[COLUMNS.length - 1]) !== COLUMNS[COLUMNS.length - 1]) {
    header.setValues([COLUMNS]);
    header.setFontWeight('bold');
    sh.setFrozenRows(1);
  }

  // The one that will bite you: plain-text the whole column, not just a cell,
  // and do it while the column is still empty.
  TEXT_COLUMNS.forEach(function (name) {
    var idx = COLUMNS.indexOf(name);
    if (idx > -1) sh.getRange(1, idx + 1, sh.getMaxRows(), 1).setNumberFormat('@');
  });

  return sh;
}

function ensureLog() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var log = ss.getSheetByName(LOG_NAME);
  if (!log) {
    log = ss.insertSheet(LOG_NAME);
    log.appendRow(['received_at', 'submission_id', 'phase', 'client_submitted_at', 'note', 'raw_payload']);
    log.getRange(1, 1, 1, 6).setFontWeight('bold');
    log.setFrozenRows(1);
    log.hideSheet();
  }
  return log;
}
