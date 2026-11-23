'use strict';
/* Verifiche periodiche - scheda di riepilogo delle verifiche dei serbatoi (pressione):
   una scheda per ditta e per giorno, da stampare o salvare in PDF dal telefono.
   Stessa impostazione del modello Word "Riepilogo verifiche periodiche recipienti gas".
   Se ci sono serbatoi con spessimetria "Da valutare libretto" e rilievi scritti, segue una pagina
   "Rilievi spessimetrici" (allegato), numerata come nella colonna Esito.
   Logo e indirizzi dell'ufficio arrivano con l'elenco di Access (E.intestazione): nel sito dell'app
   non ci sono, cosi' il sito pubblico non sembra quello di un ente. */

// intestazione della scheda dall'elenco di Access: { logo: 'data:image/png;base64,...', dip: [...], serv: [...], piede: [[...], [...]] }
function intestazioneScheda() {
  const x = (E && E.intestazione) || {};
  return { logo: x.logo || '', dip: x.dip || [], serv: x.serv || [], piede: x.piede || [] };
}
const conA_capo = a => a.flatMap((t, i) => (i ? [h('br'), t] : [t]));

function verificheDelGiorno(data) {
  return [...R.values()].filter(r => r.tipo === 'VE' && r.d.data === data)
    .map(r => ({ r, a: apparecchio(r.d.app) }))
    .filter(x => x.a && x.a.fam === 'Pressione');
}

// dati della ditta per l'intestazione (dall'elenco di Access o dalla ditta nuova del telefono)
function datiDitta(ref) {
  if (!ref) return null;
  const idDa = r => (r && r.startsWith('ID:') ? IDX.az.get(Number(r.slice(3))) : null);
  let a = idDa(ref);
  if (!a && ref.startsWith('N:')) {
    const x = R.get(ref.slice(2));
    if (x) { const d = x.d; return { rs: d.rs, ind: d.ind, cap: d.cap, com: d.com, prov: d.prov, piva: d.piva, cf: d.cf, pec: d.pec, sdi: d.sdi }; }
    a = IDX.azMob.get(ref.slice(2));
  }
  return a ? { rs: a.rs, ind: a.ind, cap: a.cap, com: a.comune, prov: a.prov, piva: a.piva, cf: a.cf, pec: a.pec, sdi: a.sdi } : null;
}
const chiaveDitta = ref => { const z = ditta(ref); return z ? z.ref : ref; };

function cellaTesto(righe) { return righe.filter(Boolean).flatMap((t, i) => (i ? [h('br'), t] : [t])); }
function taratura(d) {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(d || '');
  if (!m) return '';
  return m[3] === '01' ? `${m[2]}/${m[1]}` : `${m[3]}/${m[2]}/${m[1]}`;
}
const conUnita = (v, u) => { const t = String(v || '').trim(); return !t ? '' : (numeroOut(t) !== null && t !== '' ? `${t} ${u}` : t); };

VISTE.scheda = async (main, arg) => {
  titolo('Scheda serbatoi');
  const stato = { data: (arg && arg.data) || oggi(), az: arg && arg.az ? chiaveDitta(arg.az) : '' };
  const scelte = h('div', { class: 'no-stampa' });
  const foglio = h('div', { class: 'foglio-box' });
  const disegna = () => {
    const tutte = verificheDelGiorno(stato.data);
    const ditte = new Map();
    for (const x of tutte) { const k = chiaveDitta(x.a.az); if (!ditte.has(k)) ditte.set(k, (ditta(x.a.az) || {}).rs || '?'); }
    if (!ditte.has(stato.az)) stato.az = ditte.size ? [...ditte.keys()][0] : '';
    const data = h('input', { type: 'date', value: stato.data });
    data.addEventListener('change', () => { stato.data = data.value; disegna(); });
    const sel = h('select', {}, [...ditte.entries()].map(([k, t]) => h('option', { value: k }, t)));
    sel.value = stato.az;
    sel.addEventListener('change', () => { stato.az = sel.value; disegna(); });
    const righe = tutte.filter(x => chiaveDitta(x.a.az) === stato.az)
      .sort((p, q) => String(p.a.ubCom || '').localeCompare(String(q.a.ubCom || '')) || String(p.a.mat).localeCompare(String(q.a.mat)));
    scelte.replaceChildren(
      h('p', { class: 'nota' }, 'Verifiche di apparecchi a pressione salvate su questo telefono, per ditta e giorno.'),
      h('div', { class: 'due' }, etichetta('Giorno', data), ditte.size ? etichetta('Ditta', sel) : h('div')),
      righe.length ? h('button', { class: 'btn', onclick: () => window.print() }, 'Stampa o salva in PDF') : null,
      righe.length ? h('p', { class: 'nota' }, 'Nella finestra di stampa scegli "Salva come PDF" per mandarla alla ditta. Orientamento: orizzontale.') : null,
      righe.length && !intestazioneScheda().logo ? h('div', { class: 'avviso' }, 'Logo e indirizzi dell\'ufficio arrivano con l\'elenco di Access: ' +
        'carica un elenco nuovo (Access, Menu > "Elenco per il telefono") per averli nella scheda.') : null);
    foglio.replaceChildren(righe.length ? documentoScheda(stato, righe) : h('p', { class: 'vuoto' }, 'Nessuna verifica di apparecchi a pressione in questo giorno.'));
  };
  main.append(scelte, foglio);
  disegna();
};

function documentoScheda(stato, righe) {
  const z = datiDitta(righe[0].a.az) || {};
  const sede = [z.ind, [z.cap, z.com].filter(Boolean).join(' ') + (z.prov ? ` (${z.prov})` : '')].filter(x => String(x || '').trim()).join(' - ');
  const pivaCf = z.piva && z.cf && z.cf !== z.piva ? `P.I. ${z.piva} / C.F. ${z.cf}` : (z.piva || z.cf || '');
  const conRilievi = r => r.d.sp === SPESS_DA_VALUTARE && r.d.spess && PUNTI_SPESS.some(([k]) => (r.d.spess[k] || []).some(x => numeroOut(x)));
  const allegati = righe.map(x => x.r).filter(conRilievi);
  const esiti = (r) => {
    const t = (et, v) => h('tr', {}, h('td', { class: 'et' }, et), h('td', { class: 'val' }, v || ''));
    const n = allegati.indexOf(r) + 1;
    return h('table', { class: 'esiti' }, t('MESSA A TERRA', r.d.mt),
      t('SPESSIMETRIA', n ? [r.d.sp, h('div', { class: 'rif' }, `rilievi in allegato, n. ${n}`)] : r.d.sp), t('VERNICIATURA', r.d.ve));
  };
  const tipo = d => (d.integ && d.funz ? 'INTEGRITÀ E FUNZIONAMENTO' : d.integ ? 'INTEGRITÀ' : d.funz ? 'FUNZIONAMENTO' : '');
  const negativo = d => { const e = IDX.esiti.get(String(d.esito)); return e && e.breve === 'Negativo'; };
  const corpo = righe.map(({ r, a }) => {
    const d = r.d;
    const valv = d.valvMat === NV ? [NV] : [d.valvMat, d.valvData ? 'tarata il ' + taratura(d.valvData) : '', d.valvBar ? testoNum(d.valvBar) + ' bar' : ''];
    const nf = a.nfabComp || a.nfab || '';
    return h('tr', {},
      h('td', {}, cellaTesto([fmtData(d.data), a.ubCom, a.ubInd, a.ubPresso ? 'c/o ' + a.ubPresso : ''])),
      h('td', { class: 'c' }, cellaTesto([a.mat, nf ? 'N° fabbr. ' + nf : ''])),
      h('td', { class: 'c' }, cellaTesto(valv)),
      h('td', { class: 'c' }, tipo(d), negativo(d) ? h('div', { class: 'nonidoneo' }, 'NON IDONEO') : null),
      h('td', { class: 'c' }, a.litri ? `${Number(a.litri).toLocaleString('it-IT')} l` : ''),
      h('td', { class: 'c' }, conUnita(d.pe, 'bar')),
      h('td', { class: 'c' }, conUnita(d.te, '°C')),
      h('td', { class: 'esito' }, esiti(r)));
  });
  const I = intestazioneScheda();
  const intest = () => h('div', { class: 'intest' },
      I.logo ? h('img', { src: I.logo, alt: '' }) : null,
      I.dip.length ? h('div', { class: 'dip' }, conA_capo(I.dip)) : null,
      I.serv.length ? h('div', { class: 'serv' }, conA_capo(I.serv.slice(0, -1)), I.serv.length > 1 ? h('br') : null,
        h('b', {}, I.serv[I.serv.length - 1])) : null);
  const tabDitta = () => h('table', { class: 'ditta' },
      [['DITTA/RAG.SOCIALE:', z.rs], ['SEDE:', sede], ['P.IVA/C.F:', pivaCf], ['PEC:', z.pec], ['CODICE DESTINATARIO SDI:', z.sdi]]
        .map(([k, v]) => h('tr', {}, h('th', {}, k), h('td', {}, v || ''))));
  const piede = () => (I.piede.length ? h('div', { class: 'piede' },
      I.piede.map(b => h('div', {}, h('b', {}, b[0] || ''), (b.slice(1)).flatMap(t => [h('br'), t])))) : null);
  const fogli = [];
  fogli.push(h('div', { class: 'foglio' }, intest(),
    h('div', { class: 'tit' }, 'RIEPILOGO VERIFICHE PERIODICHE RECIPIENTI GAS'),
    h('div', { class: 'sottotit' }, `Verifiche del ${fmtData(stato.data)}`),
    tabDitta(),
    h('table', { class: 'tab' },
      h('thead', {}, h('tr', {}, ['Data e ubicazione impianto', 'Matricola serbatoio / N° fabbrica', 'Matricola valvola / taratura',
        'Tipo di verifica', 'Capacità serbatoio', 'Pressione esercizio', 'Temperatura esercizio', 'Esito'].map(t => h('th', {}, t)))),
      h('tbody', {}, corpo)),
    h('p', { class: 'nota-doc' }, 'NON IDONEO: esito negativo della verifica; i motivi sono indicati nel verbale definitivo.' +
      (allegati.length ? ' Per i serbatoi con spessimetria "Da valutare libretto" i rilievi sono riportati in allegato.' : '')),
    piede()));
  if (allegati.length) {
    const num = x => mmTesto(parseFloat(numeroOut(x)));
    fogli.push(h('div', { class: 'foglio nuova-pagina' }, intest(),
      h('div', { class: 'tit' }, 'RILIEVI SPESSIMETRICI'),
      h('div', { class: 'sottotit' }, `Allegato al riepilogo delle verifiche del ${fmtData(stato.data)}`),
      tabDitta(),
      h('p', { class: 'spieg' }, 'Spessori rilevati in millimetri (da 1 a 10 rilievi per punto di misura), da confrontare con gli spessori indicati nel libretto del recipiente.'),
      allegati.map((r, i) => {
        const a = righe.find(x => x.r === r).a;
        const nf = a.nfabComp || a.nfab || '';
        const luogo = [a.ubCom, a.ubInd].filter(Boolean).join(', ') + (a.ubPresso ? ` (c/o ${a.ubPresso})` : '');
        return h('div', { class: 'serb' },
          h('div', { class: 'serb-tit' }, h('span', { class: 'num' }, String(i + 1)), h('b', {}, `Serbatoio matricola ${a.mat}`),
            [nf ? `– N° fabbrica ${nf}` : '', a.litri ? `– capacità ${Number(a.litri).toLocaleString('it-IT')} l` : '', luogo ? `– ${luogo}` : ''].filter(Boolean).join(' ')),
          h('table', { class: 'spess' },
            h('thead', {},
              h('tr', {}, h('th', { class: 'punto', rowspan: '2' }, 'Punto di misura'), h('th', { colspan: '10' }, 'Spessori rilevati (mm)'),
                h('th', { class: 'n min', rowspan: '2' }, 'Minimo (mm)'), h('th', { class: 'n', rowspan: '2' }, 'N. rilievi')),
              h('tr', {}, Array.from({ length: 10 }, (_, j) => h('th', { class: 'n' }, String(j + 1))))),
            h('tbody', {}, PUNTI_SPESS.map(([k, nome]) => {
              const v = (r.d.spess[k] || []).filter(x => numeroOut(x));
              const m = minimoSpess(v);
              return h('tr', {}, h('th', { class: 'punto' }, nome),
                Array.from({ length: 10 }, (_, j) => h('td', { class: 'n' }, v[j] ? num(v[j]) : '')),
                h('td', { class: 'n min' }, m !== null ? h('b', {}, mmTesto(m)) : ''), h('td', { class: 'n' }, v.length ? String(v.length) : ''));
            }))));
      }),
      piede()));
  }
  return h('div', {}, fogli);
}
