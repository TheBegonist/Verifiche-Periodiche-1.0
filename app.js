'use strict';
/* Verifiche periodiche - app per il telefono
   Funziona senza rete. I dati restano sul telefono (IndexedDB) finche' non si crea
   il file da importare in Access. L'elenco di ditte e apparecchi arriva da Access
   (Menu > "Elenco per il telefono"). */

const VERSIONE_APP = '1.7';
const FORMATO_INVIO = 1;

// ---------------------------------------------------------------- utilita'
const $ = s => document.querySelector(s);
function uid() {
  if (crypto.randomUUID) return crypto.randomUUID();
  const b = crypto.getRandomValues(new Uint8Array(16));
  b[6] = (b[6] & 15) | 64; b[8] = (b[8] & 63) | 128;
  const x = [...b].map(v => v.toString(16).padStart(2, '0')).join('');
  return `${x.slice(0, 8)}-${x.slice(8, 12)}-${x.slice(12, 16)}-${x.slice(16, 20)}-${x.slice(20)}`;
}
function oggi() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
function fmtData(s) {
  if (!s) return '';
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(s);
  return m ? `${m[3]}/${m[2]}/${m[1]}` : s;
}
function fmtMese(s) {
  const m = /^(\d{4})-(\d{2})/.exec(s || '');
  return m ? `${m[2]}/${m[1]}` : '';
}
function adesso() {
  const d = new Date();
  const p = n => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}
// numero scritto con la virgola o con il punto -> testo con il punto ('' se vuoto, null se non valido)
function numeroOut(v) {
  if (v === null || v === undefined) return '';
  const s = String(v).trim().replace(/\s/g, '').replace(',', '.');
  if (s === '') return '';
  return /^-?\d+(\.\d+)?$/.test(s) ? s : null;
}
function numero(v) { const s = numeroOut(v); return s ? parseFloat(s) : 0; }
function norm(s) { return String(s || '').trim().toUpperCase().replace(/\s+/g, ''); }
function contiene(testo, cerca) { return String(testo || '').toLowerCase().includes(cerca); }

// append e replaceChildren accettano anche elenchi e ignorano i vuoti (null, false)
for (const nome of ['append', 'replaceChildren']) {
  const orig = Element.prototype[nome];
  Element.prototype[nome] = function (...x) {
    return orig.apply(this, x.flat(3).filter(v => v !== null && v !== undefined && v !== false));
  };
}

// elementi della pagina
function h(tag, attrs, ...figli) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v === null || v === undefined || v === false) continue;
    if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2), v);
    else if (k === 'class') el.className = v;
    else if (k === 'value' || k === 'checked' || k === 'disabled' || k === 'hidden') el[k] = v;
    else el.setAttribute(k, v === true ? '' : v);
  }
  for (const f of figli.flat(3)) {
    if (f === null || f === undefined || f === false) continue;
    el.append(f instanceof Node ? f : document.createTextNode(String(f)));
  }
  return el;
}

// ---------------------------------------------------------------- archivio sul telefono
let db;
function apriDB() {
  return new Promise((ok, ko) => {
    const r = indexedDB.open('verifiche-telefono', 1);
    r.onupgradeneeded = () => {
      const d = r.result;
      if (!d.objectStoreNames.contains('elenco')) d.createObjectStore('elenco');
      if (!d.objectStoreNames.contains('record')) d.createObjectStore('record', { keyPath: 'uuid' });
      if (!d.objectStoreNames.contains('foto')) d.createObjectStore('foto', { keyPath: 'id' }).createIndex('ref', 'ref');
      if (!d.objectStoreNames.contains('impostazioni')) d.createObjectStore('impostazioni');
    };
    r.onsuccess = () => { db = r.result; ok(); };
    r.onerror = () => ko(r.error);
  });
}
function tx(store, modo, fn) {
  return new Promise((ok, ko) => {
    const t = db.transaction(store, modo);
    let ris;
    const r = fn(t.objectStore(store));
    if (r) r.onsuccess = () => { ris = r.result; };
    t.oncomplete = () => ok(ris);
    t.onerror = () => ko(t.error);
    t.onabort = () => ko(t.error || new Error('operazione annullata'));
  });
}
const leggi = (store, chiave) => tx(store, 'readonly', s => s.get(chiave));
const metti = (store, val, chiave) => tx(store, 'readwrite', s => (chiave === undefined ? s.put(val) : s.put(val, chiave)));
const togli = (store, chiave) => tx(store, 'readwrite', s => s.delete(chiave));
const tutti = store => tx(store, 'readonly', s => s.getAll());
const fotoDi = ref => tx('foto', 'readonly', s => s.index('ref').getAll(ref));

// ---------------------------------------------------------------- stato
let E = null;                 // elenco preparato in Access
const R = new Map();          // record del telefono: verifiche (VE), apparecchi nuovi (AP), ditte nuove (AZ)
let IMP = { telefono: '', operatore: '' };
let IDX = {};
let installa = null;          // richiesta di installazione di Chrome

function indicizza() {
  IDX = { az: new Map(), azMob: new Map(), ap: new Map(), apMob: new Map(), op: new Map(), val: new Map(),
          esiti: new Map(), tipi: new Map(), tipologie: new Map() };
  if (!E) return;
  for (const a of E.aziende || []) { IDX.az.set(a.id, a); if (a.mob) IDX.azMob.set(a.mob, a); }
  for (const a of E.apparecchi || []) { IDX.ap.set(a.id, a); if (a.mob) IDX.apMob.set(a.mob, a); }
  for (const o of E.operatori || []) IDX.op.set(String(o.id), o);
  for (const v of E.valutazioni || []) IDX.val.set(String(v.id), v);
  for (const v of E.esiti || []) IDX.esiti.set(String(v.id), v);
  for (const v of E.tipiVerifica || []) IDX.tipi.set(String(v.id), v);
  for (const v of E.tipologie || []) IDX.tipologie.set(String(v.id), v);
}

// Ditta da un riferimento "ID:n" (in Access) o "N:uuid" (nuova, inserita sul telefono)
function ditta(ref) {
  if (!ref) return null;
  if (ref.startsWith('ID:')) {
    const a = IDX.az.get(Number(ref.slice(3)));
    return a ? { ref, nuova: false, rs: a.rs, piva: a.piva, cf: a.cf, comune: a.comune } : null;
  }
  const u = ref.slice(2);
  const r = R.get(u);
  if (r) return { ref, nuova: true, rec: r, rs: r.d.rs, piva: r.d.piva, cf: r.d.cf, comune: r.d.com };
  const a = IDX.azMob.get(u);
  return a ? { ref: 'ID:' + a.id, nuova: false, rs: a.rs, piva: a.piva, cf: a.cf, comune: a.comune } : null;
}

// Apparecchio da un riferimento "ID:n" o "N:uuid"
function apparecchio(ref) {
  if (!ref) return null;
  if (ref.startsWith('ID:')) {
    const a = IDX.ap.get(Number(ref.slice(3)));
    return a ? { ...a, ref, nuova: false, az: 'ID:' + a.az } : null;
  }
  const u = ref.slice(2);
  const r = R.get(u);
  if (r) {
    const d = r.d;
    return { ref, nuova: true, rec: r, fam: d.fam, mat: d.mat, lav: d.lav, az: d.az, ubTipo: d.ubTipo, ubCom: d.ubCom,
             ubInd: d.ubInd, ubPresso: d.ubPresso, luogo: d.ubCom, disp: d.disp || [], valv: d.valvPrec || null,
             datiPrec: d.datiPrec || '', indagine: d.scadIndagine || '', ...datiSerbatoio(d.comp) };
  }
  const a = IDX.apMob.get(u);
  return a ? { ...a, ref: 'ID:' + a.id, nuova: false, az: 'ID:' + a.az } : null;
}

// pressione: P e T di esercizio (primo componente che le ha), capacita' totale, numeri di fabbrica
function datiSerbatoio(comp) {
  const c = comp || [];
  const primo = k => { const x = c.find(v => String(v[k] || '').trim()); return x ? String(x[k]).trim() : ''; };
  const litri = c.reduce((t, v) => t + numero(v.litri), 0);
  return { pe: primo('pe'), te: primo('te'), litri: litri || null, nfabComp: c.map(v => v.nfab).filter(Boolean).join(', ') };
}
const ESITI_SCHEDA = {
  MessaTerra: ['Presente', 'Non presente', 'Non valutabile'],
  Spessimetria: ['Positivo', 'Da valutare libretto', 'Non valutabile'],
  Verniciatura: ['Positivo', 'Da verniciare', 'Non valutabile'],
};
const vociScheda = k => ((E && E.elenchiFissi && (E.elenchiFissi[k] || []).length) ? E.elenchiFissi[k] : ESITI_SCHEDA[k]);
const NV = 'Non valutabile';
const testoNum = v => (v === null || v === undefined || v === '' ? '' : String(v).replace('.', ','));

function nomeOperatore(id) { const o = IDX.op.get(String(id)); return o ? o.nome : '?'; }

// ---------------------------------------------------------------- regole (come nelle maschere di Access)
const VALUTAZIONE_PREDEFINITA = {
  Sollevamento: { 1: 'Buone ad esame visivo', 2: 'Buone', 3: 'Regolari' },
  Riscaldamento: { 1: 'Regolari', 2: 'Regolari', 3: 'Efficienti', 4: 'Efficienti' },
  Pressione: { 1: 'Regolari', 2: 'Efficienti', 3: 'Efficienti' },
};
function vociDi(fam) { return (E.voci || []).filter(v => v.fam === fam).sort((a, b) => a.ordine - b.ordine); }
function valutazioniPredefinite(fam) {
  const m = {};
  for (const v of vociDi(fam)) {
    const t = (VALUTAZIONE_PREDEFINITA[fam] || {})[v.ordine];
    const val = (E.valutazioni || []).find(x => x.descr === t);
    m[v.id] = val ? String(val.id) : '';
  }
  return m;
}
// Tipi di verifica adatti: famiglia e luogo di lavoro, mai i tipi "Prima..." (le fa l'INAIL)
function tipiPer(a) {
  if (!a || a.lav === null || a.lav === undefined) return [];
  return (E.tipiVerifica || []).filter(t => t.fam === a.fam && Boolean(t.lav) === Boolean(a.lav) && !/^Prima/i.test(t.descr));
}
function tipoPredefinito(a) {
  const t = tipiPer(a);
  const p = t.find(x => /^Successiva/i.test(x.descr) || x.descr === 'Periodica') || t[0];
  return p ? String(p.id) : '';
}
function esitoPredefinito() {
  const e = (E.esiti || []).find(x => x.breve === 'Positivo') || (E.esiti || [])[0];
  return e ? String(e.id) : '';
}

// ---------------------------------------------------------------- controlli prima dell'invio
function erroriDitta(r) {
  const d = r.d, e = [];
  if (!String(d.rs || '').trim()) e.push('la ragione sociale');
  if (!String(d.piva || '').trim() && !String(d.cf || '').trim()) e.push('la partita IVA o il codice fiscale');
  const p = norm(d.piva), c = norm(d.cf);
  for (const a of E.aziende || []) {
    if ((p && norm(a.piva) === p) || (c && norm(a.cf) === c)) {
      e.push(`questa ditta c'è già nell'elenco (${a.rs}): sceglila dall'elenco invece di inserirla di nuovo`);
      break;
    }
  }
  return e;
}
function erroriApparecchio(r) {
  const d = r.d, e = [];
  if (!d.az) e.push('la ditta');
  else if (d.az.startsWith('N:')) {
    const z = R.get(d.az.slice(2));
    if (z && erroriDitta(z).length) e.push('i dati della ditta nuova');
  }
  if (!String(d.mat || '').trim()) e.push('la matricola');
  else {
    const m = norm(d.mat);
    const doppio = (E.apparecchi || []).find(a => norm(a.mat) === m);
    if (doppio) e.push(`la matricola ${d.mat} c'è già nell'elenco: usa quell'apparecchio`);
    for (const x of R.values()) {
      if (x.tipo === 'AP' && x.uuid !== r.uuid && norm(x.d.mat) === m && x.stato !== 'importata') {
        e.push(`c'è già un altro apparecchio nuovo con la matricola ${d.mat}`);
        break;
      }
    }
  }
  if (d.fam !== 'Sollevamento' && (d.lav === null || d.lav === undefined)) e.push('se si trova in un luogo di lavoro');
  if (d.fam === 'Sollevamento' && !d.tipologia) e.push('la tipologia');
  if (d.fam === 'Riscaldamento' && !(d.gen || []).length) e.push('almeno un generatore');
  if ((d.gen || []).some(g => !(numero(g.kw) > 0))) e.push('la potenza (kW) di ogni generatore');
  if (d.fam === 'Pressione' && !(d.comp || []).some(c => numero(c.litri) > 0 && (numero(c.ps) > 0 || numero(c.pe) > 0)))
    e.push('i dati del recipiente: almeno un componente con capacità e pressione');
  const num = [['anno', 'l\'anno'], ['portata', 'la portata']];
  for (const [k, t] of num) if (numeroOut(d[k]) === null) e.push(`${t} non è un numero`);
  for (const g of d.gen || []) for (const k of ['bar', 'kw']) if (numeroOut(g[k]) === null) e.push('un numero dei generatori non è valido');
  for (const v of d.vasi || []) if (numeroOut(v.litri) === null) e.push('una capacità dei vasi non è un numero');
  for (const v of d.disp || []) if (numeroOut(v.bar) === null) e.push('una taratura dei dispositivi non è un numero');
  for (const c of d.comp || []) for (const k of ['litri', 'ps', 'pe', 'tsmin', 'tsmax', 'te'])
    if (numeroOut(c[k]) === null) { e.push('un numero dei componenti non è valido'); break; }
  return [...new Set(e)];
}
function erroriVerifica(r) {
  const d = r.d, e = [];
  const a = apparecchio(d.app);
  if (!a) { e.push('l\'apparecchio (non lo trovo più nell\'elenco)'); return e; }
  if (a.nuova && a.rec && erroriApparecchio(a.rec).length) e.push('i dati dell\'apparecchio nuovo');
  if (!d.data) e.push('la data');
  if (!d.tipo) e.push('il tipo di verifica');
  if (!d.esito) e.push('l\'esito');
  if (a.fam === 'Pressione' && !d.funz && !d.integ) e.push('se è una verifica di funzionamento, di integrità o tutte e due');
  if (!(d.operatori || []).length) e.push('almeno un operatore');
  if (a.fam === 'Pressione' && numeroOut(d.valvBar) === null) e.push('la pressione di taratura non è un numero');
  if (d.data && a.ultima === d.data) e.push('in Access c\'è già una verifica di questo apparecchio in questa data');
  for (const x of R.values()) {
    if (x.tipo === 'VE' && x.uuid !== r.uuid && x.d.app === d.app && x.d.data === d.data && x.stato !== 'importata') {
      e.push('sul telefono c\'è già un\'altra verifica di questo apparecchio in questa data');
      break;
    }
  }
  return e;
}
const errori = r => (r.tipo === 'VE' ? erroriVerifica(r) : r.tipo === 'AP' ? erroriApparecchio(r) : r.tipo === 'TA' ? erroriTaratura(r) : erroriDitta(r));

// ---------------------------------------------------------------- record
async function salvaRecord(r) {
  r.modificato = Date.now();
  R.set(r.uuid, r);
  await metti('record', r);
}
async function nuovoRecord(tipo, d) {
  const r = { uuid: uid(), tipo, stato: 'bozza', creato: Date.now(), modificato: Date.now(), d };
  await salvaRecord(r);
  return r;
}
async function eliminaRecord(r) {
  for (const f of await fotoDi(r.uuid)) await togli('foto', f.id);
  await togli('record', r.uuid);
  R.delete(r.uuid);
}
function bloccato(r) { return r.stato === 'inviata' || r.stato === 'importata'; }
const NOMI_STATO = { bozza: 'bozza', pronta: 'pronta', inviata: 'inviata', importata: 'in Access' };
const chipStato = r => h('span', { class: 'chip ' + r.stato }, NOMI_STATO[r.stato]);

function descrivi(r) {
  if (r.tipo === 'VE') {
    const a = apparecchio(r.d.app);
    const z = a ? ditta(a.az) : null;
    return { titolo: `${a ? a.mat : '?'} – ${z ? z.rs : '?'}`,
             sotto: `Verifica ${a ? a.fam.toLowerCase() : ''} del ${fmtData(r.d.data)}` };
  }
  if (r.tipo === 'TA') return descriviTaratura(r);
  if (r.tipo === 'AP') {
    const z = ditta(r.d.az);
    return { titolo: `Apparecchio nuovo: ${r.d.mat || '(senza matricola)'}`, sotto: `${r.d.fam} – ${z ? z.rs : 'ditta da scegliere'}` };
  }
  return { titolo: `Ditta nuova: ${r.d.rs || '(senza nome)'}`, sotto: r.d.com || '' };
}

// ---------------------------------------------------------------- finestre di dialogo (nella pagina)
let chiudiFinestra = null;
function finestra(titolo, corpo, pulsanti) {
  return new Promise(ok => {
    const f = $('#finestra');
    f.replaceChildren(h('h3', {}, titolo), corpo);
    const riga = h('div', { class: 'riga-btn' });
    const chiudi = v => { $('#velo').classList.remove('aperto'); chiudiFinestra = null; ok(v); };
    for (const p of pulsanti) riga.append(h('button', { class: 'btn ' + (p.classe || ''), onclick: () => chiudi(p.valore) }, p.testo));
    f.append(riga);
    chiudiFinestra = () => chiudi(undefined);
    $('#velo').classList.add('aperto');
  });
}
const messaggio = (titolo, testo) => finestra(titolo, typeof testo === 'string' ? h('p', {}, testo) : testo, [{ testo: 'OK', valore: true }]);
const conferma = (titolo, testo, si = 'Sì', no = 'No', pericolo = false) =>
  finestra(titolo, typeof testo === 'string' ? h('p', {}, testo) : testo,
           [{ testo: no, valore: false, classe: 'secondario' }, { testo: si, valore: true, classe: pericolo ? 'pericolo' : '' }]);
function chiediTesto(titolo, valore) {
  const i = h('input', { type: 'text', value: valore || '' });
  setTimeout(() => i.focus(), 50);
  return finestra(titolo, i, [{ testo: 'Annulla', valore: null, classe: 'secondario' }, { testo: 'OK', valore: 'ok' }])
    .then(v => (v === 'ok' ? i.value : null));
}
const elencoPunti = righe => h('ul', {}, righe.map(t => h('li', {}, t)));

// ---------------------------------------------------------------- navigazione
const pila = [];
function vai(nome, arg, sostituisci) {
  const st = { nome, arg, scroll: 0 };
  if (pila.length) pila[pila.length - 1].scroll = window.scrollY;
  if (sostituisci && pila.length) { pila[pila.length - 1] = st; history.replaceState({ n: pila.length }, ''); }
  else { pila.push(st); history.pushState({ n: pila.length }, ''); }
  mostra();
  window.scrollTo(0, 0);
}
function indietro() { history.back(); }
window.addEventListener('popstate', ev => {
  if (chiudiFinestra) chiudiFinestra();
  const n = Math.max(1, (ev.state && ev.state.n) || 1);
  if (pila.length > n) { pila.length = n; mostra(true); }
});
function torna(alla) { // torna indietro fino alla vista indicata (o alla prima)
  let n = 0;
  for (let i = pila.length - 1; i > 0 && pila[i].nome !== alla; i--) n++;
  if (n > 0) history.go(-n);
}

const VISTE = {};
let pulizia = [];
async function mostra(ripristina) {
  for (const f of pulizia) f();
  pulizia = [];
  const st = pila[pila.length - 1];
  $('#indietro').hidden = pila.length <= 1;
  const main = $('#vista');
  main.replaceChildren();
  document.querySelectorAll('.barra').forEach(b => b.remove());
  await VISTE[st.nome](main, st.arg);
  if (ripristina) window.scrollTo(0, st.scroll || 0);
}
function titolo(t) { $('#titolo').textContent = t; }
function barra(...pulsanti) { document.body.append(h('div', { class: 'barra' }, pulsanti)); }

// salvataggio automatico mentre si scrive
function salvataggio(r, aggiorna) {
  let t = null;
  const segno = h('div', { class: 'salvato' });
  const salva = () => {
    if (aggiorna) aggiorna();
    segno.textContent = '…';
    clearTimeout(t);
    t = setTimeout(async () => { await salvaRecord(r); segno.textContent = 'Salvato sul telefono'; }, 350);
  };
  pulizia.push(() => { if (t) { clearTimeout(t); salvaRecord(r); } });
  return { salva, segno };
}

// ---------------------------------------------------------------- campi dei moduli
function campoTesto(obj, k, salva, opz = {}) {
  const i = h(opz.area ? 'textarea' : 'input', {
    type: opz.area ? null : (opz.tipo || 'text'), value: obj[k] ?? '', inputmode: opz.num ? 'decimal' : opz.inputmode,
    placeholder: opz.ph, autocomplete: 'off', autocapitalize: opz.maiuscole ? 'characters' : 'sentences',
    disabled: opz.disabled,
  });
  i.addEventListener('input', () => { obj[k] = i.value; salva(); });
  return i;
}
function campoScelta(obj, k, opzioni, salva, opz = {}) {
  const s = h('select', { disabled: opz.disabled });
  if (opz.vuota !== false) s.append(h('option', { value: '' }, opz.vuota || '— scegli —'));
  for (const o of opzioni) s.append(h('option', { value: String(o.v) }, o.t));
  s.value = obj[k] === null || obj[k] === undefined ? '' : String(obj[k]);
  s.addEventListener('change', () => { obj[k] = s.value === '' ? null : s.value; salva(); });
  return s;
}
function campoSiNo(obj, k, salva, etichette = ['Sì', 'No'], opz = {}) {
  const box = h('div', { class: 'scelte' });
  const disegna = () => {
    box.replaceChildren(
      h('button', { type: 'button', class: obj[k] === true ? 'on' : '', disabled: opz.disabled, onclick: () => { obj[k] = true; disegna(); salva(); } }, etichette[0]),
      h('button', { type: 'button', class: obj[k] === false ? 'on' : '', disabled: opz.disabled, onclick: () => { obj[k] = false; disegna(); salva(); } }, etichette[1]));
  };
  disegna();
  return box;
}
function spunta(obj, k, testo, salva, opz = {}) {
  const c = h('input', { type: 'checkbox', checked: Boolean(obj[k]), disabled: opz.disabled });
  c.addEventListener('change', () => { obj[k] = c.checked; salva(); });
  return h('label', { class: 'spunta' }, c, testo);
}
const etichetta = (t, campo) => h('label', { class: 'campo' }, t, campo);

// campo che puo' valere "Non valutabile" (casella sotto)
function campoNV(obj, k, testo, salva, opz = {}) {
  const i = campoTesto(obj, k, salva, opz);
  const c = h('input', { type: 'checkbox', checked: obj[k] === NV, disabled: opz.disabled });
  const aggiorna = () => { i.disabled = Boolean(opz.disabled) || obj[k] === NV; if (obj[k] === NV) i.value = NV; };
  c.addEventListener('change', () => {
    if (c.checked) { obj[k] = NV; } else { obj[k] = ''; i.value = ''; }
    aggiorna();
    salva();
  });
  aggiorna();
  return h('div', {}, etichetta(testo, i), h('label', { class: 'spunta', style: 'padding-top:4px' }, c, 'non valutabile'));
}

// Riquadro con quello che manca per poter inviare
function riquadroMancanze(r) {
  const box = h('div');
  const aggiorna = () => {
    if (bloccato(r)) {
      box.replaceChildren(h('div', { class: 'info' }, r.stato === 'importata'
        ? 'Questo record è già in Access. Eventuali correzioni vanno fatte in Access.'
        : 'Già inviato al PC: non si può più modificare qui. Le correzioni vanno fatte in Access dopo l\'importazione.'));
      return;
    }
    const e = errori(r);
    box.replaceChildren(e.length ? h('div', { class: 'avviso' }, h('b', {}, 'Per inviarla manca: '), e.join('; ') + '.')
                                 : h('div', { class: 'info' }, 'Completa: si può segnare come pronta.'));
  };
  aggiorna();
  return { box, aggiorna };
}

async function segnaPronta(r) {
  const e = errori(r);
  if (e.length) { await messaggio('Manca ancora qualcosa', elencoPunti(e)); return false; }
  r.stato = 'pronta';
  await salvaRecord(r);
  // insieme alla verifica sono pronti anche l'apparecchio e la ditta nuovi
  if (r.tipo === 'VE') {
    const a = apparecchio(r.d.app);
    if (a && a.nuova && a.rec && a.rec.stato === 'bozza') { a.rec.stato = 'pronta'; await salvaRecord(a.rec); }
    const z = a ? ditta(a.az) : null;
    if (z && z.nuova && z.rec && z.rec.stato === 'bozza') { z.rec.stato = 'pronta'; await salvaRecord(z.rec); }
  }
  if (r.tipo === 'AP' || r.tipo === 'TA') {
    const z = ditta(r.d.az);
    if (z && z.nuova && z.rec && z.rec.stato === 'bozza') { z.rec.stato = 'pronta'; await salvaRecord(z.rec); }
  }
  return true;
}

// ---------------------------------------------------------------- foto
async function riduci(file) {
  try {
    const bmp = await createImageBitmap(file, { imageOrientation: 'from-image' });
    const k = Math.min(1, 1600 / Math.max(bmp.width, bmp.height));
    const c = document.createElement('canvas');
    c.width = Math.round(bmp.width * k);
    c.height = Math.round(bmp.height * k);
    c.getContext('2d').drawImage(bmp, 0, 0, c.width, c.height);
    const b = await new Promise(ok => c.toBlob(ok, 'image/jpeg', 0.72));
    return b || file;
  } catch (e) {
    return file;
  }
}
function sezioneFoto(r, nota) {
  const box = h('div');
  const urls = [];
  pulizia.push(() => urls.forEach(u => URL.revokeObjectURL(u)));
  const disegna = async () => {
    const foto = (await fotoDi(r.uuid)).sort((a, b) => a.creato - b.creato);
    const griglia = h('div', { class: 'foto' });
    for (const f of foto) {
      const u = URL.createObjectURL(f.blob);
      urls.push(u);
      griglia.append(h('figure', {},
        h('img', { src: u, alt: f.descr || 'foto', onclick: async () => {
          if (bloccato(r)) return;
          const t = await chiediTesto('Descrizione della foto', f.descr);
          if (t !== null) { f.descr = t; await metti('foto', f); disegna(); }
        } }),
        h('figcaption', {}, h('span', {}, f.descr || 'tocca per descrivere'),
          bloccato(r) ? null : h('button', { type: 'button', onclick: async () => {
            if (await conferma('Togliere la foto?', 'La foto viene cancellata dal telefono.', 'Togli', 'No', true)) {
              await togli('foto', f.id); disegna();
            } } }, 'togli'))));
    }
    const scegli = (cattura) => {
      const i = h('input', { type: 'file', accept: 'image/*', multiple: !cattura, capture: cattura ? 'environment' : null, hidden: true });
      i.addEventListener('change', async () => {
        for (const file of i.files) {
          await metti('foto', { id: uid(), ref: r.uuid, descr: '', blob: await riduci(file), creato: Date.now() });
        }
        i.remove();
        disegna();
      });
      document.body.append(i);
      i.click();
    };
    box.replaceChildren(
      nota ? h('p', { class: 'nota' }, nota) : null,
      foto.length ? griglia : h('p', { class: 'nota' }, 'Nessuna foto.'),
      bloccato(r) ? null : h('div', { class: 'riga-btn' },
        h('button', { type: 'button', class: 'btn secondario', onclick: () => scegli(true) }, 'Scatta foto'),
        h('button', { type: 'button', class: 'btn secondario', onclick: () => scegli(false) }, 'Dalla galleria')));
  };
  disegna();
  return box;
}

// ---------------------------------------------------------------- vista: inizio
VISTE.home = async main => {
  titolo('Verifiche periodiche');
  if (!E) {
    main.append(
      h('h2', {}, 'Per cominciare'),
      h('p', {}, 'Carica l\'elenco di ditte e apparecchi preparato in Access.'),
      h('p', { class: 'nota' }, 'In Access: Menu > "Elenco per il telefono". Manda il file al telefono (e-mail, cavo, ' +
        'WhatsApp…) e sceglilo qui. L\'elenco va ricaricato ogni tanto, per avere le ditte e gli apparecchi nuovi.'),
      h('button', { class: 'btn', onclick: () => $('#sceltaElenco').click() }, 'Carica l\'elenco'));
    if (installa) main.append(h('button', { class: 'btn secondario', onclick: chiediInstallazione }, 'Installa l\'app sul telefono'));
    return;
  }
  const rec = [...R.values()];
  // apparecchi e ditte nuovi si vedono a parte solo se nessuna verifica (o apparecchio) li usa
  const usati = new Set();
  for (const r of rec) {
    if (r.tipo === 'VE' && String(r.d.app).startsWith('N:')) usati.add(r.d.app.slice(2));
    if ((r.tipo === 'AP' || r.tipo === 'TA') && String(r.d.az).startsWith('N:')) usati.add(r.d.az.slice(2));
  }
  const visibile = r => r.tipo === 'VE' || r.tipo === 'TA' || !usati.has(r.uuid);
  const aperti = rec.filter(r => (r.stato === 'bozza' || r.stato === 'pronta') && visibile(r)).sort((a, b) => b.modificato - a.modificato);
  const pronte = rec.filter(r => r.stato === 'pronta' && visibile(r));
  const inviate = rec.filter(r => (r.stato === 'inviata' || r.stato === 'importata') && visibile(r));
  const nVe = pronte.filter(r => r.tipo === 'VE').length;
  const nTa = pronte.filter(r => r.tipo === 'TA').length;
  const nAltro = pronte.length - nVe - nTa;
  const testoInvio = !pronte.length ? 'Invia al PC'
    : `Invia al PC (${[nVe ? `${nVe} ${nVe === 1 ? 'verifica' : 'verifiche'}` : '', nTa ? `${nTa} ${nTa === 1 ? 'taratura' : 'tarature'}` : '',
        nAltro ? `${nAltro} ${nAltro === 1 ? 'scheda' : 'schede'}` : ''].filter(Boolean).join(', ')})`;

  main.append(
    h('button', { class: 'btn', onclick: () => vai('famiglia') }, 'Nuova verifica'),
    h('button', { class: 'btn secondario', onclick: nuovaTaratura }, 'Taratura valvole al banco'),
    h('h2', {}, 'Sul telefono'),
    aperti.length ? aperti.map(r => {
      const x = descrivi(r);
      return h('button', { class: 'voce', onclick: () => apri(r) }, h('b', {}, x.titolo, chipStato(r)), h('small', {}, x.sotto));
    }) : h('p', { class: 'vuoto' }, 'Nessuna verifica da inviare.'),
    h('button', { class: 'btn verde', disabled: !pronte.length, onclick: () => vai('invio') }, testoInvio),
    pronte.length < aperti.length ? h('p', { class: 'nota' }, 'Si inviano solo quelle segnate come pronte.') : null,
    h('h2', {}, 'Altro'),
    h('button', { class: 'btn secondario', onclick: () => vai('inviate') }, `Già inviate (${inviate.length})`),
    h('button', { class: 'btn secondario', onclick: () => vai('scheda', { data: oggi() }) }, 'Scheda serbatoi (stampa)'),
    h('button', { class: 'btn secondario', onclick: () => $('#sceltaElenco').click() }, 'Carica un elenco aggiornato'),
    installa ? h('button', { class: 'btn secondario', onclick: chiediInstallazione }, 'Installa l\'app sul telefono') : null,
    h('p', { class: 'nota' }, `Elenco di Access del ${E.creato || '?'}: ${(E.aziende || []).length} ditte, ` +
      `${(E.apparecchi || []).length} apparecchi.`));
};
function apri(r) {
  if (r.tipo === 'VE') vai('verifica', r.uuid);
  else if (r.tipo === 'TA') vai('taratura', r.uuid);
  else if (r.tipo === 'AP') vai('apparecchio', { uuid: r.uuid });
  else vai('ditta', { uuid: r.uuid });
}

// ---------------------------------------------------------------- vista: scelta della famiglia
VISTE.famiglia = async main => {
  titolo('Nuova verifica');
  main.append(h('h2', {}, 'Che cosa verifichi?'),
    h('div', { class: 'famiglie' },
      h('button', { onclick: () => vai('cerca', 'Sollevamento', true) }, 'Apparecchio di sollevamento'),
      h('button', { onclick: () => vai('cerca', 'Riscaldamento', true) }, 'Impianto di riscaldamento'),
      h('button', { onclick: () => vai('cerca', 'Pressione', true) }, 'Attrezzatura / insieme a pressione')));
};

// ---------------------------------------------------------------- vista: ricerca dell'apparecchio
function apparecchiDi(fam) {
  const l = (E.apparecchi || []).filter(a => a.fam === fam).map(a => apparecchio('ID:' + a.id));
  for (const r of R.values()) {
    if (r.tipo === 'AP' && r.d.fam === fam && !(r.stato === 'importata' && IDX.apMob.has(r.uuid))) l.push(apparecchio('N:' + r.uuid));
  }
  return l;
}
VISTE.cerca = async (main, fam) => {
  titolo({ Sollevamento: 'Sollevamento', Riscaldamento: 'Riscaldamento', Pressione: 'Pressione' }[fam]);
  const cerca = h('input', { type: 'search', placeholder: 'Matricola, ditta, comune…', autocomplete: 'off' });
  const lista = h('div');
  const elencoApp = apparecchiDi(fam);
  const disegna = () => {
    const q = cerca.value.trim().toLowerCase();
    const trovati = elencoApp.filter(a => {
      if (!q) return true;
      const z = ditta(a.az);
      return contiene(a.mat, q) || contiene(z && z.rs, q) || contiene(a.ubCom, q) || contiene(a.ubInd, q) ||
             contiene(a.nfab, q) || contiene(a.targa, q) || contiene(a.ubPresso, q);
    }).sort((a, b) => String(a.mat).localeCompare(String(b.mat)));
    lista.replaceChildren(
      ...trovati.slice(0, 60).map(a => {
        const z = ditta(a.az);
        const sotto = [z ? z.rs : '', [a.ubCom, a.ubInd].filter(Boolean).join(', '),
          a.prossima ? 'scadenza ' + fmtMese(a.prossima) : (a.nuova ? '' : 'mai verificato da noi')].filter(Boolean).join(' · ');
        return h('button', { class: 'voce', onclick: () => iniziaVerifica(a) },
          h('b', {}, a.mat, a.nuova ? h('span', { class: 'chip nuova' }, 'nuovo') : null), h('small', {}, sotto));
      }),
      trovati.length > 60 ? h('p', { class: 'nota' }, `Altri ${trovati.length - 60}: scrivi di più per restringere.`) : null,
      !trovati.length ? h('p', { class: 'vuoto' }, 'Nessun apparecchio trovato.') : null);
  };
  cerca.addEventListener('input', disegna);
  main.append(etichetta('Cerca l\'apparecchio', cerca), lista,
    h('button', { class: 'btn secondario', onclick: () => apriLettura({ tipo: 'nuovo', fam }) }, 'Leggi da foto (verbale precedente, targhetta)'),
    h('button', { class: 'btn secondario', onclick: async () => {
      const r = await nuovoRecord('AP', { fam, az: null, mat: '', lav: fam === 'Sollevamento' ? true : null, ubTipo: '', ubCom: '',
        ubProv: '', ubInd: '', ubPresso: '', anno: '', tipologia: null, nfab: '', costr: '', mod: '', portata: '', targa: '',
        tipoOgg: 'Attrezzatura', uso: '', note: '', gen: [], vasi: [], disp: [], comp: [], scadINAIL: '', scadIndagine: '' });
      vai('apparecchio', { uuid: r.uuid, poiVerifica: true });
    } }, 'Apparecchio nuovo (non è nell\'elenco)'));
  disegna();
  setTimeout(() => cerca.focus(), 100);
};

async function iniziaVerifica(a) {
  // se c'e' gia' una verifica aperta di oggi per lo stesso apparecchio, riapre quella
  for (const x of R.values()) {
    if (x.tipo === 'VE' && x.d.app === a.ref && x.d.data === oggi() && !bloccato(x)) {
      vai('verifica', x.uuid, true);
      return x;
    }
  }
  const pres = a.fam === 'Pressione';
  const r = await nuovoRecord('VE', {
    app: a.ref, data: oggi(), tipo: tipoPredefinito(a), luogo: a.luogo || a.ubCom || '', esito: esitoPredefinito(),
    funz: pres, integ: false,
    valvMat: pres && a.valv ? a.valv.mat || '' : '', valvData: pres && a.valv ? a.valv.data || '' : '',
    valvBar: pres && a.valv && a.valv.bar !== null && a.valv.bar !== undefined ? String(a.valv.bar).replace('.', ',') : '',
    pe: pres ? testoNum(a.pe) : '', te: pres ? String(a.te || '') : '', mt: '', sp: '', ve: '',
    datiTecnici: a.fam === 'Sollevamento' ? (a.datiTec || a.datiPrec || '') : '', prescrizioni: '', modifiche: '', note: '',
    operatori: IMP.operatore && IDX.op.has(String(IMP.operatore)) ? [String(IMP.operatore)] : [],
    valutazioni: valutazioniPredefinite(a.fam),
  });
  vai('verifica', r.uuid, true);
  return r;
}

// ---------------------------------------------------------------- vista: verifica
VISTE.verifica = async (main, uuid) => {
  const r = R.get(uuid);
  if (!r) { titolo('Verifica'); main.append(h('p', { class: 'vuoto' }, 'Verifica non trovata.')); return; }
  const d = r.d;
  const a = apparecchio(d.app);
  titolo(a ? `Verifica ${a.mat}` : 'Verifica');
  const blocca = bloccato(r);
  const mancanze = riquadroMancanze(r);
  const { salva, segno } = salvataggio(r, () => mancanze.aggiorna());
  if (!a) { main.append(h('div', { class: 'errore' }, 'L\'apparecchio di questa verifica non è più nell\'elenco.')); }
  const z = a ? ditta(a.az) : null;
  const pres = a && a.fam === 'Pressione';

  // intestazione
  if (a) {
    main.append(h('div', { class: 'info' },
      h('div', {}, h('b', {}, a.mat), a.nuova ? h('span', { class: 'chip nuova' }, 'nuovo') : null, chipStato(r)),
      h('div', {}, z ? z.rs : 'ditta?'),
      h('div', {}, [a.ubTipo, a.ubCom, a.ubInd, a.ubPresso ? 'presso ' + a.ubPresso : ''].filter(Boolean).join(' · ')),
      h('div', {}, a.fam, ' · ', a.lav === true ? 'luogo di lavoro' : a.lav === false ? 'non luogo di lavoro' : 'luogo di lavoro da indicare'),
      a.ultima ? h('div', {}, `Ultima verifica: ${fmtData(a.ultima)}`, a.prossima ? ` · scadenza ${fmtMese(a.prossima)}` : '') : null,
      a.fam === 'Sollevamento' && a.indagine ? h('div', {}, `Indagine supplementare entro il ${fmtData(a.indagine)}`) : null,
      (a.disp || []).length ? h('div', {}, (a.disp || []).map(x => `${x.tipo} N° ${x.num || '?'}${x.bar ? ' (' + String(x.bar).replace('.', ',') + ' bar)' : ''}`).join('; ')) : null,
      a.nuova && !blocca ? h('button', { class: 'btn secondario', onclick: () => vai('apparecchio', { uuid: a.rec.uuid }) }, 'Modifica l\'apparecchio nuovo') : null,
      !blocca ? h('button', { class: 'btn secondario', onclick: () => apriLettura({ tipo: 'verifica', uuid: r.uuid }) },
        { Pressione: 'Leggi la valvola da foto', Riscaldamento: 'Leggi i dispositivi da foto' }[a.fam] || 'Leggi da foto (verbale precedente)') : null));
  }

  const op = blocca ? { disabled: true } : {};
  const tipi = tipiPer(a);
  main.append(
    h('h2', {}, 'Verifica'),
    h('div', { class: 'due' },
      etichetta('Data', campoTesto(d, 'data', salva, { tipo: 'date', ...op })),
      etichetta('Esito', campoScelta(d, 'esito', (E.esiti || []).map(e => ({ v: e.id, t: e.breve || e.descr })), salva, op))),
    etichetta('Tipo di verifica', tipi.length
      ? campoScelta(d, 'tipo', tipi.map(t => ({ v: t.id, t: t.descr })), salva, op)
      : h('div', { class: 'avviso' }, 'Indica prima, nell\'apparecchio, se si trova in un luogo di lavoro.')),
    etichetta('Luogo della verifica', campoTesto(d, 'luogo', salva, op)));

  const spessBox = pres ? riquadroSpessimetrie(d, salva, op) : null;
  if (pres) {
    main.append(
      h('h2', {}, 'Verifica di'),
      spunta(d, 'funz', 'funzionamento', salva, op),
      spunta(d, 'integ', 'integrità', salva, op),
      h('h2', {}, 'Valvola di sicurezza'),
      campoNV(d, 'valvMat', 'Matricola', salva, { maiuscole: true, ...op }),
      h('div', { class: 'due' },
        etichetta('Tarata il', campoTesto(d, 'valvData', salva, { tipo: 'date', ...op })),
        etichetta('Alla pressione di (bar)', campoTesto(d, 'valvBar', salva, { num: true, ...op }))),
      h('p', { class: 'nota' }, 'Se conosci solo mese e anno della taratura, scegli il giorno 1.'),
      h('h2', {}, 'Scheda serbatoi'),
      h('div', { class: 'due' },
        campoNV(d, 'pe', 'Pressione di esercizio (bar)', salva, { inputmode: 'decimal', ...op }),
        campoNV(d, 'te', 'Temperatura di esercizio (°C)', salva, op)),
      etichetta('Messa a terra', campoScelta(d, 'mt', vociScheda('MessaTerra').map(v => ({ v, t: v })), salva, op)),
      etichetta('Spessimetria', (() => { const s = campoScelta(d, 'sp', vociScheda('Spessimetria').map(v => ({ v, t: v })), salva, op);
        s.addEventListener('change', () => spessBox.disegna()); return s; })()),
      spessBox,
      etichetta('Verniciatura', campoScelta(d, 've', vociScheda('Verniciatura').map(v => ({ v, t: v })), salva, op)),
      h('button', { class: 'btn secondario', onclick: () => vai('scheda', { data: d.data, az: a.az }) }, 'Scheda serbatoi del giorno (stampa)'));
  }

  // controlli
  if (a) {
    main.append(h('h2', {}, 'Controlli'));
    for (const v of vociDi(a.fam)) {
      main.append(etichetta(v.descr, campoScelta(d.valutazioni, String(v.id),
        (E.valutazioni || []).map(x => ({ v: x.id, t: x.descr })), salva, op)));
    }
  }

  // operatori
  main.append(h('h2', {}, 'Operatori'));
  for (const o of E.operatori || []) {
    const c = h('input', { type: 'checkbox', checked: (d.operatori || []).includes(String(o.id)), disabled: blocca });
    c.addEventListener('change', () => {
      const s = new Set(d.operatori || []);
      if (c.checked) s.add(String(o.id)); else s.delete(String(o.id));
      d.operatori = [...s];
      salva();
    });
    main.append(h('label', { class: 'spunta' }, c, o.nome));
  }

  main.append(h('h2', {}, 'Note'));
  if (a && a.fam === 'Sollevamento') main.append(etichetta('Dati tecnici', campoTesto(d, 'datiTecnici', salva, { area: true, ...op })));
  main.append(
    etichetta('Prescrizioni (vanno sul verbale)', campoTesto(d, 'prescrizioni', salva, { area: true, ...op })),
    etichetta('Modifiche da riportare nella scheda dell\'apparecchio', campoTesto(d, 'modifiche', salva, {
      area: true, ph: 'Es. valvola di sicurezza sostituita: nuova N° …, tarata a … bar', ...op })),
    etichetta('Note interne (non vanno sul verbale)', campoTesto(d, 'note', salva, { area: true, ...op })),
    h('h2', {}, 'Foto'),
    sezioneFoto(r, 'Targhetta, valvola, certificato di taratura…'),
    h('h2', {}, 'Stato'),
    mancanze.box, segno,
    blocca ? null : h('button', { class: 'btn pericolo', onclick: async () => {
      if (await conferma('Eliminare la verifica?', 'La verifica e le sue foto vengono cancellate dal telefono.', 'Elimina', 'No', true)) {
        await eliminaRecord(r); torna('home');
      } } }, 'Elimina questa verifica'));

  if (!blocca) {
    barra(r.stato === 'pronta'
      ? h('button', { class: 'btn secondario', onclick: async () => { r.stato = 'bozza'; await salvaRecord(r); mostra(true); } }, 'Rimetti in bozza')
      : h('button', { class: 'btn verde', onclick: async () => { if (await segnaPronta(r)) torna('home'); } }, 'Pronta da inviare'));
  }
};

// ---------------------------------------------------------------- vista: apparecchio nuovo
VISTE.apparecchio = async (main, arg) => {
  const r = R.get(arg.uuid);
  if (!r) { titolo('Apparecchio'); main.append(h('p', { class: 'vuoto' }, 'Apparecchio non trovato.')); return; }
  const d = r.d;
  titolo('Apparecchio nuovo');
  const blocca = bloccato(r);
  const op = blocca ? { disabled: true } : {};
  const mancanze = riquadroMancanze(r);
  const { salva, segno } = salvataggio(r, () => mancanze.aggiorna());
  const ridisegna = () => { salvaRecord(r).then(() => mostra(true)); pila[pila.length - 1].scroll = window.scrollY; };
  const z = ditta(d.az);

  main.append(h('div', { class: 'info' }, h('b', {}, d.fam), chipStato(r)),
    h('h2', {}, 'Ditta'),
    z ? h('div', { class: 'scheda' }, h('b', {}, z.rs), z.nuova ? h('span', { class: 'chip nuova' }, 'nuova') : null,
          h('div', { class: 'nota' }, [z.piva || z.cf, z.comune].filter(Boolean).join(' · ')))
      : h('p', { class: 'nota' }, 'Nessuna ditta scelta.'),
    blocca ? null : h('div', { class: 'riga-btn' },
      h('button', { class: 'btn secondario', onclick: () => vai('sceltaDitta', r.uuid) }, z ? 'Cambia ditta' : 'Scegli la ditta'),
      z && z.nuova ? h('button', { class: 'btn secondario', onclick: () => vai('ditta', { uuid: z.rec.uuid }) }, 'Modifica la ditta') : null),
    h('h2', {}, 'Dati'),
    blocca ? null : h('button', { class: 'btn secondario', onclick: () => apriLettura({ tipo: 'apparecchio', uuid: r.uuid }) }, 'Compila da foto (verbale precedente, targhetta)'),
    etichetta('Matricola', campoTesto(d, 'mat', salva, { maiuscole: true, ...op })));

  if (d.fam !== 'Sollevamento') {
    main.append(etichetta('Si trova in un luogo di lavoro?', campoSiNo(d, 'lav', salva, ['Sì', 'No'], op)),
      h('p', { class: 'nota' }, 'Da questo dipendono i tipi di verifica, la tariffa e i riferimenti del verbale.'));
  }
  if (d.fam === 'Riscaldamento') main.append(etichetta('Installato nel (es. Condominio)', campoTesto(d, 'ubTipo', salva, op)));
  if (d.fam === 'Pressione') {
    main.append(
      etichetta('Tipo', campoScelta(d, 'tipoOgg', [{ v: 'Attrezzatura', t: 'Attrezzatura in pressione' }, { v: 'Insieme', t: 'Insieme a pressione' }], salva, { vuota: false, ...op })),
      etichetta('Descrizione d\'uso', campoTesto(d, 'uso', salva, { ph: 'Es. Serbatoio adibito a stoccaggio di GPL', ...op })));
  }
  if (d.fam === 'Sollevamento') {
    main.append(
      etichetta('Tipologia', campoScelta(d, 'tipologia', (E.tipologie || []).map(t => ({ v: t.id, t: t.descr })), salva, op)),
      h('div', { class: 'due' },
        etichetta('N. di fabbrica', campoTesto(d, 'nfab', salva, op)),
        etichetta('Targa', campoTesto(d, 'targa', salva, { maiuscole: true, ...op }))),
      h('div', { class: 'due' },
        etichetta('Costruttore', campoTesto(d, 'costr', salva, op)),
        etichetta('Modello', campoTesto(d, 'mod', salva, op))),
      etichetta('Portata (kg)', campoTesto(d, 'portata', salva, { num: true, ...op })),
      etichetta('Indagine supplementare entro (se c\'è)', campoTesto(d, 'scadIndagine', salva, { tipo: 'date', ...op })));
  }
  main.append(etichetta('Anno di costruzione o installazione', campoTesto(d, 'anno', salva, { num: true, ...op })),
    etichetta('Scadenza indicata dall\'INAIL (se c\'è)', campoTesto(d, 'scadINAIL', salva, { tipo: 'date', ...op })),
    h('h2', {}, 'Ubicazione'),
    h('div', { class: 'due' },
      etichetta('Comune', campoTesto(d, 'ubCom', salva, op)),
      etichetta('Provincia', campoTesto(d, 'ubProv', salva, { maiuscole: true, ...op }))),
    etichetta('Indirizzo', campoTesto(d, 'ubInd', salva, op)),
    etichetta('Presso', campoTesto(d, 'ubPresso', salva, op)));

  // elenchi ripetibili
  const blocchi = (titoloSez, chiave, nomeUno, nuovo, campi) => {
    main.append(h('h2', {}, titoloSez));
    (d[chiave] || []).forEach((x, i) => {
      main.append(h('div', { class: 'blocco' },
        h('h3', {}, `${nomeUno} ${i + 1}`, blocca ? null : h('button', { type: 'button', onclick: async () => {
          if (await conferma(`Togliere ${nomeUno.toLowerCase()} ${i + 1}?`, 'I suoi dati vengono cancellati.', 'Togli', 'No', true)) {
            d[chiave].splice(i, 1); ridisegna();
          } } }, 'togli')),
        campi(x)));
    });
    if (!blocca) main.append(h('button', { class: 'btn secondario', onclick: () => { d[chiave] = d[chiave] || []; d[chiave].push(nuovo()); ridisegna(); } }, `Aggiungi ${nomeUno.toLowerCase()}`));
  };

  if (d.fam === 'Riscaldamento') {
    blocchi('Generatori di calore', 'gen', 'Generatore', () => ({ num: String((d.gen || []).length + 1), tipo: null, costr: '', nfab: '', bar: '', comb: null, kw: '' }), x => [
      h('div', { class: 'due' },
        etichetta('Numero', campoTesto(x, 'num', salva, op)),
        etichetta('Potenza focolare (kW)', campoTesto(x, 'kw', salva, { num: true, ...op }))),
      etichetta('Tipo', campoScelta(x, 'tipo', (E.tipiGeneratore || []).map(t => ({ v: t.cod, t: `${t.cod} - ${t.descr}` })), salva, op)),
      etichetta('Combustibile', campoScelta(x, 'comb', (E.combustibili || []).map(t => ({ v: t.cod, t: `${t.cod} - ${t.descr}` })), salva, op)),
      h('div', { class: 'due' },
        etichetta('Costruttore', campoTesto(x, 'costr', salva, op)),
        etichetta('N. di fabbrica', campoTesto(x, 'nfab', salva, op))),
      etichetta('Pressione (bar)', campoTesto(x, 'bar', salva, { num: true, ...op }))]);
    blocchi('Vasi di espansione', 'vasi', 'Vaso', () => ({ num: String((d.vasi || []).length + 1), litri: '', nfab: '' }), x => [
      h('div', { class: 'tre' },
        etichetta('Numero', campoTesto(x, 'num', salva, op)),
        etichetta('Litri', campoTesto(x, 'litri', salva, { num: true, ...op })),
        etichetta('N. fabbrica', campoTesto(x, 'nfab', salva, op)))]);
    blocchi('Dispositivi di sicurezza', 'disp', 'Dispositivo', () => {
      const ha = (d.disp || []).some(v => v.tipo === 'Valvola di sicurezza');
      return { tipo: ha ? 'Valvola di intercettazione combustibile' : 'Valvola di sicurezza', num: '', bar: '' };
    }, x => [
      etichetta('Tipo', campoScelta(x, 'tipo', (E.tipiDispositivo || ['Valvola di sicurezza', 'Valvola di intercettazione combustibile']).map(t => ({ v: t, t })), salva, { vuota: false, ...op })),
      h('div', { class: 'due' },
        etichetta('Numero', campoTesto(x, 'num', salva, { maiuscole: true, ...op })),
        etichetta('Taratura (bar)', campoTesto(x, 'bar', salva, { num: true, ...op })))]);
  }
  if (d.fam === 'Pressione') {
    blocchi('Dati del recipiente (per un insieme: un componente per scheda)', 'comp', 'Componente', () => ({
      tipo: 'RG', fabbr: '', nfab: '', attr: '', gruppo: null, cat: null, litri: '', ps: '', pe: '', tsmin: '', tsmax: '', te: '' }), x => [
      etichetta('Tipo', campoScelta(x, 'tipo', (E.tipiAttrezzatura || [{ cod: 'RG', descr: 'Recipiente gas' }]).map(t => ({ v: t.cod, t: `${t.cod} - ${t.descr}` })), salva, op)),
      h('div', { class: 'due' },
        etichetta('Fabbricante', campoTesto(x, 'fabbr', salva, op)),
        etichetta('N. di fabbrica', campoTesto(x, 'nfab', salva, op))),
      h('div', { class: 'tre' },
        etichetta('Attr./Cam.', campoTesto(x, 'attr', salva, op)),
        etichetta('Gruppo fluido', campoScelta(x, 'gruppo', [{ v: '1', t: '1' }, { v: '2', t: '2' }], salva, op)),
        etichetta('Categoria', campoScelta(x, 'cat', ['I', 'II', 'III', 'IV'].map(v => ({ v, t: v })), salva, op))),
      h('div', { class: 'tre' },
        etichetta('Capacità (litri)', campoTesto(x, 'litri', salva, { num: true, ...op })),
        etichetta('PS massima (bar)', campoTesto(x, 'ps', salva, { num: true, ...op })),
        etichetta('P esercizio (bar)', campoTesto(x, 'pe', salva, { num: true, ...op }))),
      h('div', { class: 'tre' },
        etichetta('TS min (°C)', campoTesto(x, 'tsmin', salva, { num: true, ...op })),
        etichetta('TS max (°C)', campoTesto(x, 'tsmax', salva, { num: true, ...op })),
        etichetta('T esercizio (°C)', campoTesto(x, 'te', salva, { num: true, ...op })))]);
  }

  main.append(h('h2', {}, 'Note e foto'),
    etichetta('Note', campoTesto(d, 'note', salva, { area: true, ...op })),
    sezioneFoto(r, 'Targhetta e dati di costruzione.'),
    h('h2', {}, 'Stato'), mancanze.box, segno,
    blocca ? null : h('button', { class: 'btn pericolo', onclick: async () => {
      const usate = [...R.values()].filter(x => x.tipo === 'VE' && x.d.app === 'N:' + r.uuid);
      if (usate.length) { await messaggio('Non si può eliminare', `L'apparecchio è usato da ${usate.length} verifica/e: elimina prima quelle.`); return; }
      if (await conferma('Eliminare l\'apparecchio nuovo?', 'L\'apparecchio e le sue foto vengono cancellati dal telefono.', 'Elimina', 'No', true)) {
        await eliminaRecord(r); torna('home');
      } } }, 'Elimina questo apparecchio'));

  if (!blocca) {
    barra(arg.poiVerifica
      ? h('button', { class: 'btn verde', onclick: async () => {
          const e = errori(r);
          if (e.length) { await messaggio('Manca ancora qualcosa', elencoPunti(e)); return; }
          await iniziaVerifica(apparecchio('N:' + r.uuid));
        } }, 'Avanti: la verifica')
      : h('button', { class: 'btn', onclick: () => indietro() }, 'Fatto'));
  }
};

// ---------------------------------------------------------------- vista: scelta della ditta (per un apparecchio nuovo)
VISTE.sceltaDitta = async (main, uuidApp) => {
  const r = R.get(uuidApp);
  titolo('Scegli la ditta');
  const cerca = h('input', { type: 'search', placeholder: 'Ragione sociale, P.IVA, comune…', autocomplete: 'off' });
  const lista = h('div');
  const tutte = (E.aziende || []).map(a => ditta('ID:' + a.id));
  for (const x of R.values()) if (x.tipo === 'AZ' && !(x.stato === 'importata' && IDX.azMob.has(x.uuid))) tutte.push(ditta('N:' + x.uuid));
  const scegli = async z => { r.d.az = z.ref; await salvaRecord(r); indietro(); };
  const disegna = () => {
    const q = cerca.value.trim().toLowerCase();
    const t = tutte.filter(z => !q || contiene(z.rs, q) || contiene(z.piva, q) || contiene(z.cf, q) || contiene(z.comune, q))
      .sort((a, b) => String(a.rs).localeCompare(String(b.rs)));
    lista.replaceChildren(...t.slice(0, 60).map(z => h('button', { class: 'voce', onclick: () => scegli(z) },
      h('b', {}, z.rs, z.nuova ? h('span', { class: 'chip nuova' }, 'nuova') : null),
      h('small', {}, [z.piva || z.cf, z.comune].filter(Boolean).join(' · ')))),
      !t.length ? h('p', { class: 'vuoto' }, 'Nessuna ditta trovata.') : null);
  };
  cerca.addEventListener('input', disegna);
  main.append(etichetta('Cerca la ditta', cerca), lista,
    h('button', { class: 'btn secondario', onclick: async () => {
      const z = await nuovoRecord('AZ', { tipo: 'Azienda', rs: cerca.value.trim(), piva: '', cf: '', sdi: '', pec: '', email: '',
        tel: '', ref: '', ind: '', cap: '', com: '', prov: '' });
      r.d.az = 'N:' + z.uuid;
      await salvaRecord(r);
      vai('ditta', { uuid: z.uuid }, true);
    } }, 'Ditta nuova (non è nell\'elenco)'));
  disegna();
  setTimeout(() => cerca.focus(), 100);
};

// ---------------------------------------------------------------- vista: ditta nuova
VISTE.ditta = async (main, arg) => {
  const r = R.get(arg.uuid);
  if (!r) { titolo('Ditta'); main.append(h('p', { class: 'vuoto' }, 'Ditta non trovata.')); return; }
  const d = r.d;
  titolo('Ditta nuova');
  const blocca = bloccato(r);
  const op = blocca ? { disabled: true } : {};
  const mancanze = riquadroMancanze(r);
  const { salva, segno } = salvataggio(r, () => mancanze.aggiorna());
  main.append(h('div', { class: 'info' }, h('b', {}, 'Ditta nuova'), chipStato(r)),
    etichetta('Tipo', campoScelta(d, 'tipo', ['Azienda', 'Condominio', 'Ente pubblico', 'Privato'].map(v => ({ v, t: v })), salva, { vuota: false, ...op })),
    etichetta('Ragione sociale', campoTesto(d, 'rs', salva, op)),
    h('div', { class: 'due' },
      etichetta('Partita IVA', campoTesto(d, 'piva', salva, { inputmode: 'numeric', ...op })),
      etichetta('Codice fiscale', campoTesto(d, 'cf', salva, { maiuscole: true, ...op }))),
    etichetta('Codice SDI', campoTesto(d, 'sdi', salva, { maiuscole: true, ...op })),
    etichetta('Indirizzo', campoTesto(d, 'ind', salva, op)),
    h('div', { class: 'tre' },
      etichetta('CAP', campoTesto(d, 'cap', salva, { inputmode: 'numeric', ...op })),
      etichetta('Comune', campoTesto(d, 'com', salva, op)),
      etichetta('Prov.', campoTesto(d, 'prov', salva, { maiuscole: true, ...op }))),
    etichetta('PEC', campoTesto(d, 'pec', salva, { tipo: 'email', ...op })),
    etichetta('E-mail', campoTesto(d, 'email', salva, { tipo: 'email', ...op })),
    etichetta('Telefono', campoTesto(d, 'tel', salva, { tipo: 'tel', ...op })),
    etichetta(d.tipo === 'Condominio' ? 'Amministratore' : 'Referente', campoTesto(d, 'ref', salva, op)),
    h('h2', {}, 'Stato'), mancanze.box, segno,
    blocca ? null : h('button', { class: 'btn pericolo', onclick: async () => {
      const usata = [...R.values()].some(x => (x.tipo === 'AP' || x.tipo === 'TA') && x.d.az === 'N:' + r.uuid);
      if (usata) { await messaggio('Non si può eliminare', 'La ditta è usata da un apparecchio nuovo o da una taratura: cambia prima la ditta.'); return; }
      if (await conferma('Eliminare la ditta nuova?', 'I dati vengono cancellati dal telefono.', 'Elimina', 'No', true)) { await eliminaRecord(r); indietro(); }
    } }, 'Elimina questa ditta'));
  if (!blocca) barra(h('button', { class: 'btn', onclick: () => indietro() }, 'Fatto'));
};

// ---------------------------------------------------------------- file per Access
function esc(v) {
  if (v === null || v === undefined) return '';
  let o = '';
  for (const ch of String(v)) {
    const c = ch.codePointAt(0);
    if (ch === '\\') o += '\\\\';
    else if (ch === '\t') o += '\\t';
    else if (ch === '\n') o += '\\n';
    else if (ch === '\r') continue;
    else if (c < 32) o += ' ';
    else if (c > 126) {
      for (let i = 0; i < ch.length; i++) o += '\\u' + ch.charCodeAt(i).toString(16).toUpperCase().padStart(4, '0');
    } else o += ch;
  }
  return o;
}
const CAMPI = {
  AZ: ['uuid', 'Tipo', 'RagioneSociale', 'PartitaIVA', 'CodiceFiscale', 'CodiceSDI', 'PEC', 'Email', 'Telefono', 'Referente',
       'Indirizzo', 'CAP', 'Comune', 'Provincia'],
  AP: ['uuid', 'Azienda', 'Famiglia', 'Matricola', 'LuogoDiLavoro', 'UbicazioneTipo', 'UbicazioneComune', 'UbicazioneProvincia',
       'UbicazioneIndirizzo', 'UbicazionePresso', 'Anno', 'IDTipologia', 'NumeroFabbrica', 'Costruttore', 'Modello', 'PortataKg',
       'Targa', 'TipoOggetto', 'DescrizioneUso', 'Note', 'ProssimaVerificaIniziale', 'ScadenzaIndagineSupplementare'],
  GE: ['Apparecchio', 'Numero', 'CodiceTipoGeneratore', 'Costruttore', 'NumeroFabbrica', 'PressioneBar', 'CodiceCombustibile', 'PotenzaFocolareKW'],
  VA: ['Apparecchio', 'Numero', 'CapacitaLitri', 'NumeroFabbrica'],
  DS: ['Apparecchio', 'Tipo', 'Numero', 'TaraturaBar'],
  CP: ['Apparecchio', 'CodiceTipo', 'Fabbricante', 'NumeroFabbrica', 'AttrCam', 'GruppoFluido', 'Categoria', 'CapacitaLitri',
       'PSBar', 'PEsercizioBar', 'TSMin', 'TSMax', 'TEsercizio'],
  VE: ['uuid', 'Apparecchio', 'DataIspezione', 'IDTipoVerifica', 'Luogo', 'IDEsito', 'Funzionamento', 'Integrita', 'ValvolaMatricola',
       'ValvolaDataTaratura', 'ValvolaTaraturaBar', 'DatiTecnici', 'Prescrizioni', 'Modifiche', 'NoteInterne', 'Operatori',
       'Valutazioni', 'Telefono', 'PressioneEsercizio', 'TemperaturaEsercizio', 'MessaTerra', 'Spessimetria', 'Verniciatura',
       'SpessFondoSinistro', 'SpessFondoDestro', 'SpessFasciame'],
  FO: ['Riferimento', 'Nome', 'Descrizione', 'Dati'],
};
const riga = (tipo, valori) => [tipo, ...valori.map(esc)].join('\t');
const n = v => numeroOut(v) || '';
const sino = v => (v === true ? '1' : v === false ? '0' : '');
// rilievi spessimetrici per Access: "5.82;5.90;6.04" (punto decimale), solo con "Da valutare libretto"
const rilieviInvio = (d, k) => (d.sp === SPESS_DA_VALUTARE && d.spess ? (d.spess[k] || []).map(numeroOut).filter(x => x).join(';') : '');
function blobBase64(b) {
  return new Promise((ok, ko) => {
    const f = new FileReader();
    f.onload = () => ok(String(f.result).split(',')[1] || '');
    f.onerror = () => ko(f.error);
    f.readAsDataURL(b);
  });
}

// Prepara il contenuto del file: verifiche, apparecchi e ditte nuovi collegati, foto
async function preparaInvio(anche) {
  const stati = new Set(['pronta', ...(anche ? ['inviata'] : [])]);
  const scelti = [...R.values()].filter(r => stati.has(r.stato));
  const AZ = new Map(), AP = new Map(), VE = [], TA = [];
  const problemi = [];
  const aggAz = ref => { if (ref && ref.startsWith('N:')) { const z = R.get(ref.slice(2)); if (z) AZ.set(z.uuid, z); } };
  const aggAp = ref => { if (ref && ref.startsWith('N:')) { const x = R.get(ref.slice(2)); if (x) { AP.set(x.uuid, x); aggAz(x.d.az); } } };
  for (const r of scelti) {
    const e = errori(r);
    if (e.length && r.stato === 'pronta') { problemi.push(`${descrivi(r).titolo}: manca ${e.join('; ')}`); continue; }
    if (r.tipo === 'VE') { VE.push(r); aggAp(r.d.app); }
    if (r.tipo === 'AP') { AP.set(r.uuid, r); aggAz(r.d.az); }
    if (r.tipo === 'AZ') AZ.set(r.uuid, r);
    if (r.tipo === 'TA') { TA.push(r); aggAz(r.d.az); for (const v of r.d.valvole || []) aggAp(v.app); }
  }
  const ref = x => (x ? x : '');
  const L = [`VPINVIO\t${FORMATO_INVIO}\t${esc(IMP.telefono || 'telefono')}\t${adesso()}\t${VERSIONE_APP}`];
  for (const t of Object.keys(CAMPI)) L.push('#' + t + '\t' + CAMPI[t].join('\t'));
  for (const z of AZ.values()) {
    const d = z.d;
    L.push(riga('AZ', [z.uuid, d.tipo, d.rs, d.piva, d.cf, d.sdi, d.pec, d.email, d.tel, d.ref, d.ind, d.cap, d.com, d.prov]));
  }
  for (const x of AP.values()) {
    const d = x.d;
    const soll = d.fam === 'Sollevamento', pres = d.fam === 'Pressione';
    L.push(riga('AP', [x.uuid, ref(d.az), d.fam, String(d.mat || '').trim(), sino(d.lav), d.fam === 'Riscaldamento' ? d.ubTipo : '',
      d.ubCom, d.ubProv, d.ubInd, d.ubPresso,
      n(d.anno), soll ? d.tipologia || '' : '', soll ? d.nfab : '', soll ? d.costr : '', soll ? d.mod : '', soll ? n(d.portata) : '',
      soll ? d.targa : '', pres ? d.tipoOgg : '', pres ? d.uso : '', d.note, d.scadINAIL || '', soll ? d.scadIndagine || '' : '']));
    for (const g of d.gen || []) L.push(riga('GE', [x.uuid, g.num, g.tipo || '', g.costr, g.nfab, n(g.bar), g.comb || '', n(g.kw)]));
    for (const v of d.vasi || []) L.push(riga('VA', [x.uuid, v.num, n(v.litri), v.nfab]));
    for (const v of d.disp || []) L.push(riga('DS', [x.uuid, v.tipo, v.num, n(v.bar)]));
    for (const c of d.comp || []) L.push(riga('CP', [x.uuid, c.tipo || '', c.fabbr, c.nfab, c.attr, c.gruppo || '', c.cat || '',
      n(c.litri), n(c.ps), n(c.pe), n(c.tsmin), n(c.tsmax), n(c.te)]));
  }
  VE.sort((a, b) => String(a.d.data).localeCompare(String(b.d.data)));
  for (const v of VE) {
    const d = v.d;
    const a = apparecchio(d.app);
    const pres = a && a.fam === 'Pressione';
    const val = Object.entries(d.valutazioni || {}).filter(([, x]) => x).map(([k, x]) => `${k}=${x}`).join(';');
    L.push(riga('VE', [v.uuid, d.app, d.data, d.tipo || '', d.luogo, d.esito || '', pres ? sino(Boolean(d.funz)) : '',
      pres ? sino(Boolean(d.integ)) : '', pres ? String(d.valvMat || '').trim() : '', pres ? d.valvData || '' : '',
      pres ? n(d.valvBar) : '', a && a.fam === 'Sollevamento' ? d.datiTecnici : '', d.prescrizioni, d.modifiche, d.note,
      (d.operatori || []).join(','), val, IMP.telefono || '', pres ? d.pe || '' : '', pres ? d.te || '' : '',
      pres ? d.mt || '' : '', pres ? d.sp || '' : '', pres ? d.ve || '' : '',
      pres ? rilieviInvio(d, 'fs') : '', pres ? rilieviInvio(d, 'fd') : '', pres ? rilieviInvio(d, 'fa') : '']));
  }
  TA.sort((a, b) => String(a.d.data).localeCompare(String(b.d.data)));
  for (const t of TA) L.push(...righeTaratura(t));
  let nFoto = 0;
  const conFoto = [...AP.values(), ...VE];
  for (const r of conFoto) {
    const foto = (await fotoDi(r.uuid)).sort((a, b) => a.creato - b.creato);
    let i = 0;
    for (const f of foto) {
      i++;
      L.push(riga('FO', [`${r.tipo}:${r.uuid}`, `foto${i}.jpg`, f.descr || '', await blobBase64(f.blob)]));
      nFoto++;
    }
  }
  const nDati = L.length - 1 - Object.keys(CAMPI).length;
  L.push(`FINE\t${nDati}`);
  return { testo: L.join('\r\n') + '\r\n', inclusi: [...AZ.values(), ...AP.values(), ...VE, ...TA], VE, TA, AP, AZ, nFoto, problemi };
}

VISTE.invio = async (main, anche) => {
  titolo('Invia al PC');
  main.append(h('p', { class: 'vuoto' }, 'Preparo il file…'));
  const p = await preparaInvio(anche);
  main.replaceChildren();
  if (p.problemi.length) {
    main.append(h('div', { class: 'avviso' }, h('b', {}, 'Restano sul telefono (da completare):'), elencoPunti(p.problemi)));
  }
  if (!p.inclusi.length) { main.append(h('p', { class: 'vuoto' }, 'Non c\'è niente da inviare.')); return; }
  const kb = Math.round(new Blob([p.testo]).size / 1024);
  const nome = `invio_${(IMP.telefono || 'telefono').replace(/[^A-Za-z0-9]+/g, '-')}_${adesso().replace(/[-: ]/g, '').slice(0, 12)}.txt`;
  const file = new File([p.testo], nome, { type: 'text/plain' });
  main.append(
    h('div', { class: 'scheda' },
      p.VE.length || !p.TA.length ? h('div', {}, h('span', { class: 'conteggio' }, p.VE.length), ` ${p.VE.length === 1 ? 'verifica' : 'verifiche'}`) : null,
      p.TA.length ? h('div', {}, h('span', { class: 'conteggio' }, p.TA.length), ` ${p.TA.length === 1 ? 'taratura di valvole' : 'tarature di valvole'}`) : null,
      p.AP.size ? h('div', {}, `${p.AP.size} ${p.AP.size === 1 ? 'apparecchio nuovo' : 'apparecchi nuovi'}`) : null,
      p.AZ.size ? h('div', {}, `${p.AZ.size} ${p.AZ.size === 1 ? 'ditta nuova' : 'ditte nuove'}`) : null,
      h('div', { class: 'nota' }, `${p.nFoto} foto · file ${nome} (${kb > 1024 ? (kb / 1024).toFixed(1) + ' MB' : kb + ' KB'})`)),
    h('p', {}, 'Manda il file al computer con Access (e-mail, cavo USB, Drive…). In Access: Menu > "Importa dal telefono".'),
    kb > 15000 ? h('div', { class: 'avviso' }, 'Il file è grande per un\'e-mail: usa il cavo o una cartella condivisa, oppure invia meno verifiche alla volta.') : null);
  const fatto = async () => {
    if (!await conferma('File inviato?', 'Hai mandato o salvato il file? Le verifiche passano tra le "già inviate" e non si possono più modificare sul telefono.', 'Sì, inviato', 'Non ancora')) return;
    for (const r of p.inclusi) if (r.stato === 'pronta') { r.stato = 'inviata'; r.inviato = Date.now(); await salvaRecord(r); }
    torna('home');
  };
  const condividi = async () => {
    try {
      if (navigator.canShare && navigator.canShare({ files: [file] })) {
        await navigator.share({ files: [file], title: 'Verifiche dal telefono' });
        await fatto();
        return;
      }
    } catch (e) {
      if (e && e.name === 'AbortError') return;
    }
    salvaFile();
  };
  const salvaFile = async () => {
    const u = URL.createObjectURL(file);
    const a = h('a', { href: u, download: nome, hidden: true });
    document.body.append(a);
    a.click();
    setTimeout(() => { URL.revokeObjectURL(u); a.remove(); }, 4000);
    await messaggio('File salvato', `Il file ${nome} è nella cartella Download del telefono.`);
    await fatto();
  };
  main.append(
    h('button', { class: 'btn verde', onclick: condividi }, 'Invia (e-mail, Drive, …)'),
    h('button', { class: 'btn secondario', onclick: salvaFile }, 'Salva nella cartella Download'));
};

// ---------------------------------------------------------------- vista: gia' inviate
VISTE.inviate = async main => {
  titolo('Già inviate');
  const l = [...R.values()].filter(r => r.stato === 'inviata' || r.stato === 'importata').sort((a, b) => (b.inviato || 0) - (a.inviato || 0));
  const arrivate = l.filter(r => r.stato === 'importata');
  const nonArrivate = l.filter(r => r.stato === 'inviata');
  main.append(h('p', { class: 'nota' }, '"In Access" vuol dire che il record risulta nell\'ultimo elenco caricato. ' +
    'Le altre sono state inviate ma non ancora confermate: se il file si è perso, inviale di nuovo (Access non le duplica).'));
  if (arrivate.length) {
    main.append(h('button', { class: 'btn secondario', onclick: async () => {
      if (!await conferma('Togliere dal telefono?', `Cancello dal telefono ${arrivate.length} record già arrivati in Access, con le loro foto.`, 'Togli', 'No')) return;
      for (const r of arrivate) {
        const usato = [...R.values()].some(x => x.stato !== 'importata' && (x.d.app === 'N:' + r.uuid || x.d.az === 'N:' + r.uuid));
        if (!usato) await eliminaRecord(r);
      }
      mostra();
    } }, `Togli quelli già in Access (${arrivate.length})`));
  }
  if (nonArrivate.length) main.append(h('button', { class: 'btn secondario', onclick: () => vai('invio', true) }, `Invia di nuovo quelle non confermate (${nonArrivate.length})`));
  main.append(l.length ? l.map(r => {
    const x = descrivi(r);
    return h('button', { class: 'voce', onclick: () => apri(r) }, h('b', {}, x.titolo, chipStato(r)),
      h('small', {}, x.sotto, r.inviato ? ` · inviata il ${new Date(r.inviato).toLocaleDateString('it-IT')}` : ''));
  }) : h('p', { class: 'vuoto' }, 'Nessuna.'));
};

// ---------------------------------------------------------------- vista: impostazioni
VISTE.impostazioni = async main => {
  titolo('Impostazioni');
  const salva = () => metti('impostazioni', IMP, 'imp');
  main.append(
    etichetta('Nome di questo telefono (es. il tuo cognome)', campoTesto(IMP, 'telefono', salva, { ph: 'Rossi' })),
    h('p', { class: 'nota' }, 'Compare nel nome del file e nelle note della verifica, per sapere da quale telefono arriva.'),
    E ? etichetta('Operatore proposto nelle verifiche nuove', campoScelta(IMP, 'operatore', (E.operatori || []).map(o => ({ v: o.id, t: o.nome })), salva, { vuota: '— nessuno —' })) : null,
    h('h2', {}, 'Elenco di Access'),
    h('p', {}, E ? `Caricato l'elenco del ${E.creato || '?'}: ${(E.aziende || []).length} ditte, ${(E.apparecchi || []).length} apparecchi, ${(E.operatori || []).length} operatori.` : 'Nessun elenco caricato.'),
    h('button', { class: 'btn secondario', onclick: () => $('#sceltaElenco').click() }, 'Carica l\'elenco'),
    sezioneLettura(),
    h('h2', {}, 'Informazioni'),
    h('p', { class: 'nota', id: 'spazio' }, `Versione ${VERSIONE_APP}. I dati restano su questo telefono finché non li invii.`),
    h('button', { class: 'btn pericolo', onclick: async () => {
      if (!await conferma('Cancellare tutto?', 'Cancello dal telefono elenco, verifiche, apparecchi, ditte e foto, anche quelli non inviati.', 'Cancella tutto', 'No', true)) return;
      if (!await conferma('Sicuro?', 'Non si può annullare.', 'Sì, cancella', 'No', true)) return;
      for (const s of ['elenco', 'record', 'foto']) await tx(s, 'readwrite', x => x.clear());
      R.clear(); E = null; indicizza(); torna('home'); mostra();
    } }, 'Cancella tutti i dati dal telefono'));
  if (navigator.storage && navigator.storage.estimate) {
    const s = await navigator.storage.estimate();
    const p = navigator.storage.persisted ? await navigator.storage.persisted() : false;
    const el = document.getElementById('spazio');
    if (el) el.textContent += ` Spazio usato: ${Math.round((s.usage || 0) / 1048576)} MB.` + (p ? ' Archivio protetto dalla pulizia automatica.' : '');
  }
};

// ---------------------------------------------------------------- caricamento dell'elenco
async function caricaElenco(file) {
  let j;
  try {
    j = JSON.parse((await file.text()).replace(/^﻿/, ''));
  } catch (e) {
    await messaggio('File non valido', 'Questo file non è un elenco preparato da Access.');
    return;
  }
  if (!j || j.formato !== 'VP-elenco') { await messaggio('File non valido', 'Questo file non è un elenco preparato da Access ("Elenco per il telefono").'); return; }
  E = j;
  indicizza();
  await metti('elenco', j, 'corrente');
  // record gia' arrivati in Access, e riferimenti ai nuovi ora presenti nell'elenco
  const arrivati = new Set(j.importati || []);
  let nArr = 0;
  for (const r of R.values()) {
    let cambia = false;
    if (arrivati.has(r.uuid) && r.stato !== 'importata') { r.stato = 'importata'; cambia = true; nArr++; }
    if (r.tipo === 'VE' && String(r.d.app).startsWith('N:') && IDX.apMob.has(r.d.app.slice(2))) { r.d.app = 'ID:' + IDX.apMob.get(r.d.app.slice(2)).id; cambia = true; }
    if (r.tipo === 'AP' && String(r.d.az).startsWith('N:') && IDX.azMob.has(r.d.az.slice(2))) { r.d.az = 'ID:' + IDX.azMob.get(r.d.az.slice(2)).id; cambia = true; }
    if (cambia) await salvaRecord(r);
  }
  await messaggio('Elenco caricato', `${(j.aziende || []).length} ditte e ${(j.apparecchi || []).length} apparecchi (elenco del ${j.creato || '?'}).` +
    (nArr ? ` ${nArr} record inviati risultano ora in Access.` : ''));
  if (!IMP.operatore && (j.operatori || []).length) vai('impostazioni'); else mostra();
}

async function chiediInstallazione() {
  if (!installa) return;
  installa.prompt();
  try { await installa.userChoice; } catch (e) { /* niente */ }
  installa = null;
  mostra();
}

// ---- Rilievi spessimetrici (pressione, solo con spessimetria "Da valutare libretto") ----
// d.spess = { fs: [10 caselle], fd: [...], fa: [...] }: fondo sinistro, fondo destro, fasciame, in mm con 2 decimali
const PUNTI_SPESS = [['fs', 'Fondo sinistro'], ['fd', 'Fondo destro'], ['fa', 'Fasciame']];
const SPESS_DA_VALUTARE = 'Da valutare libretto';
const mmTesto = n => n.toLocaleString('it-IT', { minimumFractionDigits: 2, maximumFractionDigits: 2, useGrouping: false });
// mentre si scrive: solo cifre e una virgola, al massimo 2 decimali
const mmPulisci = t => { const m = /^(\d*)([,.]?)(\d{0,2})/.exec(String(t).replace(/[^\d,.]/g, '')); return m[1] + (m[2] ? ',' : '') + m[3]; };
const minimoSpess = v => { const n = (v || []).map(numeroOut).filter(x => x).map(parseFloat); return n.length ? Math.min(...n) : null; };
function riquadroSpessimetrie(d, salva, op) {
  const box = h('div');
  box.disegna = () => {
    if (d.sp !== SPESS_DA_VALUTARE) { box.replaceChildren(); return; }
    d.spess = d.spess || {};
    box.replaceChildren(h('div', { class: 'blocco spess-box' },
      h('h3', {}, 'Rilievi spessimetrici (mm)'),
      h('p', { class: 'nota' }, 'Da 1 a 10 rilievi per punto, con 2 decimali (5,80); le caselle vuote non si stampano.'),
      PUNTI_SPESS.map(([k, nome]) => {
        const v = d.spess[k] = d.spess[k] || Array(10).fill('');
        const min = h('span', { class: 'spess-min' });
        const agg = () => {
          const m = minimoSpess(v); const n = v.filter(x => numeroOut(x)).length;
          min.textContent = n ? `minimo ${mmTesto(m)} mm · ${n} ${n === 1 ? 'rilievo' : 'rilievi'}` : 'nessun rilievo';
        };
        const caselle = v.map((x, i) => {
          const c = h('input', { type: 'text', inputmode: 'decimal', value: x, placeholder: String(i + 1), disabled: op.disabled, 'aria-label': `${nome} rilievo ${i + 1}` });
          c.addEventListener('input', () => { const t = mmPulisci(c.value); if (t !== c.value) c.value = t; v[i] = t; agg(); salva(); });
          // uscendo dalla casella: sempre 2 decimali (5,8 -> 5,80)
          c.addEventListener('change', () => { const n = numeroOut(c.value); if (n) { c.value = mmTesto(parseFloat(n)); v[i] = c.value; salva(); } });
          return c;
        });
        agg();
        return h('div', { class: 'spess-punto' }, h('div', { class: 'spess-testa' }, h('b', {}, nome), min), h('div', { class: 'spess-griglia' }, caselle));
      })));
  };
  box.disegna();
  return box;
}

// ---------------------------------------------------------------- avvio
async function avvio() {
  try {
    await apriDB();
  } catch (e) {
    $('#vista').append(h('div', { class: 'errore' }, 'Il telefono non permette di salvare i dati (archivio non disponibile). ' +
      'Apri l\'app con Chrome, non in una finestra anonima.'));
    return;
  }
  E = (await leggi('elenco', 'corrente')) || null;
  for (const r of await tutti('record')) R.set(r.uuid, r);
  IMP = Object.assign(IMP, (await leggi('impostazioni', 'imp')) || {});
  indicizza();
  if (navigator.storage && navigator.storage.persist) navigator.storage.persist().catch(() => {});
  $('#indietro').addEventListener('click', indietro);
  $('#menu').addEventListener('click', () => { if (pila[pila.length - 1].nome !== 'impostazioni') vai('impostazioni'); });
  $('#sceltaElenco').addEventListener('change', async ev => {
    const f = ev.target.files[0];
    ev.target.value = '';
    if (f) await caricaElenco(f);
  });
  $('#velo').addEventListener('click', ev => { if (ev.target.id === 'velo' && chiudiFinestra) chiudiFinestra(); });
  pila.push({ nome: 'home', arg: null, scroll: 0 });
  history.replaceState({ n: 1 }, '');
  mostra();
  // dopo un aggiornamento: conferma una volta sola (fino alla 1.4 la versione non era salvata)
  const prima = IMP.versione || (E || R.size ? 'precedente' : '');
  if (prima && prima !== VERSIONE_APP) avvisoBarra(`App aggiornata alla versione ${VERSIONE_APP}.`, null, null, 8);
  if (IMP.versione !== VERSIONE_APP) {
    IMP.versione = VERSIONE_APP;
    metti('impostazioni', IMP, 'imp').catch(() => {});
  }
}
window.addEventListener('beforeinstallprompt', e => { e.preventDefault(); installa = e; if (pila.length === 1) mostra(); });
// ---------------------------------------------------------------- aggiornamenti dell'app
// A ogni apertura con internet, e ogni volta che si torna all'app, il browser controlla se sul sito c'e'
// una versione nuova; il service worker la scarica e la attiva. Qui compare l'avviso con "Riavvia":
// i dati sono gia' salvati, si riapre la pagina iniziale con la versione nuova.
function avvisoBarra(testo, pulsante, azione, secondi) {
  const vecchio = $('#aggiornamento');
  if (vecchio) vecchio.remove();
  const box = h('div', { id: 'aggiornamento', role: 'status' },
    h('span', {}, testo),
    pulsante ? h('button', { class: 'agg-si', onclick: azione }, pulsante) : null,
    h('button', { class: 'agg-no', 'aria-label': 'Chiudi', onclick: () => box.remove() }, '\u00d7'));
  document.body.append(box);
  if (secondi) setTimeout(() => box.remove(), secondi * 1000);
}
if ('serviceWorker' in navigator) {
  const conVersione = Boolean(navigator.serviceWorker.controller);   // false alla prima installazione
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (conVersione) avvisoBarra('\u00c8 pronta una versione nuova dell\'app. I dati sono gi\u00e0 salvati.', 'Riavvia', () => location.reload());
  });
  navigator.serviceWorker.register('sw.js').then(reg => {
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible') reg.update().catch(() => {});
    });
  }).catch(() => {});
}
avvio();
