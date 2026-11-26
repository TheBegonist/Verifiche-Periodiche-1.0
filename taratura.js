/* Verifiche periodiche: taratura al banco delle valvole di sicurezza.
   Un intervento (record "TA") ha ditta, data, impianto, tecnici, ore di lavoro, addebito e l'elenco delle valvole.
   Per ogni valvola l'app calcola i limiti della UNI EN ISO 4126-1:2019 (EN ISO 4126-1:2013 + A1:2016, punto 7.2). */
'use strict';

const ADDEBITI = [
  { v: 'tecnico', t: 'Ore × tecnici', lungo: 'Ore di lavoro per ogni tecnico' },
  { v: 'ore', t: 'Solo ore di lavoro', lungo: 'Ore di lavoro' },
];
const ESITI_VALVOLA = ['Tarata', 'Non tarabile'];

// ---------------------------------------------------------------- limiti UNI EN ISO 4126-1
const cent = x => Math.round(x * 100 + 1e-6) / 100;
const bar = x => cent(x).toLocaleString('it-IT', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const perc = x => x.toLocaleString('it-IT', { maximumFractionDigits: 1 });

// p = pressione di taratura (bar); fluido 'gas' (comprimibile, predefinito) o 'liquido' (incomprimibile)
function limiti4126(p, fluido) {
  if (!(p > 0)) return null;
  const liquido = fluido === 'liquido';
  const tol = Math.max(0.03 * p, 0.1);                                  // a) pressione di taratura: ±3% o ±0,1 bar
  const scPerc = liquido ? [2.5, 20] : [2, 15];                          // d) scarto di chiusura min/max in %
  const scBar = liquido ? 0.6 : 0.3;                                     //    ... o in bar, se maggiore
  const scMax = Math.max(scPerc[1] / 100 * p, scBar);
  const sovra = Math.max(0.10 * p, 0.1);                                 // b) sovrapressione: 10% o 0,1 bar
  return {
    p, liquido, tol, tolMinima: tol > 0.03 * p + 1e-9,
    aMin: p - tol, aMax: p + tol,
    cMin: Math.max(0, p - scMax), cMax: p - scPerc[0] / 100 * p, scPerc, scBar, scInBar: scMax > scPerc[1] / 100 * p + 1e-9,
    sMax: p + sovra, sovraInBar: sovra > 0.10 * p + 1e-9,
  };
}
// apertura rilevata al banco rispetto ai limiti: null se non c'e', altrimenti { ok, scarto }
function controlloApertura(v) {
  const l = limiti4126(numero(v.bar), v.fluido);
  if (!l || numeroOut(v.apert) === '' || numeroOut(v.apert) === null) return null;
  const a = numero(v.apert), min = cent(l.aMin), max = cent(l.aMax);
  if (a < min - 1e-9) return { ok: false, scarto: `${bar(min - a)} bar sotto il minimo` };
  if (a > max + 1e-9) return { ok: false, scarto: `${bar(a - max)} bar sopra il massimo` };
  return { ok: true };
}
function testoApertura(v) {
  const l = limiti4126(numero(v.bar), v.fluido);
  if (!l) return '';
  const c = controlloApertura(v);
  if (!c) return `apertura ${bar(l.aMin)}–${bar(l.aMax)} bar`;
  return `rilevata ${bar(numero(v.apert))} ${c.ok ? '✓' : '✗ fuori dai limiti'}`;
}

// riquadro dei limiti: si aggiorna mentre si scrive la pressione
function riquadro4126(v, salva, op) {
  const box = h('div', { class: 'iso' });
  const testa = h('div'), giudizio = h('div'), resto = h('div');
  const apertura = campoTesto(v, 'apert', salva, { num: true, ph: 'Es. 17,70', ...op });
  apertura.setAttribute('aria-label', 'Apertura rilevata al banco');
  const rigaAp = h('div', { class: 'iso-ap' }, h('label', { class: 'campo' }, 'Apertura rilevata al banco (bar)', apertura), giudizio);
  box.append(testa, rigaAp, resto);
  const disegna = () => {
    const l = limiti4126(numero(v.bar), v.fluido);
    const fluido = h('div', { class: 'scelte iso-fluido' },
      ...[['gas', 'Gas o vapore'], ['liquido', 'Liquido']].map(([k, t]) => h('button', {
        type: 'button', class: (v.fluido || 'gas') === k ? 'on' : '', disabled: op.disabled,
        onclick: () => { v.fluido = k; disegna(); salva(); } }, t)));
    rigaAp.hidden = !l;
    if (!l) {
      testa.replaceChildren(h('div', { class: 'iso-tit' }, 'Limiti UNI EN ISO 4126-1'),
        h('p', { class: 'nota' }, 'Scrivi la pressione di taratura: qui compaiono i limiti di apertura e di richiusura.'));
      resto.replaceChildren();
      return;
    }
    testa.replaceChildren(
      h('div', { class: 'iso-tit' }, `Limiti UNI EN ISO 4126-1 per ${bar(l.p)} bar`),
      h('div', { class: 'iso-et' }, 'Pressione di inizio apertura'),
      h('div', { class: 'iso-val' }, `${bar(l.aMin)} – ${bar(l.aMax)}`, h('span', {}, ' bar')),
      h('div', { class: 'iso-sotto' }, l.tolMinima
        ? `tolleranza minima ±0,10 bar (il 3% sarebbe solo ${bar(0.03 * l.p)} bar)`
        : `tolleranza ±3% = ±${bar(l.tol)} bar`));
    const c = controlloApertura(v);
    giudizio.replaceChildren(numeroOut(v.apert) === null ? h('div', { class: 'iso-ko' }, 'Non è un numero')
      : !c ? h('div', { class: 'iso-vuoto' }, 'Scrivila: l\'app controlla se è nei limiti')
      : c.ok ? h('div', { class: 'iso-ok' }, '✓ Nei limiti')
      : h('div', { class: 'iso-ko' }, '✗ Fuori: ', c.scarto));
    resto.replaceChildren(
      h('div', { class: 'iso-riga' },
        h('div', {}, h('div', { class: 'iso-et' }, 'Richiusura'), h('b', {}, `${bar(l.cMin)} – ${bar(l.cMax)} bar`),
          h('div', { class: 'iso-sotto' }, `scarto di chiusura ${perc(l.scPerc[0])}% – ${l.scInBar ? bar(l.scBar) + ' bar' : perc(l.scPerc[1]) + '%'}`)),
        h('div', {}, h('div', { class: 'iso-et' }, 'Alzata piena entro'), h('b', {}, `${bar(l.sMax)} bar`),
          h('div', { class: 'iso-sotto' }, `sovrapressione ${l.sovraInBar ? '0,10 bar' : '10%'}`))),
      h('div', { class: 'iso-et', style: 'margin-top:8px' }, 'Fluido di prova (cambia solo la richiusura)'), fluido);
  };
  disegna();
  return { box, disegna };
}

// ---------------------------------------------------------------- record
function nuovaValvola(prec) {
  return { sigla: '', costr: prec ? prec.costr : '', mat: '', tipo: prec ? prec.tipo : '', orif: prec ? prec.orif : '',
           bar: prec ? prec.bar : '', apert: '', soff: prec ? prec.soff : 'no', fluido: prec ? prec.fluido || 'gas' : 'gas',
           esito: 'Tarata', app: null, note: '' };
}
async function nuovaTaratura() {
  const r = await nuovoRecord('TA', { az: null, data: oggi(), impianto: '', comune: '', addebito: 'tecnico', ore: '', note: '',
    tecnici: IMP.operatore && IDX.op.has(String(IMP.operatore)) ? [String(IMP.operatore)] : [], valvole: [] });
  vai('taratura', r.uuid);
}
function oreDaAddebitare(d) {
  const ore = numero(d.ore);
  if (!(ore > 0)) return null;
  const n = Math.max(1, (d.tecnici || []).length);
  return d.addebito === 'ore' ? { ore, testo: `${testoNum(ore)} ${ore === 1 ? 'ora' : 'ore'} di lavoro` }
    : { ore: ore * n, testo: `${testoNum(ore)} ${ore === 1 ? 'ora' : 'ore'} × ${n} ${n === 1 ? 'tecnico' : 'tecnici'}` };
}
function erroriValvola(v) {
  const e = [];
  if (!String(v.sigla || '').trim()) e.push('la sigla');
  if (!String(v.mat || '').trim()) e.push('la matricola');
  if (!(numero(v.bar) > 0)) e.push('la pressione di taratura');
  for (const k of ['orif', 'bar', 'apert']) if (numeroOut(v[k]) === null) { e.push('un numero non valido'); break; }
  if (!v.esito) e.push('l\'esito');
  const c = controlloApertura(v);
  if (c && !c.ok && v.esito === 'Tarata') e.push('apertura rilevata fuori dai limiti con esito "Tarata"');
  return e;
}
function erroriTaratura(r) {
  const d = r.d, e = [];
  if (!d.az) e.push('la ditta');
  else if (d.az.startsWith('N:')) {
    const z = R.get(d.az.slice(2));
    if (z && erroriDitta(z).length) e.push('i dati della ditta nuova');
  }
  if (!d.data) e.push('la data');
  if (!(d.tecnici || []).length) e.push('almeno un tecnico');
  if (!(numero(d.ore) > 0)) e.push('le ore di lavoro');
  if (!(d.valvole || []).length) e.push('almeno una valvola');
  (d.valvole || []).forEach((v, i) => { const x = erroriValvola(v); if (x.length) e.push(`valvola ${i + 1}: ${x.join(', ')}`); });
  return e;
}
function descriviTaratura(r) {
  const z = ditta(r.d.az);
  const n = (r.d.valvole || []).length;
  return { titolo: `Taratura valvole – ${z ? z.rs : 'ditta da scegliere'}`,
           sotto: `${fmtData(r.d.data)} · ${n} ${n === 1 ? 'valvola' : 'valvole'}${r.d.impianto ? ' · ' + r.d.impianto : ''}` };
}

// apparecchi a pressione (solo matricola), per l'apparecchio protetto dalla valvola
function apparecchiPressione() {
  const l = (E.apparecchi || []).filter(a => a.fam === 'Pressione').map(a => ({ ref: 'ID:' + a.id, mat: a.mat }));
  for (const x of R.values()) if (x.tipo === 'AP' && x.d.fam === 'Pressione' && x.stato !== 'importata') l.push({ ref: 'N:' + x.uuid, mat: x.d.mat || '' });
  return l.sort((a, b) => String(a.mat).localeCompare(String(b.mat)));
}
const matricolaDi = ref => { const a = ref ? apparecchio(ref) : null; return a ? a.mat : ''; };

// ---------------------------------------------------------------- vista: intervento di taratura
VISTE.taratura = async (main, uuid) => {
  const r = R.get(uuid);
  if (!r) { titolo('Taratura'); main.append(h('p', { class: 'vuoto' }, 'Taratura non trovata.')); return; }
  const d = r.d;
  titolo('Taratura valvole');
  const blocca = bloccato(r);
  const op = blocca ? { disabled: true } : {};
  const mancanze = riquadroMancanze(r);
  const calcolo = h('div', { class: 'info' });
  const aggiornaOre = () => {
    const o = oreDaAddebitare(d);
    calcolo.replaceChildren(o
      ? h('div', {}, 'Si addebitano ', h('b', {}, `${testoNum(o.ore)} ore`), ` (${o.testo}).`)
      : h('div', {}, 'Scrivi le ore di lavoro, compresi i trasferimenti.'),
      h('div', { class: 'nota' }, 'Nel riepilogo per la ditta compare solo l\'importo, non il calcolo.'));
  };
  const { salva, segno } = salvataggio(r, () => { mancanze.aggiorna(); aggiornaOre(); });
  const z = ditta(d.az);

  main.append(
    h('div', { class: 'info' }, h('b', {}, 'Taratura al banco'), chipStato(r)),
    h('h2', {}, 'Intervento'),
    etichetta('Ditta', h('button', { class: 'voce', disabled: blocca, onclick: () => vai('sceltaDitta', r.uuid) },
      h('b', {}, z ? z.rs : 'Scegli la ditta', z && z.nuova ? h('span', { class: 'chip nuova' }, 'nuova') : null),
      h('small', {}, z ? [z.piva || z.cf, z.comune].filter(Boolean).join(' · ') : 'Tocca per cercarla nell\'elenco'))),
    z && z.nuova && !blocca ? h('button', { class: 'btn secondario', onclick: () => vai('ditta', { uuid: z.rec.uuid }) }, 'Modifica la ditta nuova') : null,
    h('div', { class: 'due' },
      etichetta('Data', campoTesto(d, 'data', salva, { tipo: 'date', ...op })),
      etichetta('Comune', campoTesto(d, 'comune', salva, op))),
    etichetta('Impianto', campoTesto(d, 'impianto', salva, { ph: 'Es. impianto GNL, deposito GPL…', ...op })));

  main.append(h('h2', {}, 'Tecnici'));
  for (const o of E.operatori || []) {
    const c = h('input', { type: 'checkbox', checked: (d.tecnici || []).includes(String(o.id)), disabled: blocca });
    c.addEventListener('change', () => {
      const s = new Set(d.tecnici || []);
      if (c.checked) s.add(String(o.id)); else s.delete(String(o.id));
      d.tecnici = [...s];
      salva();
    });
    main.append(h('label', { class: 'spunta' }, c, o.nome));
  }

  const addebito = h('div', { class: 'scelte' });
  const disegnaAddebito = () => addebito.replaceChildren(...ADDEBITI.map(a => h('button', {
    type: 'button', class: (d.addebito || 'tecnico') === a.v ? 'on' : '', disabled: blocca,
    onclick: () => { d.addebito = a.v; disegnaAddebito(); salva(); } }, a.t)));
  disegnaAddebito();
  aggiornaOre();
  main.append(h('h2', {}, 'Ore e addebito'),
    h('div', { class: 'due' }, etichetta('Ore di lavoro', campoTesto(d, 'ore', salva, { num: true, ph: 'Es. 2,5', ...op })), h('div')),
    etichetta('Addebito', addebito), calcolo);

  // valvole
  const vv = d.valvole || (d.valvole = []);
  main.append(h('h2', {}, `Valvole (${vv.length})`));
  if (!vv.length) main.append(h('p', { class: 'vuoto' }, 'Nessuna valvola: aggiungi la prima.'));
  vv.forEach((v, i) => {
    const err = erroriValvola(v);
    main.append(h('button', { class: 'voce', onclick: () => vai('valvola', { uuid: r.uuid, i }) },
      h('b', {}, `${i + 1}. ${v.sigla || '(senza sigla)'}`,
        h('span', { class: 'chip ' + (err.length ? 'bozza' : v.esito === 'Tarata' ? 'pronta' : 'importata') }, err.length ? 'da completare' : v.esito)),
      h('small', {}, [v.mat, numero(v.bar) > 0 ? bar(numero(v.bar)) + ' bar' : '', testoApertura(v)].filter(Boolean).join(' · '))));
  });
  if (!blocca) {
    main.append(h('div', { class: 'riga-btn' },
      h('button', { class: 'btn secondario', onclick: async () => { vv.push(nuovaValvola()); await salvaRecord(r); vai('valvola', { uuid: r.uuid, i: vv.length - 1 }); } }, 'Aggiungi valvola'),
      vv.length ? h('button', { class: 'btn secondario', onclick: async () => {
        vv.push(nuovaValvola(vv[vv.length - 1])); await salvaRecord(r); vai('valvola', { uuid: r.uuid, i: vv.length - 1 });
      } }, 'Copia l\'ultima') : null),
      vv.length ? h('p', { class: 'nota' }, '"Copia l\'ultima" ripete costruttore, tipo, orifizio, pressione e soffietto: cambi solo sigla e matricola.') : null);
  }

  main.append(
    h('h2', {}, 'Note'),
    etichetta('Note interne', campoTesto(d, 'note', salva, { area: true, ...op })),
    h('h2', {}, 'Stato'), mancanze.box, segno,
    blocca ? null : h('button', { class: 'btn pericolo', onclick: async () => {
      if (await conferma('Eliminare la taratura?', 'L\'intervento e le sue valvole vengono cancellati dal telefono.', 'Elimina', 'No', true)) {
        await eliminaRecord(r); torna('home');
      } } }, 'Elimina questa taratura'));
  if (!blocca) {
    barra(r.stato === 'pronta'
      ? h('button', { class: 'btn secondario', onclick: async () => { r.stato = 'bozza'; await salvaRecord(r); mostra(true); } }, 'Rimetti in bozza')
      : h('button', { class: 'btn verde', onclick: async () => { if (await segnaPronta(r)) torna('home'); } }, 'Pronta da inviare'));
  }
};

// ---------------------------------------------------------------- vista: una valvola
VISTE.valvola = async (main, arg) => {
  const r = R.get(arg.uuid);
  const v = r && (r.d.valvole || [])[arg.i];
  if (!v) { titolo('Valvola'); main.append(h('p', { class: 'vuoto' }, 'Valvola non trovata.')); return; }
  titolo(`Valvola ${arg.i + 1}`);
  const blocca = bloccato(r);
  const op = blocca ? { disabled: true } : {};
  const iso = riquadro4126(v, () => salva(), op);
  const { salva, segno } = salvataggio(r, () => iso.disegna());
  const pressione = campoTesto(v, 'bar', salva, { num: true, ph: 'Es. 17,65', ...op });
  const orifizio = campoTesto(v, 'orif', salva, { num: true, ph: 'Es. 21,50', ...op });

  // apparecchio protetto: facoltativo, si cerca solo per matricola
  const app = h('div');
  const disegnaApp = () => {
    if (v.app) {
      app.replaceChildren(h('div', { class: 'scheda iso-app' }, h('div', {}, h('small', { class: 'nota' }, 'Matricola'), h('b', {}, matricolaDi(v.app) || '?')),
        blocca ? null : h('button', { type: 'button', class: 'btn pericolo', onclick: () => { v.app = null; disegnaApp(); salva(); } }, 'Togli')));
      return;
    }
    const cerca = h('input', { type: 'search', placeholder: 'Matricola…', autocomplete: 'off', disabled: blocca });
    const lista = h('div');
    const tutti = apparecchiPressione();
    cerca.addEventListener('input', () => {
      const q = norm(cerca.value);
      const t = q.length < 2 ? [] : tutti.filter(a => norm(a.mat).includes(q));
      lista.replaceChildren(...t.slice(0, 8).map(a => h('button', { type: 'button', class: 'voce', onclick: () => { v.app = a.ref; disegnaApp(); salva(); } },
        h('b', {}, a.mat))), q.length >= 2 && !t.length ? h('p', { class: 'nota' }, 'Nessuna matricola trovata: lascia vuoto.') : null);
    });
    app.replaceChildren(cerca, lista);
  };
  disegnaApp();

  const esito = h('div', { class: 'scelte' });
  const disegnaEsito = () => esito.replaceChildren(...ESITI_VALVOLA.map(t => h('button', {
    type: 'button', class: v.esito === t ? 'on' : '', disabled: blocca, onclick: () => { v.esito = t; disegnaEsito(); salva(); } }, t)));
  disegnaEsito();

  main.append(
    etichetta('Sigla di identificazione', campoTesto(v, 'sigla', salva, { maiuscole: true, ph: 'Es. VAPORIZZATORE 2', ...op })),
    h('div', { class: 'due' },
      etichetta('Costruttore', campoTesto(v, 'costr', salva, { maiuscole: true, ...op })),
      etichetta('Matricola', campoTesto(v, 'mat', salva, { maiuscole: true, ...op }))),
    h('div', { class: 'due' },
      etichetta('Tipo', campoTesto(v, 'tipo', salva, { maiuscole: true, ...op })),
      etichetta('Orifizio (mm)', orifizio)),
    h('div', { class: 'due' },
      etichetta('Pressione di taratura (bar)', pressione),
      etichetta('Soffietto', campoScelta(v, 'soff', [{ v: 'sì', t: 'sì' }, { v: 'no', t: 'no' }], salva, { vuota: false, ...op }))),
    iso.box,
    etichetta('Esito', esito),
    etichetta('Apparecchio protetto (facoltativo)', app),
    etichetta('Note', campoTesto(v, 'note', salva, { ph: 'Es. da sostituire', ...op })),
    segno,
    blocca ? null : h('button', { class: 'btn pericolo', onclick: async () => {
      if (await conferma('Togliere la valvola?', `La valvola ${arg.i + 1} viene tolta dalla taratura.`, 'Togli', 'No', true)) {
        r.d.valvole.splice(arg.i, 1); await salvaRecord(r); indietro();
      } } }, 'Togli questa valvola'));
  if (!blocca) barra(h('button', { class: 'btn', onclick: () => indietro() }, 'Fatto'));
};

// ---------------------------------------------------------------- file per Access
CAMPI.TA = ['uuid', 'Azienda', 'DataTaratura', 'Impianto', 'UbicazioneComune', 'OreLavoro', 'Addebito', 'Tecnici', 'Note', 'Telefono'];
CAMPI.TV = ['Taratura', 'Ordine', 'Sigla', 'Costruttore', 'Matricola', 'Tipo', 'OrifizioMm', 'PressioneBar', 'AperturaBar',
            'Soffietto', 'Esito', 'Apparecchio', 'Note', 'Fluido'];
function righeTaratura(t) {
  const d = t.d;
  const L = [riga('TA', [t.uuid, d.az || '', d.data, d.impianto, d.comune, n(d.ore), d.addebito === 'ore' ? 'ore' : 'tecnico',
    (d.tecnici || []).join(','), d.note, IMP.telefono || ''])];
  (d.valvole || []).forEach((v, i) => L.push(riga('TV', [t.uuid, String(i + 1), String(v.sigla || '').trim(), v.costr,
    String(v.mat || '').trim(), v.tipo, n(v.orif), n(v.bar), n(v.apert), v.soff, v.esito, v.app || '', v.note, v.fluido || 'gas'])));
  return L;
}
