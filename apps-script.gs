/**
 * TruAido onboarding: the Google Apps Script endpoint.
 *
 * Data path: index.html  ->  this web app  ->  Google Sheet  ->  CSV  ->  HighLevel.
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
 *  5. Copy the /exec URL into ENDPOINT at the top of index.html.
 *  6. Re-deploy as a NEW VERSION after any edit here. Apps Script serves the
 *     last deployed version, not the saved one, so an edit alone changes nothing.
 * ---------------------------------------------------------------------------
 */

/** Where the "a submission arrived" ping goes. Never the answers themselves. */
var NOTIFY_EMAIL = 'ewing9900@gmail.com';

/** Tab names. */
var SHEET_NAME = 'Onboarding';
var LOG_NAME   = '_log';

/**
 * The output contract. Order and spelling must match COLUMNS in index.html.
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
  'gbp_access_status','domain_access_status','a2p_status','launch_date'
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
 * The form posts text/plain on purpose. A Content-Type of application/json
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
    var row = payload.row || {};
    var sid = String(payload.submission_id || '');

    var missing = [];
    for (var i = 0; i < REQUIRED.length; i++) {
      if (!String(row[REQUIRED[i]] || '').trim()) missing.push(REQUIRED[i]);
    }
    if (missing.length) {
      return json({ ok: false, error: 'missing_fields', fields: missing });
    }

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

  } catch (err) {
    try {
      logError(err, e && e.postData ? e.postData.contents : '');
    } catch (ignored) {}
    return json({ ok: false, error: String(err) });
  }
}

/** Health check. Open the /exec URL in a browser to confirm the deployment. */
function doGet() {
  return json({ ok: true, service: 'truaido-onboarding', columns: COLUMNS.length });
}

function json(obj) {
  return ContentService
    .createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
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

function logSubmission(sid, payload, e) {
  var log = ensureLog();
  log.appendRow([
    new Date(),
    sid,
    payload.phase || '',
    payload.client_submitted_at || '',
    (e && e.parameter && e.parameter.ua) || '',
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

/**
 * Tells the owner a submission landed. Deliberately does NOT include the
 * answers. An EIN in an inbox lives there forever, and the sheet is the
 * record. Notify, don't email the data.
 */
function notify(row, placed) {
  if (!NOTIFY_EMAIL) return;
  try {
    var who = [row.first_name, row.last_name].filter(String).join(' ');

    /* Link at the tab and row, not at the file. A bare /edit URL opens
       whichever sheet is first, which is how you land on a blank tab. */
    var link = SpreadsheetApp.getActiveSpreadsheet().getUrl();
    if (placed) {
      link += '#gid=' + placed.gid + '&range=A' + placed.row + ':CL' + placed.row;
    }

    var body =
      'A Phase 1 onboarding was submitted.\n\n' +
      'Business: ' + (row.company_name || '(none)') + '\n' +
      'Trade:    ' + (row.trade || '(none)') + '\n' +
      'A2P path: ' + (row.ein_path || '(none)') + '\n' +
      (placed ? 'Sheet row: ' + placed.row + '\n' : '') + '\n' +
      'Day-0 actions this fires: carrier registration, domain, Google invite, build start.\n' +
      'The answers are in the sheet. This message deliberately does not repeat them.\n\n' +
      link;

    MailApp.sendEmail(NOTIFY_EMAIL, 'New onboarding: ' + (row.company_name || who), body);
  } catch (err) {
    // A failed notification must never cost us the row.
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
