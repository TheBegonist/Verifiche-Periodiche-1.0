/* Verifiche periodiche: tiene l'app nel telefono, cosi' si apre anche senza rete.
   Cambiare VERSIONE quando si pubblica una nuova versione dei file. */
const VERSIONE = 'vp-1.7';
const OCR = 'vp-ocr-7.0.0';   // motore di lettura: cambia solo con una nuova versione di Tesseract
const FILE = ['./', 'index.html', 'app.js', 'estrai.js', 'lettura.js', 'scheda.js', 'taratura.js', 'manifest.webmanifest', 'icona-192.png', 'icona-512.png'];

self.addEventListener('install', ev => {
  // cache 'reload': i file della versione nuova presi dal sito, non le copie vecchie nella cache del browser
  ev.waitUntil(caches.open(VERSIONE).then(c => c.addAll(FILE.map(f => new Request(f, { cache: 'reload' }))))
    .then(() => self.skipWaiting()));
});

self.addEventListener('activate', ev => {
  ev.waitUntil(caches.keys()
    .then(k => Promise.all(k.filter(x => x !== VERSIONE && x !== OCR).map(x => caches.delete(x))))
    .then(() => self.clients.claim()));
});

// prima la copia nel telefono (si apre subito, anche senza rete); intanto, se c'e' rete, la aggiorna
self.addEventListener('fetch', ev => {
  if (ev.request.method !== 'GET' || new URL(ev.request.url).origin !== location.origin) return;
  // file del motore di lettura (grandi e immutabili): dalla copia nel telefono, se c'e'
  if (new URL(ev.request.url).pathname.includes('/ocr/')) {
    ev.respondWith(caches.open(OCR).then(async c => {
      const salvata = await c.match(ev.request);
      if (salvata) return salvata;
      const r = await fetch(ev.request);
      if (r && r.ok) c.put(ev.request, r.clone());
      return r;
    }));
    return;
  }
  ev.respondWith(caches.open(VERSIONE).then(async c => {
    const salvata = await c.match(ev.request, { ignoreSearch: true });
    const rete = fetch(ev.request).then(r => {
      if (r && r.ok) c.put(ev.request, r.clone());
      return r;
    }).catch(() => null);
    if (salvata) { ev.waitUntil(rete); return salvata; }
    const r = await rete;
    return r || (await c.match('index.html')) || Response.error();
  }));
});
