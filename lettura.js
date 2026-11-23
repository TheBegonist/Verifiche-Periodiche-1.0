'use strict';
/* Verifiche periodiche - lettura dei documenti con la fotocamera.
   Sul telefono (senza rete): Tesseract, file nella cartella "ocr".
   Online (se attivata nelle impostazioni): Claude legge le foto e restituisce i dati.
   In tutti e due i casi i dati si controllano prima di usarli. */

let LET = null;   // lettura in corso: { ctx, fam, pagine: [{blob, url}], P, stato }

const assoluto = p => new URL(p, location.href).href;
function caricaScript(src) {
  return new Promise((ok, ko) => {
    if (window.Tesseract) { ok(); return; }
    const s = document.createElement('script');
    s.src = src;
    s.onload = () => ok();
    s.onerror = () => ko(new Error('non riesco a caricare ' + src));
    document.head.append(s);
  });
}
async function creaLettore(progresso) {
  await caricaScript('ocr/tesseract.min.js');
  return Tesseract.createWorker('ita', 1, {
    workerPath: assoluto('ocr/worker.min.js'),
    corePath: assoluto('ocr/'),
    langPath: assoluto('ocr/lang'),
    workerBlobURL: false,
    gzip: true,
    logger: m => { if (progresso) progresso(m); },
  });
}

// Scarica (una volta) quello che serve per leggere senza rete
async function preparaLettura(forza) {
  if (IMP.ocrPronto && !forza) return true;
  if (!navigator.onLine) return false;
  try {
    const w = await creaLettore();
    await w.terminate();
    IMP.ocrPronto = true;
    await metti('impostazioni', IMP, 'imp');
    return true;
  } catch (e) {
    return false;
  }
}
setTimeout(() => { if (db && !IMP.ocrPronto && navigator.onLine) preparaLettura(); }, 6000);

async function ridimensiona(blob, max, qualita) {
  try {
    const bmp = await createImageBitmap(blob, { imageOrientation: 'from-image' });
    const k = Math.min(1, max / Math.max(bmp.width, bmp.height));
    const c = document.createElement('canvas');
    c.width = Math.round(bmp.width * k);
    c.height = Math.round(bmp.height * k);
    c.getContext('2d').drawImage(bmp, 0, 0, c.width, c.height);
    return (await new Promise(ok => c.toBlob(ok, 'image/jpeg', qualita))) || blob;
  } catch (e) {
    return blob;
  }
}

// ---------------------------------------------------------------- campi proposti
// [percorso, etichetta, famiglie (vuoto = tutte), contesti, tipo]
const CAMPI_LETTURA = [
  ['app.mat', 'Matricola', '', 'nuovo apparecchio'],
  ['app.tipologia', 'Tipologia (come scritta nel documento)', 'Sollevamento', 'nuovo apparecchio'],
  ['app.tipoOgg', 'Tipo (Attrezzatura / Insieme)', 'Pressione', 'nuovo apparecchio'],
  ['app.uso', 'Descrizione d\'uso', 'Pressione', 'nuovo apparecchio'],
  ['app.ubTipo', 'Installato nel', 'Riscaldamento', 'nuovo apparecchio'],
  ['app.nfab', 'N. di fabbrica', 'Sollevamento', 'nuovo apparecchio'],
  ['app.costr', 'Costruttore', 'Sollevamento', 'nuovo apparecchio'],
  ['app.mod', 'Modello', 'Sollevamento', 'nuovo apparecchio'],
  ['app.portata', 'Portata (kg)', 'Sollevamento', 'nuovo apparecchio'],
  ['app.targa', 'Targa', 'Sollevamento', 'nuovo apparecchio'],
  ['app.anno', 'Anno', '', 'nuovo apparecchio'],
  ['app.ubCom', 'Ubicazione: comune', '', 'nuovo apparecchio'],
  ['app.ubProv', 'Ubicazione: provincia', '', 'nuovo apparecchio'],
  ['app.ubInd', 'Ubicazione: indirizzo', '', 'nuovo apparecchio'],
  ['app.ubPresso', 'Presso', '', 'nuovo apparecchio'],
  ['app.scadINAIL', 'Scadenza indicata dall\'INAIL (aaaa-mm-gg)', '', 'nuovo apparecchio'],
  ['app.scadIndagine', 'Indagine supplementare entro (aaaa-mm-gg)', 'Sollevamento', 'nuovo apparecchio verifica'],
  ['prec.datiTecnici', 'Dati tecnici (dal verbale precedente)', 'Sollevamento', 'nuovo apparecchio verifica'],
  ['ditta.rs', 'Ditta: ragione sociale', '', 'nuovo apparecchio'],
  ['ditta.piva', 'Ditta: partita IVA', '', 'nuovo apparecchio'],
  ['ditta.cf', 'Ditta: codice fiscale', '', 'nuovo apparecchio'],
  ['ditta.sdi', 'Ditta: codice SDI', '', 'nuovo apparecchio'],
  ['ditta.ind', 'Ditta: indirizzo', '', 'nuovo apparecchio'],
  ['ditta.cap', 'Ditta: CAP', '', 'nuovo apparecchio'],
  ['ditta.com', 'Ditta: comune', '', 'nuovo apparecchio'],
  ['ditta.prov', 'Ditta: provincia', '', 'nuovo apparecchio'],
  ['ditta.pec', 'Ditta: PEC', '', 'nuovo apparecchio'],
  ['valv.mat', 'Valvola di sicurezza: matricola', 'Pressione', 'nuovo apparecchio verifica'],
  ['valv.data', 'Valvola: tarata il (aaaa-mm-gg)', 'Pressione', 'nuovo apparecchio verifica'],
  ['valv.bar', 'Valvola: pressione di taratura (bar)', 'Pressione', 'nuovo apparecchio verifica'],
  ['prec.data', 'Verifica precedente: data', '', 'nuovo apparecchio'],
  ['prec.prossima', 'Verifica precedente: scadenza indicata', '', 'nuovo apparecchio'],
  ['prec.numero', 'Verifica precedente: n. verbale', '', 'nuovo apparecchio'],
  ['prec.ente', 'Verifica precedente: ente', '', 'nuovo apparecchio'],
];
const ELENCHI_LETTURA = {
  gen: { titolo: 'Generatori', uno: 'Generatore', fam: 'Riscaldamento', campi: [['num', 'Numero'], ['kw', 'Potenza (kW)'], ['tipo', 'Tipo (lettera)'], ['comb', 'Combustibile (codice)'], ['costr', 'Costruttore'], ['nfab', 'N. di fabbrica'], ['bar', 'Pressione (bar)']] },
  vasi: { titolo: 'Vasi di espansione', uno: 'Vaso', fam: 'Riscaldamento', campi: [['num', 'Numero'], ['litri', 'Litri'], ['nfab', 'N. fabbrica']] },
  disp: { titolo: 'Dispositivi di sicurezza', uno: 'Dispositivo', fam: 'Riscaldamento', campi: [['tipo', 'Tipo'], ['num', 'Numero'], ['bar', 'Taratura (bar)']] },
  comp: { titolo: 'Dati del recipiente', uno: 'Componente', fam: 'Pressione', campi: [['tipo', 'Tipo (codice)'], ['fabbr', 'Fabbricante'], ['nfab', 'N. di fabbrica'], ['attr', 'Attr./Cam.'], ['gruppo', 'Gruppo fluido'], ['cat', 'Categoria'], ['litri', 'Capacità (litri)'], ['ps', 'PS (bar)'], ['pe', 'P esercizio (bar)'], ['tsmin', 'TS min'], ['tsmax', 'TS max'], ['te', 'T esercizio']] },
};
const leggiCampo = (P, p) => p.split('.').reduce((o, k) => (o ? o[k] : ''), P) ?? '';
function scriviCampo(P, p, v) { const [a, b] = p.split('.'); P[a][b] = v; }
function campiPer(ctx, fam) {
  return CAMPI_LETTURA.filter(c => (!c[2] || c[2] === fam) && c[3].split(' ').includes(ctx.tipo));
}
function elenchiPer(ctx, fam) {
  return Object.entries(ELENCHI_LETTURA).filter(([k, v]) => v.fam === fam && (ctx.tipo !== 'verifica' || k === 'disp'));
}

// Voce dell'elenco delle tipologie piu' simile al testo letto ('' se nessuna)
const VUOTE = new Set(['di', 'da', 'del', 'della', 'delle', 'dei', 'per', 'con', 'su', 'a', 'e', 'il', 'la', 'le', 'lo', 'gli', 'in', 'ad', 'tipo']);
const parole = t => String(t || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').split(/[^a-z0-9]+/)
  .filter(w => w.length > 1 && !VUOTE.has(w)).map(w => w.replace(/(i|e|o|a)$/, ''));
function tipologiaSimile(testo) {
  const p = new Set(parole(testo));
  if (!p.size || !E) return '';
  let meglio = '', punti = 0;
  for (const t of E.tipologie || []) {
    const q = parole(t.descr);
    if (!q.length) continue;
    const comuni = q.filter(w => p.has(w)).length;
    const v = comuni / Math.min(q.length, p.size) + comuni / Math.max(q.length, p.size) / 10;
    if (v > punti) { punti = v; meglio = String(t.id); }
  }
  return punti >= 0.5 ? meglio : '';
}

// ---------------------------------------------------------------- lettura sul telefono
async function leggiSulTelefono(avanza) {
  let w;
  try {
    w = await creaLettore(m => {
      if (m.status === 'recognizing text') avanza(`Leggo… ${Math.round((m.progress || 0) * 100)}%`);
      else if (/load|initializ/.test(m.status || '')) avanza('Preparo la lettura…');
    });
  } catch (e) {
    throw new Error(navigator.onLine ? 'Non riesco ad avviare la lettura.' :
      'La lettura senza rete non è ancora pronta: apri l\'app una volta con internet (Impostazioni > Prepara la lettura).');
  }
  const testi = [];
  try {
    for (let i = 0; i < LET.pagine.length; i++) {
      avanza(`Pagina ${i + 1} di ${LET.pagine.length}…`);
      const img = await ridimensiona(LET.pagine[i].blob, 2400, 0.9);
      const r = await w.recognize(img);
      testi.push(r.data.text || '');
    }
  } finally {
    await w.terminate();
  }
  if (!IMP.ocrPronto) { IMP.ocrPronto = true; metti('impostazioni', IMP, 'imp'); }
  const P = estraiDati(testi.join('\n'), LET.fam);
  P.app.idTip = tipologiaSimile(P.app.tipologia);
  return P;
}

// ---------------------------------------------------------------- lettura online (Claude)
const S = { type: 'string' };
const ogg = props => ({ type: 'object', additionalProperties: false, required: Object.keys(props), properties: props });
const lista = props => ({ type: 'array', items: ogg(props) });
const SCHEMA_LETTURA = ogg({
  tipo_documento: S,
  famiglia: S,
  luogo_di_lavoro: S,
  ditta: ogg({ ragione_sociale: S, partita_iva: S, codice_fiscale: S, codice_sdi: S, indirizzo: S, cap: S, comune: S, provincia: S, pec: S }),
  apparecchio: ogg({ matricola: S, numero_fabbrica: S, costruttore: S, modello: S, anno: S, installato_nel: S,
    ubicazione_comune: S, ubicazione_provincia: S, ubicazione_indirizzo: S, presso: S, tipo_oggetto: S, descrizione_uso: S,
    portata_kg: S, targa: S, tipologia: S, scadenza_indagine_supplementare: S }),
  generatori: lista({ numero: S, tipo: S, costruttore: S, numero_fabbrica: S, pressione_bar: S, combustibile: S, potenza_kw: S }),
  vasi: lista({ numero: S, capacita_litri: S, numero_fabbrica: S }),
  dispositivi: lista({ tipo: S, numero: S, taratura_bar: S }),
  componenti: lista({ tipo: S, fabbricante: S, numero_fabbrica: S, attr_cam: S, gruppo_fluido: S, categoria: S,
    capacita_litri: S, ps_bar: S, p_esercizio_bar: S, ts_min: S, ts_max: S, t_esercizio: S }),
  valvola: ogg({ matricola: S, data_taratura: S, taratura_bar: S }),
  verifica_precedente: ogg({ data: S, prossima_verifica: S, numero_verbale: S, ente: S, dati_tecnici: S }),
  note: S,
});
function promptLettura(fam) {
  const leg = (l, f) => (l || []).map(f).join('; ');
  return [
    'Sei di supporto ai verificatori della ASL di Sassari (S.C. SPreSAL), che fanno le verifiche periodiche di apparecchi di sollevamento, impianti di riscaldamento e attrezzature/insiemi a pressione.',
    'Le immagini sono le pagine di un documento fotografato con il telefono: un verbale di verifica precedente (della ASL, dell\'INAIL o di un altro ente), un libretto, una targhetta o un certificato di taratura.',
    `L'apparecchio da verificare è della famiglia: ${fam || 'non indicata'}.`,
    'Estrai i dati scritti nel documento e compila lo schema. Regole:',
    '- Scrivi solo quello che si legge nel documento; se un dato non c\'è o non si legge, stringa vuota. Non inventare.',
    '- Date nel formato AAAA-MM-GG; se c\'è solo mese e anno usa il giorno 01.',
    '- Numeri con il punto come separatore decimale, senza unità di misura.',
    '- "matricola": il numero di identificazione assegnato da INAIL/ISPESL/ASL (es. 2015/400010/SS, SS 1234/05), non il numero di fabbrica del costruttore.',
    '- "ditta": il proprietario o utilizzatore dell\'apparecchio, non l\'ufficio che ha fatto la verifica (ASL, INAIL, ARPAS…): ignora indirizzi, telefoni e PEC di quegli uffici.',
    '- "luogo_di_lavoro": "si" se il documento si riferisce a un luogo di lavoro (D.Lgs. 81/08, Allegato VII, verifiche INAIL di attrezzature di lavoro), "no" se a un regime fuori dai luoghi di lavoro (D.M. 329/2004, art. 22 D.M. 01/12/1975 per il riscaldamento), altrimenti vuoto.',
    '- "famiglia": Sollevamento, Riscaldamento o Pressione.',
    '- "tipo_oggetto": "Attrezzatura" o "Insieme" (pressione).',
    `- Generatori: "tipo" con il codice: ${leg(E && E.tipiGeneratore, t => `${t.cod} = ${t.descr}`)}. "combustibile" con il codice: ${leg(E && E.combustibili, t => `${t.cod} = ${t.descr}`)}.`,
    `- Componenti a pressione: "tipo" con il codice: ${leg(E && E.tipiAttrezzatura, t => `${t.cod} = ${t.descr}`)}. "categoria" in numeri romani (I-IV). "gruppo_fluido" 1 o 2.`,
    '- Dispositivi (riscaldamento): "tipo" = "Valvola di sicurezza" oppure "Valvola di intercettazione combustibile".',
    '- "valvola": la valvola di sicurezza di un apparecchio a pressione (matricola, data di taratura, pressione di taratura).',
    `- Sollevamento: "tipologia" = la voce più adatta di questo elenco, scritta esattamente come qui: ${leg(E && E.tipologie, t => t.descr)}. Se nessuna è adatta, il tipo scritto nel documento.`,
    '- Sollevamento: "portata_kg" in chilogrammi (5 t = 5000); "targa" del mezzo; "scadenza_indagine_supplementare" se indicata; "dati_tecnici" = configurazione e dati tecnici rilevati (bracci, prolunghe, zavorre, accessori).',
    '- "verifica_precedente": data della verifica descritta, scadenza della prossima verifica indicata, numero del verbale, ente (ASL, INAIL o altro).',
    '- "note": in breve, dati importanti che non trovano posto nello schema (es. prescrizioni, esito negativo, dati poco leggibili).',
  ].join('\n');
}
async function chiamaClaude(body, versione) {
  const r = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'content-type': 'application/json', 'x-api-key': IMP.chiave || '', 'anthropic-version': versione,
      'anthropic-dangerous-direct-browser-access': 'true',
    },
    body: JSON.stringify(body),
  });
  const testo = await r.text();
  let j = null;
  try { j = JSON.parse(testo); } catch (e) { /* risposta non JSON */ }
  return { stato: r.status, j, testo };
}
async function leggiOnline(avanza) {
  if (!navigator.onLine) throw new Error('Per la lettura online serve internet.');
  if (!IMP.chiave) throw new Error('Manca la chiave del servizio online (Impostazioni).');
  avanza('Preparo le foto…');
  const contenuto = [];
  for (const p of LET.pagine) {
    const b = await ridimensiona(p.blob, 1568, 0.82);
    contenuto.push({ type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: await blobBase64(b) } });
  }
  contenuto.push({ type: 'text', text: promptLettura(LET.fam) });
  const body = {
    model: IMP.modello || 'claude-sonnet-5-5', max_tokens: 4096,
    messages: [{ role: 'user', content: contenuto }],
    output_config: { format: { type: 'json_schema', schema: SCHEMA_LETTURA } },
  };
  avanza('Invio le foto al servizio online…');
  let r;
  try {
    r = await chiamaClaude(body, '2026-10-21');
    if (r.stato === 400 && /version/i.test(r.testo)) r = await chiamaClaude(body, '2023-06-01');
  } catch (e) {
    throw new Error('Non riesco a raggiungere il servizio online. Controlla la connessione.');
  }
  if (r.stato === 401 || r.stato === 403) throw new Error('Il servizio online non accetta la chiave: controllala nelle Impostazioni.');
  if (r.stato === 429 || r.stato === 529 || r.stato >= 500) throw new Error('Il servizio online è occupato: riprova tra poco, oppure leggi sul telefono.');
  if (r.stato !== 200 || !r.j) {
    const msg = r.j && r.j.error ? r.j.error.message : r.testo.slice(0, 200);
    throw new Error('Il servizio online ha risposto con un errore: ' + msg);
  }
  const blocco = (r.j.content || []).find(b => b.type === 'text');
  if (!blocco) throw new Error(r.j.stop_reason === 'refusal' ? 'Il servizio online non ha letto il documento.' : 'Risposta vuota dal servizio online.');
  let x;
  try { x = JSON.parse(blocco.text); } catch (e) { throw new Error('Risposta non leggibile dal servizio online.'); }
  return daRispostaOnline(x);
}
function daRispostaOnline(x) {
  const P = vuotaProposta();
  const s = v => (v === null || v === undefined ? '' : String(v).trim());
  const d = x.ditta || {}, a = x.apparecchio || {}, v = x.valvola || {}, p = x.verifica_precedente || {};
  P.fam = s(x.famiglia);
  P.lav = /^s[iì]/i.test(s(x.luogo_di_lavoro)) ? true : /^no/i.test(s(x.luogo_di_lavoro)) ? false : null;
  Object.assign(P.ditta, { rs: s(d.ragione_sociale), piva: s(d.partita_iva), cf: s(d.codice_fiscale), sdi: s(d.codice_sdi), ind: s(d.indirizzo), cap: s(d.cap),
    com: s(d.comune), prov: s(d.provincia), pec: s(d.pec) });
  Object.assign(P.app, { mat: s(a.matricola), nfab: s(a.numero_fabbrica), costr: s(a.costruttore), mod: s(a.modello), anno: s(a.anno),
    ubTipo: s(a.installato_nel), ubCom: s(a.ubicazione_comune), ubProv: s(a.ubicazione_provincia), ubInd: s(a.ubicazione_indirizzo),
    ubPresso: s(a.presso), tipoOgg: /insieme/i.test(s(a.tipo_oggetto)) ? 'Insieme' : /attrezzatura/i.test(s(a.tipo_oggetto)) ? 'Attrezzatura' : '',
    uso: s(a.descrizione_uso), portata: s(a.portata_kg), targa: s(a.targa), tipologia: s(a.tipologia),
    scadIndagine: s(a.scadenza_indagine_supplementare) });
  P.app.idTip = tipologiaSimile(P.app.tipologia);
  P.gen = (x.generatori || []).map(g => ({ num: s(g.numero), tipo: s(g.tipo), costr: s(g.costruttore), nfab: s(g.numero_fabbrica),
    bar: s(g.pressione_bar), comb: s(g.combustibile), kw: s(g.potenza_kw) }));
  P.vasi = (x.vasi || []).map(g => ({ num: s(g.numero), litri: s(g.capacita_litri), nfab: s(g.numero_fabbrica) }));
  P.disp = (x.dispositivi || []).map(g => ({ tipo: s(g.tipo), num: s(g.numero), bar: s(g.taratura_bar) }));
  P.comp = (x.componenti || []).map(g => ({ tipo: s(g.tipo), fabbr: s(g.fabbricante), nfab: s(g.numero_fabbrica), attr: s(g.attr_cam),
    gruppo: s(g.gruppo_fluido), cat: s(g.categoria), litri: s(g.capacita_litri), ps: s(g.ps_bar), pe: s(g.p_esercizio_bar),
    tsmin: s(g.ts_min), tsmax: s(g.ts_max), te: s(g.t_esercizio) }));
  Object.assign(P.valv, { mat: s(v.matricola), data: s(v.data_taratura), bar: s(v.taratura_bar) });
  Object.assign(P.prec, { data: s(p.data), prossima: s(p.prossima_verifica), numero: s(p.numero_verbale), ente: s(p.ente), datiTecnici: s(p.dati_tecnici) });
  if (/inail/i.test(P.prec.ente) && P.prec.prossima) P.app.scadINAIL = P.prec.prossima;
  P.testo = s(x.note) ? 'Note del servizio online: ' + s(x.note) : '';
  P.online = true;
  return P;
}

// ---------------------------------------------------------------- vista
function apriLettura(ctx) {
  let fam = ctx.fam;
  if (ctx.tipo === 'apparecchio') fam = R.get(ctx.uuid).d.fam;
  if (ctx.tipo === 'verifica') { const a = apparecchio(R.get(ctx.uuid).d.app); fam = a ? a.fam : ''; }
  if (LET) LET.pagine.forEach(p => URL.revokeObjectURL(p.url));
  LET = { ctx, fam, pagine: [], P: null, stato: '' };
  vai('lettura');
}

VISTE.lettura = async main => {
  titolo('Leggi da foto');
  if (!LET) { main.append(h('p', { class: 'vuoto' }, 'Nessuna lettura in corso.')); return; }
  const stato = h('div', { class: 'info' }, LET.stato || '');
  stato.hidden = !LET.stato;
  const avanza = t => { LET.stato = t; stato.textContent = t; stato.hidden = !t; };
  const aggiungi = cattura => {
    const i = h('input', { type: 'file', accept: 'image/*', multiple: !cattura, capture: cattura ? 'environment' : null, hidden: true });
    i.addEventListener('change', () => {
      for (const f of i.files) LET.pagine.push({ blob: f, url: URL.createObjectURL(f) });
      i.remove();
      mostra(true);
    });
    document.body.append(i);
    i.click();
  };
  const leggi = async online => {
    if (!LET.pagine.length) return;
    try {
      LET.P = online ? await leggiOnline(avanza) : await leggiSulTelefono(avanza);
      avanza('');
    } catch (e) {
      avanza('');
      await messaggio('Lettura non riuscita', e.message || String(e));
    }
    mostra(true);
  };

  main.append(
    h('p', {}, { nuovo: 'Fotografa il verbale precedente, il verbale INAIL o la targhetta: i dati letti servono per l\'apparecchio nuovo.',
                 apparecchio: 'Fotografa il verbale precedente, il verbale INAIL o la targhetta: i dati letti completano l\'apparecchio.',
                 verifica: 'Fotografa la targhetta o il certificato di taratura della valvola.' }[LET.ctx.tipo]),
    h('p', { class: 'nota' }, 'Una foto per pagina, dritta, ben illuminata e a fuoco. ' + (LET.fam ? `Famiglia: ${LET.fam}.` : '')),
    h('div', { class: 'foto' }, LET.pagine.map((p, i) => h('figure', {}, h('img', { src: p.url, alt: `pagina ${i + 1}` }),
      h('figcaption', {}, h('span', {}, `pagina ${i + 1}`), h('button', { type: 'button', onclick: () => {
        URL.revokeObjectURL(p.url); LET.pagine.splice(i, 1); mostra(true);
      } }, 'togli'))))),
    h('div', { class: 'riga-btn' },
      h('button', { class: 'btn secondario', onclick: () => aggiungi(true) }, 'Scatta foto'),
      h('button', { class: 'btn secondario', onclick: () => aggiungi(false) }, 'Dalla galleria')),
    LET.pagine.length ? h('button', { class: 'btn', onclick: () => leggi(false) }, 'Leggi sul telefono') : null,
    LET.pagine.length && IMP.online ? h('button', { class: 'btn secondario', onclick: () => leggi(true) }, 'Leggi online (più preciso, invia le foto)') : null,
    stato);

  if (LET.P) disegnaProposta(main);
};

function disegnaProposta(main) {
  const P = LET.P, ctx = LET.ctx, fam = LET.fam;
  const ridisegna = () => { pila[pila.length - 1].scroll = window.scrollY; mostra(true); };
  main.append(h('h2', {}, 'Dati letti'),
    h('p', { class: 'nota' }, P.online ? 'Letti dal servizio online. Controllali: svuota un campo per non usarlo.'
      : 'Letti sul telefono. Controllali: svuota un campo per non usarlo. Quello che manca puoi prenderlo dal testo letto, più sotto, o scriverlo.'));
  if (P.fam && fam && P.fam !== fam) main.append(h('div', { class: 'avviso' }, `Il documento sembra di un apparecchio di ${P.fam.toLowerCase()}, non di ${fam.toLowerCase()}.`));

  // ditta gia' in elenco?
  if (ctx.tipo !== 'verifica') {
    const z = dittaInElenco(P.ditta);
    if (z) main.append(h('div', { class: 'info' }, `Ditta già nell'elenco: ${z.rs}. Verrà usata quella.`));
    const a = P.app.mat ? (E.apparecchi || []).find(x => norm(x.mat) === norm(P.app.mat)) : null;
    if (a && ctx.tipo === 'nuovo') main.append(h('div', { class: 'info' }, `La matricola ${a.mat} è già nell'elenco: potrai aprire subito la verifica.`));
  }
  if (ctx.tipo !== 'verifica' && fam !== 'Sollevamento') {
    main.append(etichetta('Luogo di lavoro (secondo il documento)', campoSiNo(P, 'lav', () => {}, ['Sì', 'No'])));
  }
  if (ctx.tipo !== 'verifica' && fam === 'Sollevamento') {
    main.append(etichetta('Tipologia (dall\'elenco)', campoScelta(P.app, 'idTip', (E.tipologie || []).map(t => ({ v: t.id, t: t.descr })), () => {},
      { vuota: P.app.tipologia ? '— nessuna voce adatta: scegli —' : '— scegli —' })));
  }
  const campi = campiPer(ctx, fam);
  const pieni = campi.filter(([p]) => String(leggiCampo(P, p)).trim());
  const vuoti = campi.filter(([p]) => !String(leggiCampo(P, p)).trim());
  const riga = ([p, et]) => { const [a, b] = p.split('.'); return etichetta(et, campoTesto(P[a], b, () => {}, {})); };
  if (!pieni.length) main.append(h('p', { class: 'avviso' }, 'Nessun dato riconosciuto: prendilo dal testo letto, più sotto, o riprova con una foto più nitida.'));
  main.append(pieni.map(riga));
  if (vuoti.length) {
    main.append(h('details', { class: 'scheda' }, h('summary', { style: 'font-weight:600;color:var(--blu);padding:4px 0' }, `Altri campi (${vuoti.length}, vuoti)`), vuoti.map(riga)));
  }
  for (const [k, def] of elenchiPer(ctx, fam)) {
    main.append(h('h2', {}, def.titolo));
    (P[k] || []).forEach((x, i) => main.append(h('div', { class: 'blocco' },
      h('h3', {}, `${def.uno} ${i + 1}`, x.nota ? h('span', { class: 'chip bozza' }, x.nota) : null,
        h('button', { type: 'button', onclick: () => { P[k].splice(i, 1); ridisegna(); } }, 'togli')),
      h('div', { class: 'due' }, def.campi.map(([c, et]) => etichetta(et, campoTesto(x, c, () => {}, {})))))));
    main.append(h('button', { class: 'btn secondario', onclick: () => {
      P[k].push(Object.fromEntries(def.campi.map(([c]) => [c, ''])));
      ridisegna();
    } }, `Aggiungi a "${def.titolo}"`));
  }

  // testo letto: una riga si puo' mettere in un campo
  const righe = String(P.testo || '').split('\n').map(s => s.trim()).filter(s => s.length > 1);
  if (righe.length) {
    main.append(h('h2', {}, P.online ? 'Note' : 'Testo letto'),
      P.online ? null : h('p', { class: 'nota' }, 'Tocca una riga per metterla in un campo.'),
      h('div', { class: 'scheda' }, righe.map(r => h('div', {
        style: 'padding:7px 2px;border-bottom:1px solid #eef1f4;font-size:15px',
        onclick: P.online ? null : () => assegnaRiga(r),
      }, r))));
  }
  barra(h('button', { class: 'btn verde', onclick: applicaLettura }, { nuovo: 'Usa questi dati', apparecchio: 'Metti nell\'apparecchio', verifica: 'Metti nella verifica' }[ctx.tipo]));
}

async function assegnaRiga(riga) {
  const ctx = LET.ctx, fam = LET.fam;
  const testo = h('textarea', { style: 'min-height:70px' });
  testo.value = riga;
  const scelte = campiPer(ctx, fam);
  const sel = h('select', {}, scelte.map(([p, et]) => h('option', { value: p }, et)));
  const ok = await finestra('Metti in un campo', h('div', {}, h('p', { class: 'nota' }, 'Lascia solo la parte che serve.'), testo, etichetta('Campo', sel)),
    [{ testo: 'Annulla', valore: false, classe: 'secondario' }, { testo: 'Metti', valore: true }]);
  if (!ok) return;
  scriviCampo(LET.P, sel.value, testo.value.trim());
  pila[pila.length - 1].scroll = window.scrollY;
  mostra(true);
}

// ---------------------------------------------------------------- applicazione dei dati letti
function dittaInElenco(dt) {
  const p = norm(dt.piva), c = norm(dt.cf);
  if (!p && !c) return null;
  return (E.aziende || []).find(a => (p && norm(a.piva) === p) || (c && norm(a.cf) === c)) || null;
}
async function risolviDitta(dt) {
  const z = dittaInElenco(dt);
  if (z) return 'ID:' + z.id;
  for (const r of R.values()) {
    if (r.tipo === 'AZ' && r.stato !== 'importata' && ((dt.piva && norm(r.d.piva) === norm(dt.piva)) || (dt.cf && norm(r.d.cf) === norm(dt.cf)))) return 'N:' + r.uuid;
  }
  if (!String(dt.rs || '').trim()) return null;
  const r = await nuovoRecord('AZ', { tipo: /condominio/i.test(dt.rs) ? 'Condominio' : 'Azienda', rs: dt.rs.trim(), piva: dt.piva || '',
    cf: dt.cf || '', sdi: dt.sdi || '', pec: dt.pec || '', email: '', tel: '', ref: '', ind: dt.ind || '', cap: dt.cap || '', com: dt.com || '',
    prov: dt.prov || '' });
  return 'N:' + r.uuid;
}
const codiceIn = (l, v, chiave = 'cod') => {
  const s = String(v || '').trim();
  if (!s) return null;
  const x = (l || []).find(t => String(t[chiave]).toUpperCase() === s.toUpperCase()) ||
            (l || []).find(t => t.descr && t.descr.toLowerCase().includes(s.toLowerCase()));
  return x ? String(x[chiave]) : null;
};
function notaPrecedente(P) {
  const p = P.prec;
  if (!p.data && !p.prossima && !p.numero) return '';
  return 'Documento precedente' + (p.ente ? ` (${p.ente})` : '') + (p.numero ? `: verbale n. ${p.numero}` : '') +
    (p.data ? ` del ${fmtData(p.data)}` : '') + (p.prossima ? `, prossima verifica entro ${fmtMese(p.prossima)}` : '') + '.';
}
// copia nell'apparecchio (record d) i campi non vuoti
function copiaInApparecchio(P, d) {
  const scarti = [];
  const nv = (v, nome) => {           // numero valido, altrimenti vuoto (e annotato)
    const t = String(v || '').trim();
    if (!t) return '';
    if (numeroOut(t) === null) { scarti.push(`${nome} ${t}`); return ''; }
    return t;
  };
  for (const k of ['mat', 'nfab', 'costr', 'mod', 'ubTipo', 'ubCom', 'ubProv', 'ubInd', 'ubPresso', 'uso', 'targa']) {
    const v = String(P.app[k] || '').trim();
    if (v) d[k] = v;
  }
  if (nv(P.app.anno, 'anno')) d.anno = nv(P.app.anno, 'anno');
  if (nv(P.app.portata, 'portata')) d.portata = nv(P.app.portata, 'portata');
  if (P.app.tipoOgg) d.tipoOgg = P.app.tipoOgg;
  if (d.fam === 'Sollevamento') {
    const t = P.app.idTip || tipologiaSimile(P.app.tipologia);
    if (t) d.tipologia = String(t);
    else if (P.app.tipologia) scarti.push(`tipologia "${P.app.tipologia}" (non trovata nell'elenco)`);
    if (normData(P.app.scadIndagine)) d.scadIndagine = normData(P.app.scadIndagine);
    if (String(P.prec.datiTecnici || '').trim()) d.datiPrec = P.prec.datiTecnici.trim();
  }
  if (P.lav !== null && P.lav !== undefined && d.fam !== 'Sollevamento') d.lav = P.lav;
  const sc = dataIso(P.app.scadINAIL) || (/^\d{4}-\d{2}-\d{2}$/.test(P.app.scadINAIL) ? P.app.scadINAIL : '');
  if (sc) d.scadINAIL = sc;
  if (P.valv.mat || P.valv.bar) d.valvPrec = { mat: P.valv.mat, data: normData(P.valv.data), bar: P.valv.bar };
  const unisci = (k, righe) => { if (!righe.length) return; d[k] = (d[k] || []).length ? [...d[k], ...righe] : righe; };
  if (d.fam === 'Riscaldamento') {
    unisci('gen', P.gen.filter(g => Object.values(g).some(Boolean)).map((g, i) => ({ num: g.num || String(i + 1),
      tipo: codiceIn(E.tipiGeneratore, g.tipo), costr: g.costr || '', nfab: g.nfab || '', bar: nv(g.bar, 'pressione generatore'),
      comb: codiceIn(E.combustibili, g.comb), kw: nv(g.kw, 'potenza') })));
    unisci('vasi', P.vasi.filter(v => Object.values(v).some(Boolean)).map((v, i) => ({ num: v.num || String(i + 1), litri: nv(v.litri, 'capacità vaso'), nfab: v.nfab || '' })));
    unisci('disp', P.disp.filter(v => v.num || v.bar).map(v => ({
      tipo: /intercett/i.test(v.tipo) ? 'Valvola di intercettazione combustibile' : 'Valvola di sicurezza', num: v.num || '', bar: nv(v.bar, 'taratura') })));
  }
  if (d.fam === 'Pressione') {
    unisci('comp', P.comp.filter(c => Object.values(c).some(Boolean)).map(c => ({
      tipo: codiceIn(E.tipiAttrezzatura, c.tipo) || 'RG', fabbr: c.fabbr || '', nfab: c.nfab || '', attr: c.attr || '',
      gruppo: /^[12]$/.test(String(c.gruppo).trim()) ? String(c.gruppo).trim() : null,
      cat: /^(I|II|III|IV)$/.test(String(c.cat).trim().toUpperCase()) ? String(c.cat).trim().toUpperCase() : null,
      litri: nv(c.litri, 'capacità'), ps: nv(c.ps, 'PS'), pe: nv(c.pe, 'P esercizio'), tsmin: nv(c.tsmin, 'TS min'),
      tsmax: nv(c.tsmax, 'TS max'), te: nv(c.te, 'T esercizio') })));
  }
  if (P.valv.bar && numeroOut(P.valv.bar) === null && d.valvPrec) { scarti.push(`taratura valvola ${P.valv.bar}`); d.valvPrec.bar = ''; }
  let nota = notaPrecedente(P);
  if (scarti.length) nota += (nota ? ' ' : '') + 'Letti dal documento (non numerici): ' + scarti.join('; ') + '.';
  if (nota && !String(d.note || '').includes(nota)) d.note = (d.note ? d.note + '\n' : '') + nota;
}
const normData = s => dataIso(s) || (/^\d{4}-\d{2}-\d{2}$/.test(String(s || '').trim()) ? String(s).trim() : '');

async function salvaPagineCome(uuid) {
  for (const p of LET.pagine) {
    await metti('foto', { id: uid(), ref: uuid, descr: 'Documento letto', blob: await ridimensiona(p.blob, 1600, 0.72), creato: Date.now() });
  }
}

// Sollevamento: dati tecnici nella verifica; indagine supplementare diversa da quella in archivio tra le modifiche
function datiSollevamentoInVerifica(P, r, a) {
  const dt = String(P.prec.datiTecnici || '').trim();
  const prima = String(r.d.datiTecnici || '').trim();
  if (dt && !prima.includes(dt)) r.d.datiTecnici = !prima || dt.includes(prima) ? dt : prima + '\n' + dt;
  const ind = normData(P.app.scadIndagine);
  if (ind && ind !== (a.indagine || '')) {
    r.d.modifiche = (r.d.modifiche ? r.d.modifiche + '\n' : '') + `Indagine supplementare da eseguirsi entro il ${fmtData(ind)} (letto dal documento).`;
  }
}

async function applicaLettura() {
  const P = LET.P, ctx = LET.ctx;
  if (ctx.tipo === 'nuovo') {
    const esiste = P.app.mat ? (E.apparecchi || []).find(x => norm(x.mat) === norm(P.app.mat)) : null;
    if (esiste) {
      const a = apparecchio('ID:' + esiste.id);
      if (!await conferma('Apparecchio già nell\'elenco', `La matricola ${esiste.mat} è già nell'elenco (${(ditta(a.az) || {}).rs || ''}). Apro la verifica di questo apparecchio?`, 'Apri la verifica', 'Annulla')) return;
      const r = await iniziaVerifica(a);
      if (r && !bloccato(r)) {
        if (a.fam === 'Pressione') {
          if (P.valv.mat) r.d.valvMat = P.valv.mat;
          if (normData(P.valv.data)) r.d.valvData = normData(P.valv.data);
          if (P.valv.bar) r.d.valvBar = P.valv.bar;
        }
        if (a.fam === 'Sollevamento') datiSollevamentoInVerifica(P, r, a);
        await salvaRecord(r);
        await salvaPagineCome(r.uuid);
        mostra(true);
      }
      return;
    }
    const d = { fam: LET.fam, az: null, mat: '', lav: LET.fam === 'Sollevamento' ? true : null, ubTipo: '', ubCom: '', ubProv: '', ubInd: '',
      ubPresso: '', anno: '', tipologia: null, nfab: '', costr: '', mod: '', portata: '', targa: '', tipoOgg: 'Attrezzatura', uso: '',
      note: '', gen: [], vasi: [], disp: [], comp: [], scadINAIL: '' };
    copiaInApparecchio(P, d);
    d.az = await risolviDitta(P.ditta);
    const r = await nuovoRecord('AP', d);
    await salvaPagineCome(r.uuid);
    vai('apparecchio', { uuid: r.uuid, poiVerifica: true }, true);
    return;
  }
  if (ctx.tipo === 'apparecchio') {
    const r = R.get(ctx.uuid);
    copiaInApparecchio(P, r.d);
    if (!r.d.az) r.d.az = await risolviDitta(P.ditta);
    await salvaRecord(r);
    await salvaPagineCome(r.uuid);
    indietro();
    return;
  }
  // verifica: valvola (pressione), dispositivi (riscaldamento), dati tecnici e indagine (sollevamento)
  const r = R.get(ctx.uuid);
  const a = apparecchio(r.d.app);
  if (a && a.fam === 'Sollevamento') {
    datiSollevamentoInVerifica(P, r, a);
  } else if (a && a.fam === 'Pressione') {
    if (P.valv.mat) r.d.valvMat = P.valv.mat;
    if (normData(P.valv.data)) r.d.valvData = normData(P.valv.data);
    if (P.valv.bar) r.d.valvBar = P.valv.bar;
  } else if (P.disp.length) {
    const noti = new Set((a && a.disp || []).map(x => norm(x.num)));
    const nuovi = P.disp.filter(x => x.num && !noti.has(norm(x.num)));
    if (nuovi.length) {
      const t = 'Dispositivi letti dalla foto: ' + nuovi.map(x => `${x.tipo || 'valvola'} N° ${x.num}${x.bar ? ' tarata ' + x.bar + ' bar' : ''}`).join('; ') + '.';
      r.d.modifiche = (r.d.modifiche ? r.d.modifiche + '\n' : '') + t;
    }
  }
  await salvaRecord(r);
  await salvaPagineCome(r.uuid);
  indietro();
}

// ---------------------------------------------------------------- impostazioni della lettura
function sezioneLettura() {
  const salva = () => metti('impostazioni', IMP, 'imp');
  const stato = h('p', { class: 'nota' }, IMP.ocrPronto ? 'Lettura sul telefono: pronta anche senza internet.'
    : 'Lettura sul telefono: da preparare (serve internet una volta, circa 6 MB).');
  const online = h('div', { hidden: !IMP.online },
    h('div', { class: 'avviso' }, 'Con la lettura online le foto dei documenti vengono inviate al servizio Claude di Anthropic. ' +
      'Attivala solo se il tuo ufficio lo permette. Serve una chiave del servizio (account a pagamento su console.anthropic.com).'),
    etichetta('Chiave del servizio', (() => {
      // casella di testo con i caratteri nascosti (non un campo password: non e' l'accesso a un sito)
      const k = campoTesto(IMP, 'chiave', salva, { ph: 'sk-ant-…' });
      k.classList.add('chiave');
      k.setAttribute('autocomplete', 'off');
      k.setAttribute('spellcheck', 'false');
      return k;
    })()),
    etichetta('Modello', campoScelta(IMP, 'modello', [
      { v: 'claude-sonnet-5-5', t: 'Claude Sonnet 5.5 (consigliato)' },
      { v: 'claude-haiku-5-5', t: 'Claude Haiku 5.5 (più economico)' },
      { v: 'claude-opus-5-5', t: 'Claude Opus 5.5 (più preciso, più caro)' }], salva, { vuota: false })));
  if (!IMP.modello) IMP.modello = 'claude-sonnet-5-5';
  const c = h('input', { type: 'checkbox', checked: Boolean(IMP.online) });
  c.addEventListener('change', () => { IMP.online = c.checked; online.hidden = !c.checked; salva(); });
  return [
    h('h2', {}, 'Lettura delle foto'),
    stato,
    IMP.ocrPronto ? null : h('button', { class: 'btn secondario', onclick: async ev => {
      ev.target.disabled = true;
      stato.textContent = 'Preparo la lettura…';
      const ok = await preparaLettura(true);
      stato.textContent = ok ? 'Lettura sul telefono: pronta anche senza internet.' : 'Non ci sono riuscito: serve internet.';
      ev.target.disabled = false;
    } }, 'Prepara la lettura senza internet'),
    h('label', { class: 'spunta' }, c, 'Lettura online con l\'intelligenza artificiale'),
    online,
  ];
}
