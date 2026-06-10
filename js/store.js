/* ============================================================
   FIXLI — store.js
   Datalaag, prijsengine, statussen, notificaties.

   Dit bestand bevat alle "business logica" en data-toegang.
   Nu draait alles op localStorage zodat de webapp zonder
   server te testen is. Alles is bewust zo gestructureerd dat
   het later 1-op-1 vervangen kan worden door een echte backend.

   >> BACKEND-KOPPELING <<
   Vervang de functies in het blok STORE (lsGet/lsSet -> API-calls)
   en de functie sendEmail() (-> Resend/SendGrid/Mailgun) door
   echte implementaties. De rest van de app blijft hetzelfde werken.
   ============================================================ */

/* =====================================================
   UTILITIES
===================================================== */
const qs  = (sel, ctx = document) => ctx.querySelector(sel);
const qsa = (sel, ctx = document) => [...ctx.querySelectorAll(sel)];

function uid(prefix = '') {
  return prefix + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
}

/* KRITIEK: escape alle gebruikersinvoer vóór innerHTML (XSS-preventie) */
function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, c =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

/* Basisvalidatie */
const isEmail    = v => /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(v || '');
const isPostcode = v => /^[1-9][0-9]{3}\s?[A-Za-z]{2}$/.test((v || '').trim());
const isKvk      = v => /^[0-9]{8}$/.test((v || '').replace(/\s/g, ''));
const isTelefoon = v => /^[0-9+\-\s()]{8,}$/.test(v || '');

function euro(n) {
  if (n === null || n === undefined || isNaN(n)) return '—';
  return '€ ' + Number(n).toLocaleString('nl-NL', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function fmtDate(iso) {
  if (!iso) return '—';
  try {
    return new Date(iso).toLocaleDateString('nl-NL', { day: 'numeric', month: 'short', year: 'numeric' });
  } catch { return iso; }
}

function isWeekend(dateStr) {
  if (!dateStr) return false;
  const d = new Date(dateStr).getDay();
  return d === 0 || d === 6;
}

/* =====================================================
   STORE — localStorage wrapper
   >> BACKEND: vervang body door fetch() naar je API.
===================================================== */
const Store = {
  get(key, fallback = null) {
    try {
      const v = localStorage.getItem(key);
      return v ? JSON.parse(v) : fallback;
    } catch { return fallback; }
  },
  set(key, value) {
    localStorage.setItem(key, JSON.stringify(value));
  }
};

/* Tabellen */
const TBL = {
  klussen:    'fixli_klussen',
  vakmannen:  'fixli_vakmannen',
  users:      'fixli_users',
  reviews:    'fixli_reviews',
  klachten:   'fixli_klachten',
  facturen:   'fixli_facturen',
  notif:      'fixli_notifications',
  auditlog:   'fixli_auditlog',
  settings:   'fixli_settings',
  curUser:    'fixli_current_user',
  curVakman:  'fixli_current_vakman',
  init:       'fixli_init_v2'
};

/* =====================================================
   INSTELLINGEN (instelbaar in admin)
===================================================== */
const DEFAULT_SETTINGS = {
  btwTarief: 0.21,
  servicekosten: 14.95,      // incl. btw, Fixli servicekosten per klus
  spoedtoeslag: 35,          // incl. btw
  weekendtoeslag: 25,        // incl. btw
  vakmanShare: 0.72,         // aandeel vakman van de klusprijs (excl. btw)
  antiOmzeilingMaanden: 24,
  boeteVakman: 2420,         // incl. btw
  boeteKlant: 149,           // incl. btw
  adminEmail: 'info@elektroklik.nl',
  factuurTeller: 0
};

function getSettings() {
  return { ...DEFAULT_SETTINGS, ...(Store.get(TBL.settings, {})) };
}
function saveSettings(s) { Store.set(TBL.settings, s); }

/* =====================================================
   VAKGEBIEDEN + KLUSSEN + DYNAMISCHE VRAGEN + PRIJZEN
   (Klusjesman is verwijderd, Laadpaal installateur toegevoegd)
===================================================== */
const VAKGEBIED_ICONS = {
  'Elektricien': '⚡', 'Loodgieter': '🔧', 'CV / Verwarming': '🔥', 'Airco': '❄️',
  'Schilder': '🖌️', 'Stukadoor': '🧱', 'Timmerman': '🪚', 'Hovenier': '🌿',
  'Dakdekker': '🏠', 'Witgoed monteur': '🧺', 'Laadpaal installateur': '🔌'
};

/* Prijsdata per klus.
   mode: 'vanaf' = vaste vanaf-prijs incl. btw die de klant ziet.
         'aanvraag' = prijs op aanvraag (admin stelt later prijs in).
   duur = geschatte duur (indicatie). */
const KLUSSEN = {
  'Elektricien': [
    { naam: 'Stopcontact plaatsen',            mode: 'vanaf',    prijs: 95,  duur: '1 uur' },
    { naam: 'Groep bijplaatsen',               mode: 'vanaf',    prijs: 175, duur: '1,5 uur' },
    { naam: 'Groepenkast inspectie',           mode: 'vanaf',    prijs: 89,  duur: '1 uur' },
    { naam: 'Laadpaal installatie intake',     mode: 'vanaf',    prijs: 49,  duur: '30 min' },
    { naam: 'Perilex aansluiting',             mode: 'vanaf',    prijs: 189, duur: '2 uur' }
  ],
  'Loodgieter': [
    { naam: 'Lekkage inspectie',               mode: 'vanaf',    prijs: 99,  duur: '1 uur' },
    { naam: 'Kraan vervangen',                 mode: 'vanaf',    prijs: 115, duur: '1 uur' },
    { naam: 'Afvoer ontstoppen',               mode: 'vanaf',    prijs: 129, duur: '1 uur' },
    { naam: 'Toilet reparatie',                mode: 'vanaf',    prijs: 125, duur: '1 uur' }
  ],
  'CV / Verwarming': [
    { naam: 'CV storing diagnose',             mode: 'vanaf',    prijs: 119, duur: '1 uur' },
    { naam: 'Radiator plaatsen',               mode: 'vanaf',    prijs: 149, duur: '1,5 uur' },
    { naam: 'Thermostaat vervangen',           mode: 'vanaf',    prijs: 99,  duur: '45 min' }
  ],
  'Airco': [
    { naam: 'Airco onderhoud',                 mode: 'vanaf',    prijs: 129, duur: '1 uur' },
    { naam: 'Airco installatie intake',        mode: 'vanaf',    prijs: 49,  duur: '30 min' }
  ],
  'Schilder': [
    { naam: 'Kleine schilderklus intake',      mode: 'vanaf',    prijs: 49,  duur: '30 min' },
    { naam: 'Binnenschilderwerk',              mode: 'aanvraag', prijs: null, duur: 'op aanvraag' }
  ],
  'Stukadoor': [
    { naam: 'Stucwerk intake',                 mode: 'vanaf',    prijs: 49,  duur: '30 min' },
    { naam: 'Stucwerk per m² (indicatie)',     mode: 'aanvraag', prijs: null, duur: 'per m²' }
  ],
  'Timmerman': [
    { naam: 'Deur afhangen',                   mode: 'vanaf',    prijs: 125, duur: '1 uur' },
    { naam: 'Kleine timmerklus',               mode: 'vanaf',    prijs: 95,  duur: '1 uur' }
  ],
  'Hovenier': [
    { naam: 'Tuinonderhoud',                   mode: 'vanaf',    prijs: 95,  duur: '2 uur' },
    { naam: 'Snoeiwerk',                       mode: 'vanaf',    prijs: 99,  duur: '2 uur' }
  ],
  'Dakdekker': [
    { naam: 'Dakinspectie',                    mode: 'vanaf',    prijs: 99,  duur: '1 uur' },
    { naam: 'Dakgoot reparatie',               mode: 'vanaf',    prijs: 125, duur: '1,5 uur' }
  ],
  'Witgoed monteur': [
    { naam: 'Wasmachine aansluiten',           mode: 'vanaf',    prijs: 79,  duur: '45 min' },
    { naam: 'Vaatwasser aansluiten',           mode: 'vanaf',    prijs: 89,  duur: '45 min' }
  ],
  'Laadpaal installateur': [
    { naam: 'Laadpaal intake/offerte',         mode: 'vanaf',    prijs: 49,  duur: '30 min' },
    { naam: 'Laadpaal installatie',            mode: 'aanvraag', prijs: null, duur: 'op aanvraag' }
  ]
};

function getKlusData(vakgebied, klusNaam) {
  return (KLUSSEN[vakgebied] || []).find(k => k.naam === klusNaam) || null;
}

/* Dynamische vragen per klus (stap 3 van de flow).
   Fallback = generieke vragen als een klus geen eigen set heeft. */
const VRAGEN_GENERIEK = [
  { id: 'urgentie', label: 'Hoe snel moet het gebeuren?', type: 'select', opties: ['Geen haast', 'Binnen een week', 'Zo snel mogelijk'] },
  { id: 'toegang',  label: 'Is de locatie goed bereikbaar?', type: 'select', opties: ['Ja', 'Nee, beperkt', 'Weet ik niet'] }
];
const VRAGEN = {
  'Stopcontact plaatsen': [
    { id: 'aantal',   label: 'Hoeveel stopcontacten?', type: 'select', opties: ['1', '2', '3', '4 of meer'] },
    { id: 'wand',     label: 'Type wand', type: 'select', opties: ['Steen/beton', 'Gipsplaat', 'Hout', 'Weet ik niet'] },
    { id: 'aarding',  label: 'Is er een geaarde groep aanwezig?', type: 'select', opties: ['Ja', 'Nee', 'Weet ik niet'] }
  ],
  'Lekkage inspectie': [
    { id: 'locatie',  label: 'Waar lekt het?', type: 'select', opties: ['Keuken', 'Badkamer', 'Toilet', 'Anders'] },
    { id: 'duur',     label: 'Hoe lang speelt het al?', type: 'select', opties: ['Vandaag begonnen', 'Enkele dagen', 'Langer dan een week'] }
  ],
  'CV storing diagnose': [
    { id: 'merk',     label: 'Merk ketel', type: 'text', placeholder: 'Bijv. Intergas, Remeha' },
    { id: 'foutcode', label: 'Foutcode op display (indien zichtbaar)', type: 'text', placeholder: 'Bijv. F28' }
  ],
  'Radiator plaatsen': [
    { id: 'aantal',   label: 'Aantal radiatoren', type: 'select', opties: ['1', '2', '3 of meer'] },
    { id: 'aansluiting', label: 'Zijn er al aansluitpunten?', type: 'select', opties: ['Ja', 'Nee', 'Weet ik niet'] }
  ],
  'Wasmachine aansluiten': [
    { id: 'aanwezig', label: 'Zijn aan- en afvoer aanwezig?', type: 'select', opties: ['Ja', 'Nee', 'Weet ik niet'] }
  ]
};
function getVragen(klusNaam) { return VRAGEN[klusNaam] || VRAGEN_GENERIEK; }

/* =====================================================
   PRIJSENGINE
   Berekent een complete prijsopbouw met rolgebaseerde velden.
   - Klant ziet:  klusprijs, toeslagen, servicekosten, btw, totaal
   - Vakman ziet: alleen vergoedingVakmanExcl
   - Admin ziet:  alles incl. marge
===================================================== */
function berekenPrijs(vakgebied, klusNaam, opties = {}) {
  const s = getSettings();
  const data = getKlusData(vakgebied, klusNaam);
  const spoed = !!opties.spoed;
  const weekend = isWeekend(opties.datum);

  // Prijs op aanvraag: nog geen bedrag; admin stelt later in.
  if (!data || data.mode === 'aanvraag') {
    return {
      mode: 'aanvraag', klusprijs: 0, spoedtoeslag: 0, weekendtoeslag: 0,
      servicekosten: 0, btw: 0, totaal: 0, subtotaalExcl: 0,
      vergoedingVakmanExcl: 0, margeFixliExcl: 0, duur: data ? data.duur : 'op aanvraag'
    };
  }

  const klusprijs   = data.prijs;
  const spoedtoeslag   = spoed ? s.spoedtoeslag : 0;
  const weekendtoeslag = weekend ? s.weekendtoeslag : 0;
  const servicekosten  = s.servicekosten;

  const totaal       = round2(klusprijs + spoedtoeslag + weekendtoeslag + servicekosten);
  const subtotaalExcl = round2(totaal / (1 + s.btwTarief));
  const btw          = round2(totaal - subtotaalExcl);

  // Vergoeding vakman = aandeel van het werk (klusprijs + toeslagen) excl. btw.
  const werkExcl = round2((klusprijs + spoedtoeslag + weekendtoeslag) / (1 + s.btwTarief));
  const vergoedingVakmanExcl = round2(werkExcl * s.vakmanShare);
  const margeFixliExcl = round2(subtotaalExcl - vergoedingVakmanExcl);

  return {
    mode: 'vanaf', klusprijs, spoedtoeslag, weekendtoeslag, servicekosten,
    totaal, subtotaalExcl, btw, vergoedingVakmanExcl, margeFixliExcl, duur: data.duur
  };
}
function round2(n) { return Math.round(n * 100) / 100; }

/* =====================================================
   STATUSSEN (volledige levenscyclus uit de spec)
===================================================== */
const KLUS_STATUS = {
  concept:           { label: 'Concept',                    badge: 'badge--gray' },
  wacht_controle:    { label: 'Wacht op controle Fixli',    badge: 'badge--orange' },
  beschikbaar:       { label: 'Beschikbaar voor vakmannen', badge: 'badge--blue' },
  geaccepteerd:      { label: 'Geaccepteerd door vakman',   badge: 'badge--green' },
  ingepland:         { label: 'Ingepland',                  badge: 'badge--green' },
  onderweg:          { label: 'Onderweg',                   badge: 'badge--green' },
  uitgevoerd:        { label: 'Uitgevoerd',                 badge: 'badge--green' },
  factuur_verzonden: { label: 'Factuur verzonden',          badge: 'badge--blue' },
  betaald:           { label: 'Betaald',                    badge: 'badge--blue' },
  afgerond:          { label: 'Afgerond',                   badge: 'badge--blue' },
  afgewezen:         { label: 'Afgewezen',                  badge: 'badge--red' },
  geannuleerd:       { label: 'Geannuleerd',                badge: 'badge--gray' }
};
function statusLabel(s) { return (KLUS_STATUS[s] || { label: s }).label; }
function statusBadge(s) { return (KLUS_STATUS[s] || { badge: 'badge--gray' }).badge; }

const VAKMAN_STATUS = {
  nieuw:                { label: 'Nieuw',                badge: 'badge--gray' },
  wacht_op_goedkeuring: { label: 'Wacht op controle',   badge: 'badge--orange' },
  documenten_ontbreken: { label: 'Documenten ontbreken', badge: 'badge--orange' },
  goedgekeurd:          { label: 'Goedgekeurd',         badge: 'badge--green' },
  afgewezen:            { label: 'Afgewezen',           badge: 'badge--red' },
  gepauzeerd:           { label: 'Tijdelijk gepauzeerd', badge: 'badge--gray' },
  geblokkeerd:          { label: 'Geblokkeerd',         badge: 'badge--red' }
};

/* =====================================================
   NOTIFICATIES / E-MAIL (simulatie)
   >> BACKEND: vervang sendEmail() door echte mailservice
   (Resend / SendGrid / Mailgun) via je API.
===================================================== */
function sendEmail(to, email, subject, body, klusId = null) {
  const log = Store.get(TBL.notif, []);
  log.unshift({
    id: uid('mail_'), to, email, subject, body, klusId,
    time: new Date().toISOString()
  });
  Store.set(TBL.notif, log);
  // >> BACKEND: await fetch('/api/email', { method:'POST', body: JSON.stringify({to,email,subject,body}) })
}

/* Audit-log voor adminacties */
function audit(actie, detail = '') {
  const log = Store.get(TBL.auditlog, []);
  log.unshift({ id: uid('log_'), actie, detail, time: new Date().toISOString() });
  Store.set(TBL.auditlog, log);
}

/* =====================================================
   MATCHING
   Een klus is zichtbaar voor een vakman als:
   - klus status 'beschikbaar'
   - vakman goedgekeurd
   - vakgebied komt overeen
   - postcode valt binnen werkgebied (2-cijferige prefix)
===================================================== */
function postcodePrefix(pc) {
  return (pc || '').replace(/\s/g, '').slice(0, 2);
}
function vakmanMatchtKlus(vakman, klus) {
  if (!vakman || vakman.status !== 'goedgekeurd') return false;
  if (klus.status !== 'beschikbaar') return false;
  if (!(vakman.vakgebieden || []).includes(klus.vakgebied)) return false;
  const gebieden = (vakman.werkgebied || []).map(g => String(g).trim());
  if (!gebieden.length) return true; // geen werkgebied ingesteld = overal
  return gebieden.includes(postcodePrefix(klus.postcode));
}
function beschikbareKlussenVoor(vakman) {
  return Store.get(TBL.klussen, []).filter(k => vakmanMatchtKlus(vakman, k));
}

/* =====================================================
   FACTUREN
===================================================== */
function maakFactuur(klus) {
  const facturen = Store.get(TBL.facturen, []);
  const bestaand = facturen.find(f => f.klusId === klus.id);
  if (bestaand) return bestaand; // al aangemaakt
  const s = getSettings();
  s.factuurTeller += 1;
  saveSettings(s);
  const nummer = 'FXL-2026-' + String(s.factuurTeller).padStart(6, '0');
  const factuur = {
    id: uid('fac_'), nummer, klusId: klus.id, datum: new Date().toISOString(),
    klant: { naam: klus.naam, email: klus.email, adres: klus.adres, postcode: klus.postcode, plaats: klus.plaats },
    klusomschrijving: `${klus.klus} — ${klus.vakgebied}`,
    bedragExcl: klus.prijs.subtotaalExcl, btw: klus.prijs.btw,
    servicekosten: klus.prijs.servicekosten, totaal: klus.prijs.totaal,
    betaalstatus: klus.betaalstatus || 'betaald',
    vakmanUitbetaling: klus.prijs.vergoedingVakmanExcl,
    margeFixli: klus.prijs.margeFixliExcl, accepted_by: klus.accepted_by
  };
  facturen.push(factuur);
  Store.set(TBL.facturen, facturen);
  return factuur;
}

/* =====================================================
   DEMO DATA — vooraf gevuld zodat alle schermen tonen
   !! LET OP: wachtwoorden staan hier plain-text, alleen
   acceptabel voor deze lokale demo. In de live-versie:
   >> BACKEND: authenticatie via Supabase Auth / NextAuth,
   nooit zelf wachtwoorden in een database opslaan.
===================================================== */
function initDemoData() {
  if (Store.get(TBL.init)) return;

  const now = new Date().toISOString();
  const mk = (vg, kn, opts) => {
    const prijs = berekenPrijs(vg, kn, opts);
    return { id: uid('klus_'), vakgebied: vg, klus: kn, prijs, created_at: now, accepted_by: null, ...opts };
  };

  const klussen = [
    {
      ...mk('Loodgieter', 'Afvoer ontstoppen', { spoed: false, datum: '2026-07-10' }),
      status: 'beschikbaar', antwoorden: {},
      beschrijving: 'Afvoer in de keuken loopt slecht door, zelf doorspoelen helpt niet.',
      postcode: '3811 AB', plaats: 'Amersfoort', adres: 'Keizersgracht 12',
      tijd: '09:00', naam: 'Jan de Vries', telefoon: '06-12345678', email: 'jan@email.nl',
      betaalstatus: 'betaald', goedgekeurd_op: now
    },
    {
      ...mk('Loodgieter', 'Kraan vervangen', { spoed: true, datum: '2026-07-08' }),
      status: 'geaccepteerd', accepted_by: 'vakman_1', antwoorden: {},
      beschrijving: 'Keukenkraan lekt en moet vervangen worden.',
      postcode: '3812 CD', plaats: 'Amersfoort', adres: 'Langegracht 5',
      tijd: '13:00', naam: 'Maria Jansen', telefoon: '06-87654321', email: 'maria@email.nl',
      betaalstatus: 'betaald'
    },
    {
      ...mk('Loodgieter', 'Afvoer ontstoppen', { spoed: false, datum: '2026-07-12' }),
      status: 'wacht_controle', antwoorden: {},
      beschrijving: 'Doucheafvoer loopt traag weg.',
      postcode: '3821 EF', plaats: 'Amersfoort', adres: 'Soesterweg 88',
      tijd: '', naam: 'Peter Smit', telefoon: '06-11223344', email: 'peter@email.nl',
      betaalstatus: 'betaald'
    }
  ];

  const vakmannen = [
    {
      id: 'vakman_1', bedrijfsnaam: 'Loodgietersbedrijf Hendrix', naam: 'Rob Hendrix',
      email: 'rob@hendrix-loodgieter.nl', telefoon: '06-55667788', password: 'demo123',
      kvk: '12345678', btw: 'NL123456789B01', iban: 'NL12RABO0123456789',
      vestigingsadres: 'Stationsplein 4', plaats: 'Amersfoort', werkgebied: ['38', '35'],
      vakgebieden: ['Loodgieter', 'CV / Verwarming'], ervaring: 15, tarief: '65',
      beschikbaarheid: 'Ma-vr', documenten: ['KvK-uittreksel.pdf', 'VCA.pdf', 'AVB-verzekering.pdf'],
      status: 'goedgekeurd', aangemeld: now
    },
    {
      id: 'vakman_2', bedrijfsnaam: 'Electra Pro BV', naam: 'Sven Willems',
      email: 'sven@electrapro.nl', telefoon: '06-44556677', password: 'demo123',
      kvk: '87654321', btw: 'NL987654321B01', iban: 'NL34INGB0987654321',
      vestigingsadres: 'Industrieweg 22', plaats: 'Amersfoort', werkgebied: ['38'],
      vakgebieden: ['Elektricien', 'Laadpaal installateur'], ervaring: 8, tarief: '70',
      beschikbaarheid: 'Ma-za', documenten: ['KvK-uittreksel.pdf'],
      status: 'wacht_op_goedkeuring', aangemeld: now
    }
  ];

  const users = [
    { id: 'user_1', naam: 'Jan de Vries', email: 'jan@email.nl', telefoon: '06-12345678', password: 'demo123', type: 'klant' }
  ];

  Store.set(TBL.klussen, klussen);
  Store.set(TBL.vakmannen, vakmannen);
  Store.set(TBL.users, users);
  Store.set(TBL.reviews, []);
  Store.set(TBL.klachten, []);
  Store.set(TBL.facturen, []);
  Store.set(TBL.notif, []);
  Store.set(TBL.auditlog, []);
  saveSettings(DEFAULT_SETTINGS);
  Store.set(TBL.init, true);

  // Factuur voor de al-geaccepteerde demo-klus
  const accepted = Store.get(TBL.klussen, []).find(k => k.accepted_by === 'vakman_1');
  if (accepted) maakFactuur(accepted);
}
