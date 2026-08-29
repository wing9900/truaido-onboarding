/**
 * The test run. Against the mock endpoint, never the live one.
 *
 *   node test/run.js
 *
 * Starts test/mock-endpoint.js, which loads the real apps-script.gs over an
 * in-memory sheet, then serves index.html and phase2.html from the same origin
 * and drives them in headless Chromium. Every request the forms make to
 * script.google.com is intercepted and handed to the mock, so the deployed
 * endpoint and the production sheet are never touched.
 *
 * What it covers:
 *   1  the endpoint contract, without a browser
 *   2  Phase 1 end to end, then straight into Phase 2 from the board link
 *   3  a magic link on a device that has never seen this customer
 *   4  the email lookup, when there is no link and no local draft
 *   5  a resumed draft, and the output contract surviving the round trip
 *   6  the blind retry, when the first attempt does not come back
 */

'use strict';

const { spawn } = require('child_process');

/* Playwright may only be installed globally on this machine. */
let chromium;
try { ({ chromium } = require('playwright')); }
catch (e) { ({ chromium } = require(require('child_process').execSync('npm root -g').toString().trim() + '/playwright')); }

const PORT = 8788;
const BASE = 'http://127.0.0.1:' + PORT;

let passed = 0;
const failures = [];

/* When true, the next call to the endpoint fails at the network layer and
   everything after it succeeds.
   This stands in for the Apps Script quirk the blind retry exists for: a write
   that succeeds while the browser cannot read the reply. The real cause there
   is a missing CORS header, which cannot be reproduced through Playwright,
   because a fulfilled route is not put through the browser's CORS check and a
   rewritten route URL cannot cross from https to http. Both causes land in the
   same place in the client, the fetch promise rejecting, so this exercises the
   branch that matters. The mock's own ?cors=0 flag reproduces the real thing
   in a browser by hand. */
let failFirstCall = false;

function check(name, cond, detail) {
  if (cond) { passed++; console.log('  ok   ' + name); }
  else { failures.push(name + (detail ? '  <-- ' + detail : '')); console.log('  FAIL ' + name + (detail ? '  <-- ' + detail : '')); }
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function post(payload, qs) {
  const r = await fetch(BASE + '/exec' + (qs || ''), {
    method: 'POST',
    headers: { 'Content-Type': 'text/plain;charset=utf-8' },
    body: JSON.stringify(payload)
  });
  return r.json();
}

async function dump() {
  const d = await (await fetch(BASE + '/__dump')).json();
  const rows = d.sheets.Onboarding || [];
  const header = rows[0] || [];
  const recs = rows.slice(1).map((r) => {
    const o = {};
    header.forEach((h, i) => { o[h] = r[i]; });
    return o;
  });
  return { header, recs, mail: d.mail, raw: rows, log: d.sheets._log || [] };
}

const reset = () => fetch(BASE + '/__reset', { method: 'POST' });

/* A complete Phase 1 payload, the shape index.html actually posts. */
function phase1Payload(over) {
  const row = {
    first_name: 'Dale', last_name: 'Rivera', email: 'dale@riveraplumbing.com',
    company_name: 'Rivera Plumbing', address1: '812 Fell St', city: 'Boston', state: 'MA',
    postal_code: '02134', timezone: 'America/New_York', tags: 'phase1-complete,trade-plumbing,a2p-standard,needs-photos,needs-list,needs-gbp-access',
    gbp_url: '', gbp_owner_email: 'dale@riveraplumbing.com', google_review_link: '', existing_website: '',
    legal_business_name: 'Rivera Plumbing LLC', business_type: 'LLC', has_ein: 'Yes',
    ein: '041234567', ein_path: 'Standard', ein_disclosure_version: '',
    registered_address: '', auth_rep_name: 'Dale Rivera', auth_rep_title: 'Owner', otp_mobile: '+16175550142',
    business_phone: '+16175550100', phone_carrier: 'Verizon', alert_number: '+16175550142', alert_number_2: '',
    domain_status: 'Need one', domain_name: 'riveraplumbing.com', registrar: '',
    trade: 'Plumbing', services: 'Drain cleaning,Water heaters', top_services: 'Drain cleaning',
    service_area_type: 'Radius', service_radius_mi: '25', service_cities: '',
    tcpa_attested: 'Yes', agency_authorized: 'Yes', signature_name: 'Dale Rivera',
    signed_at: '2026-08-29', signed_ip: '', list_source: ''
  };
  return Object.assign({
    submission_id: 'p1-test-0001',
    phase: 'phase1',
    client_submitted_at: new Date().toISOString(),
    row: Object.assign(row, (over && over.row) || {})
  }, over && over.top || {});
}

/* ===================================================================== *
 * 1. the endpoint contract
 * ===================================================================== */
async function testEndpoint() {
  console.log('\n1. endpoint contract');
  await reset();

  let res = await post(phase1Payload());
  check('phase 1 appends a row', res.ok === true, JSON.stringify(res));

  let d = await dump();
  check('sheet has one row', d.recs.length === 1, 'rows: ' + d.recs.length);
  check('submission_id is written server side', d.recs[0].submission_id === 'p1-test-0001', String(d.recs[0].submission_id));
  check('ZIP keeps its leading zero', d.recs[0].postal_code === '02134', JSON.stringify(d.recs[0].postal_code));
  check('EIN keeps its leading zero', d.recs[0].ein === '041234567', JSON.stringify(d.recs[0].ein));
  check('phone survives the plus', d.recs[0].business_phone === '+16175550100', String(d.recs[0].business_phone));
  check('the notification does not repeat the EIN', d.mail.length === 1 && d.mail[0].body.indexOf('041234567') === -1);

  /* a duplicate post, which is what the blind retry produces */
  res = await post(phase1Payload());
  d = await dump();
  check('a repeat submission does not duplicate the row', d.recs.length === 1 && res.duplicate === true);

  /* update */
  res = await post({
    mode: 'update', submission_id: 'p1-test-0001', email: 'dale@riveraplumbing.com', phase: 'phase2',
    tags_add: ['phase2-complete'], tags_remove: ['needs-photos'],
    row: {
      story_mode: 'Typed', story_text: 'Third generation, we answer the phone.',
      years_in_business: '18', insured: 'Yes', certifications: 'IICRC certified,BBB accredited',
      weekly_capacity: '6', avg_job_value: '450', monthly_new_customers: '6-15',
      weekly_missed_calls: '4-10', baseline_locked_at: '2026-08-29',
      photos_status: 'Using stock', best_time: 'Mornings',
      contact_phone: '', license_number: '0042110',
      story_recording_url: '', logo_url: '', style_pick: ''
    }
  });
  check('update reports ok', res.ok === true, JSON.stringify(res));
  check('update matched on submission_id', res.matched === 'submission_id', String(res.matched));

  d = await dump();
  check('update did not add a row', d.recs.length === 1, 'rows: ' + d.recs.length);
  check('phase 2 answers landed', d.recs[0].story_text === 'Third generation, we answer the phone.');
  check('numbers land as numbers', d.recs[0].avg_job_value === 450, JSON.stringify(d.recs[0].avg_job_value));
  check('license number keeps its leading zero', d.recs[0].license_number === '0042110', JSON.stringify(d.recs[0].license_number));

  check('the EIN is untouched', d.recs[0].ein === '041234567');
  check('the signature is untouched', d.recs[0].signature_name === 'Dale Rivera');
  check('the consent is untouched', d.recs[0].tcpa_attested === 'Yes');
  check('a blank does not overwrite what phase 1 wrote', d.recs[0].business_phone === '+16175550100');
  check('contact_phone survives a blank phase 2 answer',
    d.recs[0].contact_phone === '' || d.recs[0].contact_phone === undefined,
    JSON.stringify(d.recs[0].contact_phone));

  const tags = String(d.recs[0].tags);
  check('phase2-complete was added', tags.indexOf('phase2-complete') > -1, tags);
  check('phase1-complete survived', tags.indexOf('phase1-complete') > -1, tags);
  check('a2p-standard survived', tags.indexOf('a2p-standard') > -1, tags);
  check('needs-photos was dropped', tags.indexOf('needs-photos') === -1, tags);
  check('needs-list survived', tags.indexOf('needs-list') > -1, tags);
  check('the phase 2 notification does not repeat the story', d.mail.length === 2 && d.mail[1].body.indexOf('Third generation') === -1);

  /* lookup */
  res = await post({ mode: 'lookup', email: 'DALE@riveraplumbing.com' });
  check('lookup is case insensitive', res.found === true && res.submission_id === 'p1-test-0001', JSON.stringify(res));
  check('lookup returns the trade for the chips', res.trade === 'Plumbing', String(res.trade));
  check('lookup does not return the EIN', JSON.stringify(res).indexOf('041234567') === -1, JSON.stringify(res));

  res = await post({ mode: 'lookup', submission_id: 'p1-test-0001' });
  check('lookup also works from the key alone', res.found === true && res.trade === 'Plumbing', JSON.stringify(res));
  check('lookup by key does not mint a second id', res.submission_id === 'p1-test-0001', String(res.submission_id));

  res = await post({ mode: 'lookup', email: 'nobody@example.com' });
  check('an unknown email is simply not found', res.ok === true && res.found === false, JSON.stringify(res));

  res = await post({ mode: 'update', submission_id: 'p1-nope', row: { story_mode: 'Typed' } });
  check('an unknown key is refused rather than guessed at', res.ok === false && res.error === 'not_found', JSON.stringify(res));

  /* a row written before the submission_id column existed */
  await reset();
  const legacy = phase1Payload();
  legacy.submission_id = '';
  legacy.row.email = 'old@example.com';
  await post(legacy);
  d = await dump();
  check('the legacy row has no key', !d.recs[0].submission_id, JSON.stringify(d.recs[0].submission_id));

  res = await post({ mode: 'lookup', email: 'old@example.com' });
  check('lookup adopts a keyless row', res.found === true && String(res.submission_id).indexOf('p1-adopted-') === 0, JSON.stringify(res));
  d = await dump();
  check('the adopted key is written back', d.recs[0].submission_id === res.submission_id);

  res = await post({ mode: 'update', submission_id: '', email: 'old@example.com', row: { story_mode: 'Recorded' } });
  check('update falls back to the email', res.ok === true && res.matched === 'email', JSON.stringify(res));
}

/* ===================================================================== *
 * browser helpers
 * ===================================================================== */
async function openPage(browser, url) {
  const ctx = await browser.newContext();
  const page = await ctx.newPage();

  /* Every call the forms make to the deployed endpoint is handed to the mock
     instead. The request the browser actually built is what gets tested. */
  await page.route('**/macros/s/**', async (route) => {
    const req = route.request();
    if (failFirstCall) {
      failFirstCall = false;
      return route.abort('failed');
    }
    const r = await fetch(BASE + '/exec', {
      method: req.method(),
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: req.method() === 'POST' ? req.postData() : undefined
    });
    const text = await r.text();
    await route.fulfill({
      status: r.status,
      headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
      body: text
    });
  });

  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  await page.goto(url);
  return { ctx, page, errors };
}

async function screen(page) {
  return page.evaluate(() => {
    const on = document.querySelector('.screen.on');
    return on ? Number(on.getAttribute('data-screen')) : -1;
  });
}

/* Click Continue until the board appears. A fixed count silently drifts the
   moment a screen is added. */
async function advanceToBoard(page, cap) {
  for (let i = 0; i < (cap || 12); i++) {
    if (await screen(page) >= 10) return true;
    await page.click('#nextBtn');
    await page.waitForTimeout(60);
  }
  return await screen(page) >= 10;
}

async function setRange(page, sel, value) {
  await page.$eval(sel, (el, v) => {
    el.value = String(v);
    el.dispatchEvent(new Event('input', { bubbles: true }));
  }, value);
}

/* ===================================================================== *
 * 2. Phase 1 end to end, then Phase 2 from the board link
 * ===================================================================== */
async function testFullRun(browser) {
  console.log('\n2. phase 1 end to end, then straight into phase 2');
  await reset();

  const { ctx, page, errors } = await openPage(browser, BASE + '/index.html?session_id=cs_test_abc123');

  /* 1.1 identity. Stripe passes only session_id, so the form opens its edit
     panel and asks. That is the current live behavior. */
  await page.waitForSelector('.screen.on');
  check('phase 1 opens on screen 1', await screen(page) === 1);
  check('the paid banner shows on a checkout arrival', await page.isVisible('#paidBar'));
  check('screen 1 falls back to asking, because Stripe passes no customer', await page.isVisible('#idEdit'));

  await page.fill('#f_first_name', 'Dale');
  await page.fill('#f_last_name', 'Rivera');
  await page.fill('#f_company_name', 'Rivera Plumbing');
  await page.fill('#f_email', 'dale@riveraplumbing.com');
  await page.fill('#f_contact_phone', '6175550142');
  await page.fill('#f_address1', '812 Fell St');
  await page.fill('#f_city', 'Boston');
  await page.fill('#f_state', 'ma');
  await page.fill('#f_postal_code', '02134');
  await page.click('#nextBtn');

  /* 1.2 */
  check('on screen 2', await screen(page) === 2);
  await page.fill('#f_business_phone', '6175550100');
  await page.click('[data-skip="existing_website"]');
  await page.click('#nextBtn');

  /* 1.3 */
  await page.click('[data-owner="same"]');
  await page.click('#nextBtn');

  /* 1.4 */
  check('on screen 4', await screen(page) === 4);
  await page.click('#legalSame');
  await page.fill('#f_legal_business_name', 'Rivera Plumbing LLC');
  await page.click('[data-entity="LLC"]');
  await page.fill('#f_ein', '041234567');
  await page.click('[data-regaddr="same"]');
  await page.fill('#f_auth_rep_name', 'Dale Rivera');
  await page.fill('#f_auth_rep_title', 'Owner');
  await page.fill('#f_otp_mobile', '6175550142');
  await page.click('#nextBtn');

  /* 1.5 */
  check('on screen 5', await screen(page) === 5);
  await page.selectOption('#f_phone_carrier', 'Verizon');
  await page.fill('#f_alert_number', '6175550142');
  await page.click('#nextBtn');

  /* 1.6 */
  await page.click('[data-domain="Need one"]');
  await page.click('#domainSuggest [data-dom]');
  await page.click('#nextBtn');

  /* 1.7 */
  check('on screen 7', await screen(page) === 7);
  await page.click('[data-trade="Plumbing"]');
  await page.click('#topChips [data-top]');
  await page.click('#nextBtn');

  /* 1.8, the radius default is a real answer */
  check('on screen 8', await screen(page) === 8);
  await page.click('#nextBtn');

  /* 1.9 */
  check('on screen 9', await screen(page) === 9);
  await page.check('#f_tcpa_attested');
  await page.check('#f_agency_authorized');
  await page.fill('#f_signature_name', 'Dale Rivera');
  await page.click('#nextBtn');

  await page.waitForSelector('#boardDone:not([hidden])', { timeout: 8000 });
  check('the status board renders', await page.isVisible('#boardDone'));
  check('the send was confirmed, no unconfirmed warning', await page.isHidden('#unconfirmed'));

  let d = await dump();
  check('phase 1 wrote exactly one row', d.recs.length === 1, 'rows: ' + d.recs.length);
  const sid = d.recs[0].submission_id;
  check('the row carries a submission_id', /^p1-/.test(String(sid)), String(sid));
  check('the phone left the browser in E.164', d.recs[0].business_phone === '+16175550100', String(d.recs[0].business_phone));
  check('the ZIP kept its leading zero through the browser', d.recs[0].postal_code === '02134', JSON.stringify(d.recs[0].postal_code));
  check('the EIN kept its leading zero through the browser', d.recs[0].ein === '041234567', JSON.stringify(d.recs[0].ein));
  check('the state was upper-cased', d.recs[0].state === 'MA', String(d.recs[0].state));
  check('phase 2 columns are still empty', !d.recs[0].story_mode && !d.recs[0].avg_job_value);

  /* the hand-off */
  const href = await page.getAttribute('#part2Link', 'href');
  check('the board offers part two', await page.isVisible('#part2Link'));
  check('the link carries the key', href === 'phase2.html?id=' + encodeURIComponent(String(sid)), String(href));

  check('no page errors in phase 1', errors.length === 0, errors.join(' | '));

  /* follow it, in the same context, so the phase 1 draft is in localStorage */
  await page.click('#part2Link');
  await page.waitForSelector('.screen.on');
  check('phase 2 skips the gate when it comes from the board', await screen(page) === 1, 'screen ' + await screen(page));
  check('phase 2 greets them by name', (await page.textContent('#runningWho')).indexOf('Dale') === 0, await page.textContent('#runningWho'));

  await fillPhase2(page);

  await page.waitForSelector('#boardDone:not([hidden])', { timeout: 8000 });
  check('the phase 2 board renders', await page.isVisible('#boardDone'));
  check('phase 2 got a receipt', await page.isHidden('#unconfirmed'));

  d = await dump();
  check('phase 2 updated the row instead of adding one', d.recs.length === 1, 'rows: ' + d.recs.length);
  const r = d.recs[0];

  check('the story landed', String(r.story_text).indexOf('Third generation') === 0, String(r.story_text));
  check('story_mode is a field map value', r.story_mode === 'Typed', String(r.story_mode));
  check('certifications are comma joined into one cell', String(r.certifications).split(',').length === 2, String(r.certifications));
  check('payment methods are comma joined', String(r.payment_methods).split(',').length === 3, String(r.payment_methods));
  check('years is bare digits', r.years_in_business === 18, JSON.stringify(r.years_in_business));
  check('the dollar sign and comma never reached the sheet', r.avg_job_value === 1200, JSON.stringify(r.avg_job_value));
  check('the baseline is dated YYYY-MM-DD', /^\d{4}-\d{2}-\d{2}$/.test(String(r.baseline_locked_at)), String(r.baseline_locked_at));
  check('monthly_new_customers is a field map value', r.monthly_new_customers === '6-15', String(r.monthly_new_customers));
  check('the contact phone left in E.164', String(r.contact_phone) === '+16175559911', String(r.contact_phone));
  check('text_ok is spelled out', r.text_ok === 'Yes', String(r.text_ok));
  check('brand colors carry both picks', String(r.brand_colors).split(',').length === 2, String(r.brand_colors));
  check('the do-not-do line merges chips and free text', String(r.services_declined).indexOf('No mobile homes') > -1 && String(r.services_declined).indexOf('under $500') > -1, String(r.services_declined));
  check('slow months are comma joined month names', String(r.slow_months).indexOf('January') > -1, String(r.slow_months));
  check('the reactivation offer is stored', String(r.reactivation_offer).length > 10, String(r.reactivation_offer));
  check('the reactivation type is a field map value',
    ['Discount', 'Free check', 'Seasonal reminder', 'Custom'].indexOf(String(r.reactivation_type)) > -1, String(r.reactivation_type));
  check('editing the wording makes the offer theirs, not ours', r.reactivation_type === 'Custom', String(r.reactivation_type));
  check('no unfilled blank reached the sheet', String(r.reactivation_offer).indexOf('____') === -1, String(r.reactivation_offer));
  check('photos_status is set by the routing screen', r.photos_status === 'Waiting', String(r.photos_status));
  check('style_pick stays empty, there are no builds to show yet', !r.style_pick);

  check('phase 1 answers are all still there',
    r.ein === '041234567' && r.signature_name === 'Dale Rivera' && r.legal_business_name === 'Rivera Plumbing LLC' && r.business_phone === '+16175550100',
    JSON.stringify({ ein: r.ein, sig: r.signature_name, legal: r.legal_business_name, biz: r.business_phone }));

  const tags = String(r.tags);
  check('the tags gained phase2-complete', tags.indexOf('phase2-complete') > -1, tags);
  check('the tags kept phase1-complete', tags.indexOf('phase1-complete') > -1, tags);
  check('needs-photos stayed, because they are texting them over', tags.indexOf('needs-photos') > -1, tags);

  check('the board shows the locked baseline back to them', await page.isVisible('#lockedCard'));
  check('no page errors in phase 2', errors.length === 0, errors.join(' | '));

  await ctx.close();
  return String(sid);
}

/* Fills all nine Phase 2 screens from wherever it currently is. */
async function fillPhase2(page) {
  page.on('dialog', (dlg) => dlg.accept('IICRC certified'));

  /* 2.1 */
  await page.click('[data-story="Typed"]');
  await page.fill('#f_story_text', 'Third generation. We answer the phone and we show up when we said we would.');
  await page.click('#nextBtn');

  /* 2.2 */
  check('on phase 2 screen 2', await screen(page) === 2);
  const certLabels = await page.$$eval('#certChips [data-cert]', (els) => els.map((e) => e.getAttribute('data-cert')));
  check('certification chips are seeded from the trade',
    certLabels.length > 2 && certLabels.some((c) => /plumb/i.test(c)), certLabels.join(' | '));
  await page.fill('#f_years_in_business', '18');
  await page.fill('#f_team_size', '4');
  await page.click('[data-skip="license_number"]');
  await page.click('[data-insured="Yes"]');
  await page.click('[data-bonded="No"]');
  await page.click('#certChips [data-cert]:nth-of-type(1)');
  await page.click('#certChips [data-cert]:nth-of-type(2)');
  await page.click('#nextBtn');

  /* 2.3 */
  await page.click('[data-est="Yes"]');
  await page.click('[data-emerg="Yes"]');
  await page.click('[data-hours="24/7"]');
  await page.click('[data-fin="Yes"]');
  await page.click('[data-finwho="Wisetack"]');
  await page.click('[data-warranty="2 years on labor"]');
  await page.click('[data-pay="Cash"]');
  await page.click('[data-pay="Check"]');
  await page.click('[data-pay="Credit card"]');
  await page.click('[data-decline="No mobile homes"]');
  await page.fill('#f_decline_other', 'Nothing under $500');
  await page.click('#nextBtn');

  /* 2.4 */
  check('on phase 2 screen 4', await screen(page) === 4);
  await page.click('[data-logo="Texting it"]');
  await page.click('[data-color="pick"]');
  await page.$eval('#f_color_1', (el) => { el.value = '#1d4e89'; el.dispatchEvent(new Event('input', { bubbles: true })); });
  await page.$eval('#f_color_2', (el) => { el.value = '#f5901e'; el.dispatchEvent(new Event('input', { bubbles: true })); });
  await page.fill('#f_design_notes', 'The truck photo on the front page if you can.');
  await page.click('#nextBtn');

  /* photo routing */
  check('the photo routing screen is screen 5', await screen(page) === 5);
  await page.click('[data-photos="Waiting"]');
  await page.click('#nextBtn');

  /* 2.5 */
  check('on phase 2 screen 6', await screen(page) === 6);
  const offers = await page.$$eval('#reactOpts [data-react]', (els) => els.map((e) => e.getAttribute('data-text')));
  check('three offers plus a write-my-own', offers.length === 4, String(offers.length));
  check('no invented price is shown to the customer',
    offers.slice(0, 3).every((t) => !/\$\s?\d/.test(t || '')), offers.join(' | '));
  await page.click('#reactOpts [data-react="Discount"]');
  await page.click('#referOpts [data-refer="Both-sided"]');
  await page.click('#nextBtn');
  check('an unfilled price blank is pointed out rather than sent',
    await page.isVisible('#err6.on') && (await page.textContent('#err6')).indexOf('blank') > -1,
    await page.textContent('#err6'));
  check('and the nudge does not move them off the screen', await screen(page) === 6);
  await page.fill('#f_reactivation_offer', '$40 off any drain or water heater job booked this month.');
  await page.fill('#f_referral_offer', 'Send someone our way and you both get $25 off your next job.');
  await page.click('#nextBtn');
  check('a filled-in price goes straight through', await screen(page) === 7, 'screen ' + await screen(page));

  /* 2.6 */
  await setRange(page, '#f_weekly_capacity', 6);
  await page.click('[data-month="January"]');
  await page.click('[data-month="February"]');
  await page.fill('#f_do_not_contact', 'The Harrisons on Oak St.');
  await page.click('#nextBtn');

  /* 2.7 */
  check('on the baseline screen', await screen(page) === 8);
  await page.fill('#f_avg_job_value', '$1,200');
  await page.click('[data-newc="6-15"]');
  await page.click('[data-missed="4-10"]');
  await page.click('#nextBtn');

  /* 2.8 */
  check('on the last screen', await screen(page) === 9);
  await page.click('[data-crm="Jobber"]');
  check('the integration question only appears once there is something to integrate', await page.isVisible('#crmIntWrap'));
  await page.click('[data-crmint="Yes"]');
  await page.fill('#f_contact_phone', '6175559911');
  await page.click('[data-textok="Yes"]');
  await page.click('[data-skip="cc_email"]');
  await page.click('[data-best="Mornings"]');
  check('the last button says what it does', (await page.textContent('#nextBtn')).indexOf('Send') === 0);
  await page.click('#nextBtn');
}

/* ===================================================================== *
 * 3. a magic link on a device that has never seen this customer
 * ===================================================================== */
async function testMagicLink(browser) {
  console.log('\n3. the magic link, on a device with no draft');
  await reset();
  await post(phase1Payload());

  const { ctx, page, errors } = await openPage(browser, BASE + '/phase2.html?id=p1-test-0001');
  await page.waitForSelector('.screen.on');
  check('a link with a key skips the gate', await screen(page) === 1, 'screen ' + await screen(page));

  /* No Phase 1 draft on this device, so the link arrives knowing the key and
     nothing else. One lookup on the key fills in the rest. */
  await page.waitForFunction(() => /^Dale/.test(document.getElementById('runningWho').textContent), null, { timeout: 6000 });
  check('the key alone is enough to greet them by name', (await page.textContent('#runningWho')).indexOf('Dale') === 0);

  await page.click('[data-story="Write it for me"]');
  await page.click('#nextBtn');
  const certLabels = await page.$$eval('#certChips [data-cert]', (els) => els.map((e) => e.getAttribute('data-cert')));
  check('and to seed the trade chips, with no draft on this device',
    certLabels.some((c) => /plumb/i.test(c)), certLabels.join(' | '));

  const link = await page.evaluate(() => {
    const b = document.getElementById('shareBtn');
    return b ? b.textContent : '';
  });
  check('the share button is there for an interrupted form', link.indexOf('Text me') === 0, link);

  check('no page errors on the magic link path', errors.length === 0, errors.join(' | '));
  await ctx.close();
}

/* ===================================================================== *
 * 4. the email lookup
 * ===================================================================== */
async function testLookup(browser) {
  console.log('\n4. the email lookup, with no link and no draft');
  await reset();
  await post(phase1Payload());

  const { ctx, page, errors } = await openPage(browser, BASE + '/phase2.html');
  await page.waitForSelector('.screen.on');
  check('with no key at all, it asks which build this is', await screen(page) === 0, 'screen ' + await screen(page));
  check('the gate never asks for a password', (await page.content()).indexOf('type="password"') === -1);

  await page.fill('#f_lookup_email', 'nobody@example.com');
  await page.click('#lookupBtn');
  await page.waitForSelector('#err0.on', { timeout: 6000 });
  check('an unknown email is offered a way forward, not a wall',
    (await page.textContent('#err0')).indexOf("can't find") > -1, await page.textContent('#err0'));
  check('a failed lookup leaves them on the gate', await screen(page) === 0);

  await page.fill('#f_lookup_email', 'dale@riveraplumbing.com');
  await page.click('#lookupBtn');
  await page.waitForSelector('[data-screen="1"].on', { timeout: 6000 });
  check('the right email gets them in', await screen(page) === 1);
  check('and it greets them by name', (await page.textContent('#runningWho')).indexOf('Dale') === 0, await page.textContent('#runningWho'));

  const certLabels = await page.$$eval('#certChips [data-cert]', (els) => els.map((e) => e.getAttribute('data-cert')));
  check('the lookup seeded the trade chips', certLabels.some((c) => /plumb/i.test(c)), certLabels.join(' | '));

  check('no page errors on the lookup path', errors.length === 0, errors.join(' | '));
  await ctx.close();
}

/* ===================================================================== *
 * 5. a resumed draft
 * ===================================================================== */
async function testResume(browser) {
  console.log('\n5. a resumed draft, and the contract surviving the round trip');
  await reset();
  await post(phase1Payload());

  const { ctx, page, errors } = await openPage(browser, BASE + '/phase2.html?id=p1-test-0001');
  await page.waitForSelector('.screen.on');
  await page.click('[data-story="Typed"]');
  await page.fill('#f_story_text', 'We have been doing this since 1998.');
  await page.click('#nextBtn');
  await page.fill('#f_years_in_business', '27');
  await page.click('[data-insured="Yes"]');
  await page.click('#nextBtn');
  check('three screens in', await screen(page) === 3);

  /* close the tab and come back */
  await page.goto(BASE + '/phase2.html?id=p1-test-0001');
  await page.waitForSelector('.resume.on', { timeout: 6000 });
  check('the resume bar offers to pick up where they left off', await page.isVisible('.resume.on'));
  await page.click('#resumeGo');
  check('and it lands on the screen they left', await screen(page) === 3, 'screen ' + await screen(page));

  await page.click('#backBtn');
  check('going back reaches screen 2', await screen(page) === 2);
  check('the typed number came back', await page.inputValue('#f_years_in_business') === '27');
  check('the chip came back pressed', await page.getAttribute('[data-insured="Yes"]', 'aria-pressed') === 'true');
  await page.click('#backBtn');
  check('and the story text came back', (await page.inputValue('#f_story_text')).indexOf('1998') > -1);

  /* jump to the end without revisiting the screens in between. This is the
     case normalizeForOutput exists for: nothing between here and submit runs
     per-screen validation, so the format has to be enforced at the boundary. */
  await page.evaluate(() => {
    const el = document.getElementById('f_contact_phone');
    el.value = '(617) 555-0142';
    el.dispatchEvent(new Event('input', { bubbles: true }));
  });
  check('it reaches the board from a resumed draft', await advanceToBoard(page));
  await page.waitForSelector('#boardDone:not([hidden])', { timeout: 8000 });

  const d = await dump();
  const r = d.recs[0];
  check('a resumed draft still submits E.164', String(r.contact_phone) === '+16175550142', String(r.contact_phone));
  check('a resumed draft still submits bare digits', r.years_in_business === 27, JSON.stringify(r.years_in_business));
  check('the baseline is still dated even when the screen was skipped', /^\d{4}-\d{2}-\d{2}$/.test(String(r.baseline_locked_at)), String(r.baseline_locked_at));
  check('skipped questions land blank rather than invented', !r.avg_job_value && !r.photos_status);
  check('the capacity the slider showed them is what got recorded', r.weekly_capacity === 5, JSON.stringify(r.weekly_capacity));
  check('nothing phase 1 wrote was disturbed by a mostly empty phase 2',
    r.ein === '041234567' && r.business_phone === '+16175550100' && r.signature_name === 'Dale Rivera');

  check('no page errors on the resume path', errors.length === 0, errors.join(' | '));
  await ctx.close();
}

/* ===================================================================== *
 * 7. answers that are not one of the chips
 * ===================================================================== */
async function testTypedAnswers(browser) {
  console.log('\n7. answers that are not one of the chips');
  await reset();
  await post(phase1Payload());

  const { ctx, page, errors } = await openPage(browser, BASE + '/phase2.html?id=p1-test-0001');
  await page.waitForSelector('.screen.on');
  await page.click('[data-story="Write it for me"]');
  await page.click('#nextBtn');

  await page.click('#noLicense');
  check('"my trade does not license" reads as an answer', await page.getAttribute('#noLicense', 'aria-pressed') === 'true');
  await page.click('#nextBtn');

  page.once('dialog', (d) => d.accept('3 years, parts and labor'));
  await page.click('#addWarranty');
  await page.waitForTimeout(120);
  check('a typed warranty appears as its own chip',
    await page.getAttribute('[data-warranty="3 years, parts and labor"]', 'aria-pressed') === 'true');

  /* come back to it */
  await page.goto(BASE + '/phase2.html?id=p1-test-0001');
  await page.waitForSelector('.screen.on');
  check('the typed warranty is still on screen after a reload',
    await page.getAttribute('[data-warranty="3 years, parts and labor"]', 'aria-pressed') === 'true');
  check('and so is the no-license answer', await page.getAttribute('#noLicense', 'aria-pressed') === 'true');
  check('the license box is not left holding the sentinel', await page.inputValue('#f_license_number') === '');

  check('it reaches the board', await advanceToBoard(page));
  await page.waitForSelector('#boardDone:not([hidden])', { timeout: 8000 });

  const r = (await dump()).recs[0];
  check('the typed warranty reached the sheet', r.warranty_terms === '3 years, parts and labor', String(r.warranty_terms));
  check('no license is stored as an answer, not a blank', r.license_number === 'None required', String(r.license_number));

  check('no page errors on the typed-answer path', errors.length === 0, errors.join(' | '));
  await ctx.close();
}

/* ===================================================================== *
 * 6. the reply cannot be read
 * ===================================================================== */
async function testNoCors(browser) {
  console.log('\n6. when the first attempt fails and the blind retry goes out');
  await reset();
  await post(phase1Payload());

  const { ctx, page, errors } = await openPage(browser, BASE + '/phase2.html?id=p1-test-0001');
  await page.waitForSelector('.screen.on');
  failFirstCall = true;

  await page.click('[data-story="Write it for me"]');
  check('it reaches the board with everything skipped', await advanceToBoard(page));
  await page.waitForSelector('#boardDone:not([hidden])', { timeout: 10000 });

  check('the board still renders when the first attempt fails', await page.isVisible('#boardDone'));
  check('and it says so plainly rather than claiming success', await page.isVisible('#unconfirmed'));

  const kept = await page.evaluate(() => !!localStorage.getItem('truaido_phase2_v1'));
  check('the local copy is never cleared without a receipt', kept === true);

  check('no page errors on the blind-retry path', errors.length === 0, errors.join(' | '));
  failFirstCall = false;
  await ctx.close();
}

/* ===================================================================== *
 * go
 * ===================================================================== */
(async () => {
  const mock = spawn(process.execPath, [__dirname + '/mock-endpoint.js', String(PORT)], { stdio: ['ignore', 'pipe', 'inherit'] });
  mock.stdout.on('data', () => {});

  for (let i = 0; i < 60; i++) {
    try { await fetch(BASE + '/exec'); break; } catch (e) { await sleep(100); }
  }

  const browser = await chromium.launch();
  let fatal = null;
  try {
    await testEndpoint();
    await testFullRun(browser);
    await testMagicLink(browser);
    await testLookup(browser);
    await testResume(browser);
    await testTypedAnswers(browser);
    await testNoCors(browser);
  } catch (err) {
    fatal = err;
  } finally {
    await browser.close();
    mock.kill();
  }

  console.log('\n' + '-'.repeat(60));
  if (fatal) { console.log('THREW: ' + (fatal && fatal.stack || fatal)); }
  console.log(passed + ' passed, ' + failures.length + ' failed');
  failures.forEach((f) => console.log('  FAIL ' + f));
  process.exit(failures.length || fatal ? 1 : 0);
})();
