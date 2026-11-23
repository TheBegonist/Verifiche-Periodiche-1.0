'use strict';
/* Verifiche periodiche - estrazione dei dati dal testo letto in una foto
   (verbali nostri, verbali INAIL o di altri enti, targhette, certificati).
   Le regole cercano le etichette piu' comuni: quello che non trovano si
   assegna a mano dalle righe del testo letto. */

function vuotaProposta() {
  return {
    fam: '', lav: null,
    ditta: { rs: '', piva: '', cf: '', sdi: '', ind: '', cap: '', com: '', prov: '', pec: '' },
    app: { mat: '', nfab: '', costr: '', mod: '', anno: '', ubTipo: '', ubCom: '', ubProv: '', ubInd: '', ubPresso: '',
           tipoOgg: '', uso: '', portata: '', targa: '', tipologia: '', idTip: '', scadINAIL: '', scadIndagine: '' },
    gen: [], vasi: [], disp: [], comp: [],
    valv: { mat: '', data: '', bar: '' },
    prec: { data: '', prossima: '', numero: '', ente: '', datiTecnici: '' },
    testo: '',
  };
}

// "15/10/2026" -> "2026-10-15"; "10/2031" -> "2031-10-01"
function dataIso(s) {
  if (!s) return '';
  const iso = /^\s*(\d{4})-(\d{2})-(\d{2})\s*$/.exec(s);
  if (iso) return `${iso[1]}-${iso[2]}-${iso[3]}`;
  let m = /(\d{1,2})[\/.\-](\d{1,2})[\/.\-](\d{4}|\d{2})\b/.exec(s);
  if (m) {
    const a = m[3].length === 2 ? '20' + m[3] : m[3];
    const g = +m[1], me = +m[2];
    if (g >= 1 && g <= 31 && me >= 1 && me <= 12) return `${a}-${String(me).padStart(2, '0')}-${String(g).padStart(2, '0')}`;
  }
  m = /\b(\d{1,2})[\/.\-](\d{4})\b/.exec(s);
  if (m && +m[1] >= 1 && +m[1] <= 12) return `${m[2]}-${String(+m[1]).padStart(2, '0')}-01`;
  return '';
}
const numIt = s => (s || '').replace(/\s/g, '');
// valore che finisce dove comincia l'etichetta successiva sulla stessa riga
const ETICHETTE = /\s+(?:targa(?: mezzo)?|matricola|n\.?\s*fabbrica|n°\s*fabbrica|numero di fabbrica|modello|con portata|portata|partita\s*i?va|p\.?\s*iva|pec|sede legale|codice (?:univoco|fiscale|destinatario)|tipologia|anno|verbale n|dell'|c\.f\.)\b.*$/i;
const taglia = v => String(v || '').replace(ETICHETTE, '').replace(/[|;]+\s*$/, '').trim();
// "Ss/2010/200082 N" -> "SS/2010/200082"; "SS 0451/19" resta cosi'
function pulisciCodice(v) {
  const out = [];
  for (const t of String(v || '').toUpperCase().replace(/[|]/g, '').split(/\s+/).filter(Boolean)) {
    if (/\d/.test(t)) out.push(t.replace(/[.,;:]+$/, ''));
    else if (!out.length && /^[A-Z]{2,4}$/.test(t)) out.push(t);
    else break;
  }
  return out.length && out.some(t => /\d/.test(t)) ? out.join(' ') : '';
}
// portata in kg: "50.000 kg" -> 50000; "2,5 t" -> 2500
function kgDa(n, unita) {
  let t = String(n || '').trim();
  if (/^\d{1,3}([.\s]\d{3})+$/.test(t)) t = t.replace(/[.\s]/g, '');
  const v = parseFloat(t.replace(',', '.'));
  if (!isFinite(v)) return '';
  return String(Math.round(/^t/i.test(unita || '') ? v * 1000 : v));
}

function estraiDati(testo, fam) {
  const P = vuotaProposta();
  P.testo = testo || '';
  const T = (testo || '').replace(/\r/g, '').replace(/[‘’`´]/g, "'").replace(/[“”]/g, '"').replace(/[—–]/g, '-')
    .replace(/\s*\/\s*(?:manufacturer|model|serial\s*n[°o.]?|serial number|year(?: of manufacture)?|max\.?\s*load|rated (?:capacity|load)|weight|type)\b/gi, '');
  const righe = T.split('\n').map(s => s.replace(/[ \t]+/g, ' ').trim()).filter(Boolean);
  // righe dell'ufficio (intestazione e piede dei nostri verbali): non sono dati della ditta
  const ufficio = r => /rizzeddu|aslsassari|asl1sassari|spresal|079\/?20|serv\.presal/i.test(r);
  const utili = righe.filter(r => !ufficio(r));
  const tutto = utili.join('\n');
  const prosa = utili.join(' ');
  const primo = (re, src = tutto) => { const m = re.exec(src); return m ? m : null; };

  // --- famiglia e regime
  if (/riscaldamento|generator[ei] di calore|raccolta r\b|focolare/i.test(prosa)) P.fam = 'Riscaldamento';
  else if (/pressione|D\.?\s?M\.?\s*329|serbatoio|recipiente|\bPS\b/i.test(prosa)) P.fam = 'Pressione';
  else if (/sollevamento|\bgru\b|piattaforma|carrello|portata/i.test(prosa)) P.fam = 'Sollevamento';
  if (/D\.?\s?Lgs\.?\s*81|allegato VII|luoghi di lavoro|INAIL|sollevamento/i.test(prosa)) P.lav = true;
  if (/D\.?\s?M\.?\s*329|art\.?\s*22\s*D\.?\s?M/i.test(prosa)) P.lav = false;
  fam = fam || P.fam;

  // --- matricola
  for (const r of utili) {
    if (/valvola/i.test(r)) continue;
    const m = /\bmatr(?:icola)?\.?\s*(?:INAIL|ISPESL|ENPI|ASL)?\s*(?:numero|n\.?|n°|nr\.?)?\s*[:.]?\s*([A-Z0-9][A-Z0-9.\/\-]*(?:\s+[A-Z0-9][A-Z0-9.\/\-]*){0,2})/i.exec(r);
    const v = m ? pulisciCodice(m[1]) : '';
    if (v) { P.app.mat = v; break; }
  }
  if (!P.app.mat) { const m = primo(/\b(\d{4}\s?\/\s?\d{5,6}\s?\/\s?[A-Z]{2})\b/); if (m) P.app.mat = m[1].replace(/\s/g, ''); }
  if (!P.app.mat) {
    // tabella della pressione: sotto "MATRICOLA E SIGLA"
    const i = utili.findIndex(r => /matricola e/i.test(r));
    if (i >= 0) {
      for (const r of utili.slice(i, i + 6)) {
        const m = /\b([A-Z]{1,4}[\-\/ ]?\d{2,6}(?:[\-\/]\d{1,4})?)\b/.exec(r);
        if (m && /\d/.test(m[1]) && !/^ATTR/i.test(m[1])) { P.app.mat = m[1]; break; }
      }
    }
  }

  // --- ditta
  for (const [re, k] of [[/ragione sociale\s*[:.]?\s*(.+)/i], [/intestazione fattura\s*[:.]?\s*(.+)/i], [/\baddebito a\s*[:.]?\s*(.+)/i],
                         [/\bditta\s*[:.]\s*(.+)/i],
                         [/datore di lavoro\s*[:.]?\s*(.+)/i], [/propriet(?:ario|aria)\s*[:.]\s*(.+)/i], [/\butente\s*[:.]\s*(.+)/i]]) {
    const m = primo(re);
    if (m && m[1].trim().length > 2) { P.ditta.rs = taglia(m[1].replace(/\s+(partita|p\.?\s?iva|c\.?f\.?)\b.*$/i, '')); break; }
    void k;
  }
  const cfRe = /\b([A-Z]{6}\d{2}[A-Z]\d{2}[A-Z]\d{3}[A-Z])\b/;
  const mcf = primo(cfRe);
  if (mcf) P.ditta.cf = mcf[1];
  let m0;
  const numeri = [...tutto.matchAll(/\b(\d{11})\b/g)].map(m => m[1]);
  for (const n of numeri) {
    if (/^[89]/.test(n) && !P.ditta.cf) P.ditta.cf = n;       // codice fiscale numerico di enti e condomini
    else if (!P.ditta.piva) P.ditta.piva = n;
  }
  m0 = primo(/(?:destinatario|univoco)[^\n]{0,25}?\bSDI\s*[:.]?\s*([A-Z0-9]{6,8})\b/i) || primo(/\bSDI\s*[:.]\s*([A-Z0-9]{6,8})\b/i);
  if (m0) P.ditta.sdi = m0[1].toUpperCase();
  // sede legale: "Via Roma 12, 07100 Sassari (SS)"
  m0 = primo(/sede legale\s*[:.]?\s*(.+)/i);
  if (m0) {
    const v = taglia(m0[1]);
    const x = /^(.*?)[,\s]+(\d{5})\s+([^()\d,]+?)\s*(?:\(([A-Za-z]{2})\))?\s*$/.exec(v);
    if (x) { P.ditta.ind = x[1].trim(); P.ditta.cap = x[2]; P.ditta.com = x[3].trim(); if (x[4]) P.ditta.prov = x[4].toUpperCase(); }
    else P.ditta.ind = v;
  }
  for (const m of tutto.matchAll(/([\w.\-]+@[\w.\-]+\.[a-z]{2,})/gi)) {
    if (!P.ditta.pec && (/pec/i.test(m[1]) || /\bpec\b/i.test(tutto.slice(Math.max(0, m.index - 12), m.index)))) P.ditta.pec = m[1];
  }

  // --- indirizzi: "Comune: X Indirizzo: Y" (prima riga = ubicazione, dopo l'intestazione = ditta)
  const iInt = utili.findIndex(r => /intestazione fattura|ragione sociale/i.test(r));
  utili.forEach((r, i) => {
    const m = /comune\s*[:.]?\s*(.+?)\s+indirizzo\s*[:.]?\s*(.+?)(?:\s+pec\b.*)?$/i.exec(r);
    if (!m) return;
    if (iInt >= 0 && i > iInt) { if (!P.ditta.com) { P.ditta.com = m[1]; P.ditta.ind = m[2]; } }
    else if (!P.app.ubCom) { P.app.ubCom = m[1]; P.app.ubInd = m[2]; }
  });
  let m = primo(/\bprov(?:incia)?\.?\s*[:.]?\s*([A-Z]{2})\b/i);
  if (m && !P.ditta.prov) { P.ditta.prov = m[1].toUpperCase(); if (P.app.ubCom && !P.app.ubProv) P.app.ubProv = P.ditta.prov; }
  m = primo(/\bCAP\s*[:.]?\s*(\d{5})\b/i);
  if (m && !P.ditta.cap) P.ditta.cap = m[1];
  // luogo di utilizzo (sollevamento): "sito in: Porto Torres, porto industriale", "Luogo di installazione: ..."
  m = primo(/(?:unit[aà] produttiva sito in|luogo di (?:installazione|utilizzo)|cantiere sito in)\s*[:.]?\s*(.+)/i);
  if (m && !P.app.ubCom) {
    const parti = taglia(m[1]).split(',').map(x => x.trim()).filter(Boolean);
    const ultimo = parti[parti.length - 1] || '';
    if (parti.length > 1 && /^[A-ZÀ-Ý]/.test(ultimo) && !/\d/.test(ultimo) && ultimo.split(' ').length <= 3 && !/^(via|viale|zona|loc|localit)/i.test(ultimo)) {
      P.app.ubCom = ultimo; P.app.ubInd = parti.slice(0, -1).join(', ');
    } else { P.app.ubCom = parti[0] || ''; P.app.ubInd = parti.slice(1).join(', '); }
  }
  m = primo(/sito in\s+([^-\n(]+?)\s*-\s*([^(\n]+?)\s*(?:\(([^)]+)\))?\s*$/im);
  if (m) { P.app.ubCom = m[1].trim(); P.app.ubInd = m[2].trim(); if (m[3]) P.app.ubPresso = m[3].trim(); }
  m = primo(/installat[oa] nel(?:l[a'])?\s+(.+)/i);
  if (m) P.app.ubTipo = m[1].trim();
  m = primo(/\bpresso\s*[:.]\s*(.+)/i);
  if (m && !P.app.ubPresso) P.app.ubPresso = m[1].trim();

  // --- verifica precedente
  m = primo(/\bgiorno\s+(\d{1,2}[\/.\-]\d{1,2}[\/.\-]\d{2,4})/i) || primo(/\bdata(?: (?:della )?verifica)?\s*[:.]?\s*(\d{1,2}[\/.\-]\d{1,2}[\/.\-]\d{4})/i);
  if (m) P.prec.data = dataIso(m[1]);
  const dataRe = /(\d{1,2}[\/.\-]\d{1,2}[\/.\-]\d{4}|\d{1,2}[\/.\-]\d{4})/;
  for (const r of utili) {
    if (/indagine/i.test(r)) {
      const x = dataRe.exec(r);
      if (x && !P.app.scadIndagine) P.app.scadIndagine = dataIso(x[1]);
    } else if (!P.prec.prossima && /prossima verifica|entro il/i.test(r)) {
      const x = dataRe.exec(r);
      if (x) P.prec.prossima = dataIso(x[1]);
    }
  }
  m = primo(/verbale\s*(?:n\.?|n°|nr\.?|numero)\s*[:.]?\s*([\w\-]+\s*\/\s*\d{2,4})/i);
  if (m) P.prec.numero = m[1].replace(/\s/g, '');
  P.prec.ente = /INAIL/i.test(prosa.replace(/matricola\s+inail/gi, '')) ? 'INAIL' : /SPRESAL|ASL/i.test(righe.join(' ')) ? 'ASL' : '';
  if (P.prec.ente === 'INAIL' && P.prec.prossima) P.app.scadINAIL = P.prec.prossima;

  // --- sollevamento: dati tecnici, tipologia, portata
  const iDt = utili.findIndex(r => /dati tecnici rilevant/i.test(r));
  if (iDt >= 0) {
    let v = utili[iDt].replace(/^.*?dati tecnici rilevant\w*[^:]*:\s*/i, '');
    for (const r of utili.slice(iDt + 1, iDt + 6)) { if (/^\s*(5\)|osservazioni|esito)/i.test(r)) break; v += ' ' + r; }
    P.prec.datiTecnici = v.trim();
  }
  if (fam === 'Sollevamento' || P.fam === 'Sollevamento') {
    m = primo(/\btipologia(?: macchina| apparecchio)?\s*[:.]?\s*(.+)/i) || primo(/\btipo(?: di)?(?: apparecchio| macchina| attrezzatura)\s*[:.]?\s*(.+)/i);
    if (m) P.app.tipologia = taglia(m[1]);
  }

  // --- riscaldamento
  for (const r of utili) {
    const g = /^(\d{1,2})\s+([AFGHV])\s+(.+?)\s+(\S+)\s+(\d+(?:[.,]\d+)?)\s+(\d)\s+(\d+(?:[.,]\d+)?)$/.exec(r);
    if (g) P.gen.push({ num: g[1], tipo: g[2], costr: g[3], nfab: g[4], bar: numIt(g[5]), comb: g[6], kw: numIt(g[7]) });
  }
  m = primo(/potenzialit[aà]'?\s*globale[\s\S]{0,40}?(\d+(?:[.,]\d+)?)/i);
  if (m && !P.gen.length && fam === 'Riscaldamento') P.gen.push({ num: '1', tipo: '', costr: '', nfab: '', bar: '', comb: '', kw: numIt(m[1]), nota: 'potenzialità globale' });
  m = primo(/(?:potenza|portata termica)(?: termica)?(?: nominale| al focolare| del focolare| focolare)?\s*(?:\(kW\))?\s*[:=]?\s*(\d+(?:[.,]\d+)?)\s*kW/i);
  if (m && !P.gen.length) P.gen.push({ num: '1', tipo: '', costr: '', nfab: '', bar: '', comb: '', kw: numIt(m[1]) });
  m = primo(/capacit[aà] dei vasi[^:\n]*:\s*(?:N\s*°?\s*(\d+))?\s*(\d+(?:[.,]\d+)?)\s*(?:l|lt|litri)\b/i) ||
      primo(/capacit[aà] dei vasi[^:\n]*:\s*(?:N\s*°?\s*(\d+))?\s*(\d+)1\.\s*$/im);
  if (m) {
    const v = { num: m[1] || '1', litri: numIt(m[2]), nfab: '' };
    const f = primo(/capacit[aà] dei vasi[\s\S]{0,80}?n\.?\s*fabbrica\s*[:.]?\s*([A-Z0-9][\w\-\/]*)/i);
    if (f) v.nfab = f[1];
    P.vasi.push(v);
  }
  m = /valvola di sicurezza\s*N\s*°?\s*[:.]?\s*([A-Z0-9][\w\-\/]*)[^;.]*?pressione di\s*(\d+(?:[.,]\d+)?)\s*bar/i.exec(prosa);
  if (m) P.disp.push({ tipo: 'Valvola di sicurezza', num: m[1], bar: numIt(m[2]) });
  m = /intercettazione(?: del)? combustibile\s*N\s*°?\s*[:.]?\s*([A-Z0-9][\w\-\/]*)/i.exec(prosa);
  if (m) P.disp.push({ tipo: 'Valvola di intercettazione combustibile', num: m[1], bar: '' });

  // --- pressione: valvola, tipo, uso, recipiente
  m = /valvola di sicurezza\s*(?:n\s*°?\s*)?matricola\s*([A-Z0-9][\w\-\/]*)/i.exec(prosa);
  if (m) {
    P.valv.mat = m[1];
    const dopo = prosa.slice(m.index, m.index + 160);
    const d = /tarata il\s*(\d{1,2}[\/.\-]\d{1,2}[\/.\-]\d{2,4}|\d{1,2}[\/.\-]\d{4})/i.exec(dopo);
    if (d) P.valv.data = dataIso(d[1]);
    const b = /pressione di\s*(\d+(?:[.,]\d+)?)\s*bar/i.exec(dopo);
    if (b) P.valv.bar = numIt(b[1]);
  }
  if (/\bX\s+Attrezzatura/i.test(tutto)) P.app.tipoOgg = 'Attrezzatura';
  if (/\bX\s+Insieme/i.test(tutto)) P.app.tipoOgg = 'Insieme';
  m = /\b((?:serbatoio|serbatoi|recipiente|autoclave|bombol\w*|accumulo|polmone|essiccatore|compressore)\b[^.]{5,140})\./i.exec(prosa);
  if (m && fam === 'Pressione') P.app.uso = m[1].trim();
  const c = { tipo: '', fabbr: '', nfab: '', attr: '', gruppo: '', cat: '', litri: '', ps: '', pe: '', tsmin: '', tsmax: '', te: '' };
  m = /(\d+(?:[.,]\d+)?)\s+(\d+(?:[.,]\d+)?)\s+(-?\d+)\s*\/\s*\+?(-?\d+)/.exec(tutto);
  if (m && fam === 'Pressione') { c.ps = numIt(m[1]); c.pe = numIt(m[2]); c.tsmin = m[3]; c.tsmax = m[4]; }
  m = primo(/\bPS\s*(?:\(bar\))?\s*[:=]\s*(-?\d+(?:[.,]\d+)?)/i) || primo(/\bPS\s*[:=]?\s*(\d+(?:[.,]\d+)?)\s*bar/i);
  if (m && !c.ps) c.ps = numIt(m[1]);
  m = primo(/\bTS\s*(?:\(°?C\))?\s*[:=]\s*(-?\d+)\s*(?:°C)?\s*[\/÷]\s*\+?(-?\d+)/i);
  if (m && !c.tsmin) { c.tsmin = m[1]; c.tsmax = m[2]; }
  m = primo(/\b(?:V|vol\.?|volume|capacit[aà])\s*(?:\((?:l|litri)\))?\s*[:=]?\s*(\d+(?:[.,]\d+)?)\s*(?:l|lt|litri)\b/i);
  if (m) c.litri = numIt(m[1]);
  if (!c.litri && fam === 'Pressione') {
    const i = utili.findIndex(r => /capacit/i.test(r));
    if (i >= 0) for (const r of utili.slice(i, i + 4)) { const x = /(?:^|\s)(\d{2,6})(?:\s|$)/.exec(r.replace(/capacit\S*\s*\(litri\)/i, '')); if (x) { c.litri = x[1]; break; } }
  }
  m = primo(/\bcat(?:egoria)?\.?\s*[:=]\s*(IV|III|II|I)\b/);
  if (m) c.cat = m[1];
  m = primo(/\bgruppo(?:\s*fluido)?\s*[:=]\s*([12])\b/i);
  if (m) c.gruppo = m[1];
  m = primo(/\b(?:n[°.]?\s*(?:di\s*)?fabbrica\b|numero di fabbrica|serial(?:\s*n[°o.]?)?|s\/n)\s*[:=.]*\s*([A-Z0-9][\w\-\/]*(?:\s+[A-Z0-9][\w\-\/]*){0,2})/i);
  if (m) {
    const nf = pulisciCodice(m[1]) || m[1].split(/\s+/)[0];
    if (fam === 'Pressione') c.nfab = nf; else if (!P.app.nfab && !(P.vasi[0] && P.vasi[0].nfab === nf)) P.app.nfab = nf;
  }
  if (fam === 'Pressione' && !c.nfab) {
    const i = utili.findIndex(r => /fabbrica/i.test(r));
    if (i >= 0) {
      const vicine = utili.slice(i, i + 6).join(' ').split(' ').filter(t => !(P.app.mat && P.app.mat.includes(t)));
      const t = vicine.find(x => /^[A-Z]{1,3}\d{3,}[A-Z0-9]*$/.test(x)) || vicine.find(x => /^\d{4,}$/.test(x) && x !== c.litri);
      if (t) c.nfab = t;
    }
  }
  if (fam === 'Pressione' && /\bRG\b/.test(tutto)) c.tipo = 'RG';
  if (fam === 'Pressione' && Object.values(c).some(Boolean)) P.comp.push(c);

  // --- dati di targa e del sollevamento
  m = primo(/\b(?:fabbricante|costruttore|manufacturer|marca)\s*[:=]\s*(.+)/i);
  if (m) { if (fam === 'Pressione' && P.comp[0]) P.comp[0].fabbr = taglia(m[1]); else P.app.costr = taglia(m[1]); }
  m = primo(/\b(?:modello|model)\s*[:=]?\s*(.+)/i);
  if (m) P.app.mod = taglia(m[1]).replace(/[|\]]$/, '');
  m = primo(/\b(?:anno(?: di)?(?: costruzione| fabbricazione)?|year)\s*[:=]?\s*((?:19|20)\d{2})\b/i);
  if (m) P.app.anno = m[1];
  m = primo(/\bportata\s*(?:max\.?|massima|nominale)?\s*[:=]?\s*(\d{1,3}(?:[.\s]\d{3})+|\d+(?:[.,]\d+)?)\s*(kg|t)\b/i);
  if (m) P.app.portata = kgDa(m[1], m[2]);
  m = primo(/\btarga(?: mezzo)?\s*[:=]?\s*([A-Z]{2}\s?\d{3}\s?[A-Z]{2})/i);
  if (m) P.app.targa = m[1].replace(/\s/g, '').toUpperCase();
  return P;
}

if (typeof module !== 'undefined') module.exports = { estraiDati, dataIso, vuotaProposta };
