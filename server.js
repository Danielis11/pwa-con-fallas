// Servidor de la práctica Ruta SG (Node + Express).
// - Sirve la PWA (carpeta docs/) como archivos estáticos.
// - SSR: /ficha/:id genera el HTML de cada destino en el servidor.
// - API: reseñas (recibe lo que sincroniza la app) y notificaciones push (web-push + VAPID).
const fs = require('fs');
const path = require('path');
const express = require('express');
const webpush = require('web-push');

const PUERTO = process.env.PORT || 3000;
const PUBLICO = path.join(__dirname, 'docs');
const destinos = JSON.parse(fs.readFileSync(path.join(PUBLICO, 'data', 'destinos.json'), 'utf8'));

const app = express();
app.use(express.json({ limit: '20kb' }));

// ---------- Claves VAPID (npm run vapid) o variables de entorno en producción ----------
let vapid = null;
const archivoVapid = path.join(__dirname, 'vapid.json');
if (process.env.VAPID_PUBLICA && process.env.VAPID_PRIVADA) {
  vapid = { publicKey: process.env.VAPID_PUBLICA, privateKey: process.env.VAPID_PRIVADA };
} else if (fs.existsSync(archivoVapid)) {
  vapid = JSON.parse(fs.readFileSync(archivoVapid, 'utf8'));
}
if (vapid) {
  webpush.setVapidDetails('mailto:docente@utsjr.edu.mx', vapid.publicKey, vapid.privateKey);
} else {
  console.warn('Sin claves VAPID: ejecuta "npm run vapid" para habilitar las notificaciones push.');
}

// ---------- SSR: ficha de destino generada en el servidor ----------
function escapar(texto) {
  return String(texto).replace(/[&<>"']/g, c =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function paginaFicha(d) {
  return `<!doctype html>
<html lang="es">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${escapar(d.nombre)} · Ruta SG</title>
  <meta name="description" content="${escapar(d.descripcion)}">
  <meta name="theme-color" content="#1F3864">
  <link rel="manifest" href="/manifest.json">
  <link rel="stylesheet" href="css/estilos.css">
</head>
<body>
  <header class="barra"><h1>Ruta SG</h1><span class="estado">Ficha SSR</span></header>
  <nav class="menu">
    <a href="/#/inicio">Inicio</a><a href="/#/destinos">Destinos</a><a href="/#/resenas">Reseñas</a>
  </nav>
  <main id="contenido">
    <article class="tarjeta" data-lat="${d.lat}" data-lng="${d.lng}">
      <span class="etiqueta">${escapar(d.tipo)}</span>
      <h2>${escapar(d.nombre)}</h2>
      <p class="meta">${escapar(d.municipio)} · ${escapar(d.horario)}</p>
      <p>${escapar(d.descripcion)}</p>
      <p class="origen">Vista generada en el servidor (SSR) el ${new Date().toLocaleString('es-MX', { timeZone: 'America/Mexico_City' })}</p>
      <button class="boton" id="btn-distancia" hidden>¿Qué tan lejos estoy?</button>
      <p id="distancia"></p>
      <a class="boton secundario" href="/#/destino/${d.id}">Ver versión CSR</a>
    </article>
  </main>
  <script type="module" src="/js/ficha.js"></script>
</body>
</html>`;
}

app.get('/ficha/:id', (req, res) => {
  const d = destinos.find(x => x.id === Number(req.params.id));
  if (!d) return res.status(404).send('Destino no encontrado');
  res.send(paginaFicha(d));
});

// ---------- API de reseñas ----------
const resenas = [];
app.post('/api/resenas', (req, res) => {
  const { destinoId, calificacion, texto, autor, fecha } = req.body || {};
  if (!destinoId || !texto) return res.status(400).json({ error: 'Faltan datos de la reseña' });
  resenas.push({ destinoId, calificacion, texto: String(texto).slice(0, 500), autor, fecha });
  console.log(`Reseña recibida (${resenas.length}):`, autor, '→ destino', destinoId);
  res.status(201).json({ ok: true });
});
app.get('/api/resenas', (req, res) => res.json(resenas));

// ---------- API de notificaciones push ----------
const archivoSuscripciones = path.join(__dirname, 'suscripciones.json');
let suscripciones = fs.existsSync(archivoSuscripciones)
  ? JSON.parse(fs.readFileSync(archivoSuscripciones, 'utf8'))
  : [];
const guardarSuscripciones = () =>
  fs.writeFileSync(archivoSuscripciones, JSON.stringify(suscripciones, null, 2));

app.get('/api/vapid-publica', (req, res) => {
  if (!vapid) return res.status(503).json({ error: 'Push no configurado' });
  res.json({ clave: vapid.publicKey });
});

app.post('/api/suscripciones', (req, res) => {
  const sub = req.body;
  if (!sub || !sub.endpoint) return res.status(400).json({ error: 'Suscripción inválida' });
  if (!suscripciones.some(s => s.endpoint === sub.endpoint)) {
    suscripciones.push(sub);
    guardarSuscripciones();
  }
  res.status(201).json({ ok: true, total: suscripciones.length });
});

app.post('/api/push/prueba', async (req, res) => {
  if (!vapid) return res.status(503).json({ error: 'Push no configurado' });
  const mensaje = JSON.stringify({
    titulo: 'Ruta SG · Aviso de camino',
    cuerpo: 'Neblina en el tramo Jalpan–Pinal de Amoles. Maneja con precaución.',
    url: './#/destinos',
  });
  let enviados = 0;
  const vigentes = [];
  for (const sub of suscripciones) {
    try {
      await webpush.sendNotification(sub, mensaje);
      enviados++;
      vigentes.push(sub);
    } catch (err) {
      // 404/410: la suscripción ya no existe (el usuario la revocó); se descarta
      if (err.statusCode !== 404 && err.statusCode !== 410) vigentes.push(sub);
      console.warn('Push fallido:', err.statusCode || err.message);
    }
  }
  suscripciones = vigentes;
  guardarSuscripciones();
  res.json({ enviados });
});

// ---------- Archivos estáticos de la PWA ----------
app.use(express.static(PUBLICO));

app.listen(PUERTO, () => console.log(`Ruta SG en http://localhost:${PUERTO}`));
