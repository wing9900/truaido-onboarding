# Trade content, drafted for review

Everything in this file is already live in `phase2.html`, with one deliberate
exception: **no price is shown to a customer.** The offer cards carry a visible
blank where the number goes, and the customer types their own.

That is the open item. The prices below are drafts of what those blanks could
default to. They are pricing judgment, not copy, so they need your eye before a
paying customer sees one presented as though we had agreed it.

Nothing here blocks a launch, and nothing here blocks Phase 2 shipping. The form
works as it stands.

---

## How to turn the prices on

One object near the top of the script in `phase2.html`:

```js
var OFFER_PRICES = {};
```

Fill it in and the blanks fill themselves. Nothing else changes.

```js
var OFFER_PRICES = {
  'HVAC':                { discount: '89',  referral: '50' },
  'Plumbing':            { discount: '50',  referral: '50' },
  ...
};
```

`discount` is the number in the reactivation offer. `referral` is the number in
the referral offer. Leave a trade out and it keeps its blank, which is a
perfectly good state to ship in and the state it ships in today.

---

## Reactivation offers

Three per trade, in the order the spec calls for: a discount, a free check, and
a reminder with no discount at all. The third is on the list because the landing
page promises a no-discount reminder is a legitimate choice for some trades, and
the picker has to make that visibly true rather than bury it.

`{P}` is the blank. Drafted figures are in the right-hand column.

| Trade | Offer | Wording | Draft price |
|---|---|---|---|
| **HVAC** | Discount | Pre-season tune-up, {P} this month. We check the whole system before the weather turns. | **$89** |
| | Free check | Free system health check for past customers. No charge, no pressure, just a look at where things stand. | none |
| | Reminder | It's been a while since we serviced your system. Want us to swing by before the season turns? | none |
| **Plumbing** | Discount | {P} off any drain or water heater job booked this month. | **$50** |
| | Free check | Free plumbing inspection for past customers. We check the water heater, the shutoffs, and anything you have been putting off. | none |
| | Reminder | Anything dripping, running slow, or on the list? We have openings this week. | none |
| **Electrical** | Discount | {P} off any electrical job booked this month, panel work included. | **$75** |
| | Free check | Free home electrical safety check for past customers. Panel, outlets and smoke alarms. | none |
| | Reminder | Anything flickering, tripping, or on the someday list? We have openings. | none |
| **Roofing** | Discount | {P} off any roof repair booked this month. | **$250** |
| | Free check | Free roof inspection for past customers, with photos of anything we find. | none |
| | Reminder | There's been weather through since we were last out. Want us to take a look at the roof? | none |
| **Tree service** | Discount | {P} off any trimming or removal booked this month. | **$100** |
| | Free check | Free tree health check for past customers. We walk the property and flag anything at risk. | none |
| | Reminder | Before the next storm, want us to look at the trees near the house and the lines? | none |
| **Restoration** | Discount | {P} off any cleanup or remediation job booked this month. | **$150** |
| | Free check | Free moisture and mold check for past customers, no charge. | none |
| | Reminder | Checking in after the last job. Any smell, stain or damp spot you want us to look at? | none |
| **Paving** | Discount | {P} off sealcoating or repair booked this month. | **$100** |
| | Free check | Free driveway or lot assessment for past customers, with a written quote. | none |
| | Reminder | It's about the time of year for sealcoating. Want us to price yours? | none |
| **Moving** | Discount | {P} off your next move when you book with us again. | **$100** |
| | Free check | Free moving estimate for past customers, in person or over video. | none |
| | Reminder | Moving again, or know someone who is? We are booking now. | none |
| **Remodeling** | Discount | {P} off your next project booked this month. | **$500** |
| | Free check | Free design consultation for past customers. Bring us the room you keep thinking about. | none |
| | Reminder | Still thinking about that next project? We are scheduling now and happy to talk it through. | none |
| **Auto repair** | Discount | {P} off your next service, any job. | **$25** |
| | Free check | Free multi-point inspection for past customers. We check the brakes, tires and fluids. | none |
| | Reminder | It's been a while since your last service. Want to get on the schedule? | none |
| **Other service trade** | Discount | {P} off your next job booked this month. | **$50** |
| | Free check | Free check up for past customers. No charge and no pressure. | none |
| | Reminder | Checking in. Anything you have been meaning to get done? We have openings this week. | none |

**Two of the three offers per trade need no price at all.** A free check and a
plain reminder are complete as written, which is most of why the blanks are not
a problem. Only the discount card carries one, and asking the customer for their
own number there is arguably the better product anyway. It is their pricing.

**A blank that nobody fills in is asked about once.** Tapping the discount card
and walking off would otherwise send "$____ off any roof repair" to their past
customers. The form points it out on the way past and offers the two cards that
need no number, and a second press goes through, because no question in Phase 2
may block a launch. A blank that survives both lands in the sheet, where message
approval catches it before anything sends.

**The drafts, and why.** Roughly a fifth of a typical ticket for that trade, and
a round number a contractor would actually say out loud. The HVAC $89 comes
straight from the spec's own worked example. Everything else is my reading of
the same logic, and every one of them is a guess about a market you know and I
do not.

---

## Referral offers

Not trade-specific. What varies between trades is the number, not the shape of
the deal, so there are three shapes and one price per trade.

| Type | Wording | Draft price |
|---|---|---|
| Both-sided | Send someone our way and you both get {P} off your next job. | trade `referral` |
| Gift card | Refer a friend and we send you a {P} gift card once their job is done. | trade `referral` |
| None | If you know someone who needs us, we would appreciate the introduction. No strings. | none |

Field map values: `Both-sided` / `Gift card` / `None`. Those are the three, and
they match.

---

## Certification chips

Live now, seeded by trade, with an add-your-own on every screen. These are
factual badge names rather than pricing, so they ship as they are. Worth a
sanity check for anything misnamed or missing from a trade you know well.

| Trade | Chips |
|---|---|
| HVAC | NATE certified, EPA 608 certified, Carrier factory authorized, Trane Comfort Specialist, Lennox Premier Dealer, BBB accredited |
| Plumbing | State licensed plumber, Backflow certified, Gas line certified, Water heater factory certified, BBB accredited |
| Electrical | Master electrician, Licensed journeyman, Generac authorized, EV charger certified, Solar certified, BBB accredited |
| Roofing | GAF certified, Owens Corning preferred, CertainTeed credentialed, Malarkey certified, HAAG certified inspector, BBB accredited |
| Tree service | ISA certified arborist, TCIA accredited, Licensed arborist, BBB accredited |
| Restoration | IICRC certified, IICRC water damage restoration, IICRC applied structural drying, Mold remediation certified, BBB accredited |
| Paving | NAPA member, State licensed contractor, BBB accredited |
| Moving | DOT registered, Motor carrier licensed, ProMover certified, BBB accredited |
| Remodeling | Licensed general contractor, NARI member, NAHB member, Lead-safe EPA certified, BBB accredited |
| Auto repair | ASE certified, AAA approved shop, NAPA AutoCare center, I-CAR certified, BBB accredited |
| Other service trade | State licensed, BBB accredited, Background checked crew |

The spec's named examples all survived: GAF and Owens Corning for roofers,
Carrier, Trane and NATE for HVAC, IICRC for restoration, BBB for everyone.

Paving is the thin one, at three chips. Paving contractors carry fewer
manufacturer badges than roofers do, so that may be right rather than short. If
there are state or regional ones you know of, they belong here.

---

## Other content in the form worth an eye

Drafted the same way, all editable in `phase2.html`, none of it pricing.

- **Financing providers** (2.3): GreenSky, Synchrony, Wisetack, Service Finance,
  in-house payment plans, plus add-your-own.
- **Warranty terms** (2.3): 1 / 2 / 5 years on labor, lifetime on workmanship,
  manufacturer warranty only, plus add-your-own.
- **Things they don't do** (2.3): no commercial work, no mobile homes, no new
  construction, no insurance work, no small jobs, plus the typed line the spec
  keeps as one of the form's four typed fields.
- **Tools they run jobs on** (2.8): Jobber, Housecall Pro, ServiceTitan,
  QuickBooks, spreadsheets, paper, nothing yet. Straight from the spec.
