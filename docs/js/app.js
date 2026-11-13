// Lógica principal de la PWA: registro del Service Worker, rutas (CSR), datos y vistas.
import { obtenerUbicacion, distanciaKm, vibrar } from './dispositivo.js';
import { pedirPermiso, notificacionLocal, suscribirPush, pedirPushDePrueba } from './notificaciones.js';

const contenido = document.getElementById('contenido');

// ===================== 1. Registro del Service Worker =====================
const habiaControlador = 'serviceWorker' in navigator && !!navigator.serviceWorker.controller;
if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('./sw.js')
    .then(reg => console.log('SW registrado, alcance:', reg.scope))
    .catch(err => console.error('Error al registrar SW:', err));

  // Cuando una versión nueva del SW toma el control (skipWaiting + clients.claim)
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (habiaControlador) avisar('Se instaló una versión nueva de la app.');
  });
  // Mensajes que manda el SW (por ejemplo, al terminar la sincronización de reseñas)
  navigator.serviceWorker.addEventListener('message', e => {
    if (e.data?.tipo === 'resenas-enviadas' && location.hash === '#/resenas') render();
  });
}

// ===================== 2. Utilidades =====================
function escapar(texto) {
  return String(texto).replace(/[&<>"']/g, c =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

let temporizadorAviso;
function avisar(mensaje) {
  const aviso = document.getElementById('aviso');
  aviso.textContent = mensaje;
  aviso.hidden = false;
  clearTimeout(temporizadorAviso);
  temporizadorAviso = setTimeout(() => { aviso.hidden = true; }, 4000);
}

// Indicador de conexión en la barra del app shell
function actualizarEstadoRed() {
  const estado = document.getElementById('estado-red');
  estado.textContent = navigator.onLine ? 'En línea' : 'Sin conexión';
  estado.classList.toggle('sin-red', !navigator.onLine);
}
window.addEventListener('online', () => { actualizarEstadoRed(); enviarPendientes(); });
window.addEventListener('offline', actualizarEstadoRed);

// ===================== 3. Datos locales: preferencias (localStorage) =====================
const preferencias = {
  get tema() { return localStorage.getItem('tema') || 'claro'; },
  set tema(valor) { localStorage.setItem('tema', valor); },
  get nombre() { return localStorage.getItem('nombre') || ''; },
  set nombre(valor) { localStorage.setItem('nombre', valor); },
};
function aplicarTema() {
  document.body.classList.toggle('oscuro', preferencias.tema === 'oscuro');
}

// ===================== 4. Datos remotos con respaldo local (IndexedDB) =====================
let destinosEnMemoria = null;
let origenDatos = '';

async function cargarDestinos() {
  if (destinosEnMemoria) return destinosEnMemoria;
  try {
    const res = await fetch('data/destinos.json');
    if (!res.ok) throw new Error('Respuesta ' + res.status);
    destinosEnMemoria = await res.json();
    // El SW marca con X-Origen las respuestas que sacó de su caché por falta de red (Fase 7)
    origenDatos = res.headers.get('X-Origen') === 'cache-sw'
      ? 'guardados por el service worker (sin red)'
      : 'remotos (red)';
    await RutaDB.guardarDestinos(destinosEnMemoria); // copia local para usar sin red
  } catch (err) {
    console.warn('Sin red, usando datos locales:', err);
    destinosEnMemoria = await RutaDB.leerDestinos();
    origenDatos = 'locales (IndexedDB)';
    if (!destinosEnMemoria.length) {
      destinosEnMemoria = null;
      throw new Error('No hay conexión y todavía no hay datos guardados en este dispositivo.');
    }
  }
  return destinosEnMemoria;
}

// ===================== 5. Reseñas: guardar local y sincronizar =====================
async function enviarPendientes() {
  try {
    const enviadas = await RutaDB.sincronizarResenas();
    if (enviadas > 0) {
      avisar(`${enviadas} reseña(s) enviada(s) al servidor.`);
      if (location.hash === '#/resenas') render();
    }
  } catch (err) {
    console.warn('Reseñas siguen pendientes:', err.message);
  }
}

async function guardarResena(resena) {
  await RutaDB.agregarResena(resena);
  vibrar([100, 50, 100]); // retroalimentación táctil (si el dispositivo la tiene)

  if (navigator.onLine) {
    await enviarPendientes();
    return;
  }
  // Sin red: se encola una sincronización en segundo plano (Background Sync)
  const reg = await navigator.serviceWorker.ready;
  if ('sync' in reg) {
    await reg.sync.register('enviar-resenas');
    avisar('Sin conexión: tu reseña se enviará sola cuando regrese la señal.');
  } else {
    avisar('Sin conexión: tu reseña se enviará la próxima vez que abras la app con señal.');
  }
  notificacionLocal('Reseña guardada', 'Se enviará automáticamente cuando haya conexión.');
}

// ===================== 6. Vistas (renderizado del lado del cliente, CSR) =====================
function tarjetaDestino(d, extra = '') {
  return `
    <article class="tarjeta">
      <span class="etiqueta">${escapar(d.tipo)}</span>
      <h3>${escapar(d.nombre)}</h3>
      <p class="meta">${escapar(d.municipio)} · ${escapar(d.horario)}</p>
      ${extra}
      <a class="boton secundario" href="#/destino/${d.id}">Ver detalle</a>
    </article>`;
}

const vistas = {
  async inicio() {
    const nombre = preferencias.nombre;
    const resenas = await RutaDB.leerResenas();
    const pendientes = resenas.filter(r => r.estado === 'pendiente').length;
    return `
      <section class="tarjeta">
        <h2>${nombre ? '¡Hola, ' + escapar(nombre) + '!' : 'Bienvenido a la Sierra Gorda'}</h2>
        <p>Consulta misiones, cascadas y miradores aunque te quedes sin señal en el camino.</p>
        <a class="boton" href="#/destinos">Ver destinos</a>
        <a class="boton secundario" href="#/cercanos">¿Qué tengo cerca?</a>
        <button id="btn-instalar" class="boton secundario" hidden>Instalar app</button>
      </section>
      <section class="tarjeta">
        <h3>Tu actividad en este dispositivo</h3>
        <p>Reseñas escritas: <strong>${resenas.length}</strong> · Pendientes de enviar: <strong>${pendientes}</strong></p>
      </section>`;
  },

  async destinos() {
    const lista = await cargarDestinos();
    const tipo = sessionStorage.getItem('filtroTipo') || 'Todos';
    const filtrados = tipo === 'Todos' ? lista : lista.filter(d => d.tipo === tipo);
    return `
      <h2>Destinos</h2>
      <p class="origen">Datos ${origenDatos}</p>
      <label for="filtro">Tipo de destino</label>
      <select id="filtro">
        ${['Todos', 'Misión', 'Naturaleza'].map(t =>
          `<option ${t === tipo ? 'selected' : ''}>${t}</option>`).join('')}
      </select>
      <div style="margin-top:1rem">${filtrados.map(d => tarjetaDestino(d)).join('')}</div>`;
  },

  async destino(id) {
    const d = (await cargarDestinos()).find(x => x.id === Number(id));
    if (!d) return '<p class="error">Destino no encontrado.</p>';
    return `
      <article class="tarjeta">
        <span class="etiqueta">${escapar(d.tipo)}</span>
        <h2>${escapar(d.nombre)}</h2>
        <p class="meta">${escapar(d.municipio)} · ${escapar(d.horario)}</p>
        <p>${escapar(d.descripcion)}</p>
        <p class="origen">Vista generada en el navegador (CSR) · datos ${origenDatos}</p>
        <a class="boton" href="ficha/${d.id}">Ver versión generada en servidor (SSR)</a>
        <a class="boton secundario" href="#/destinos">Volver</a>
      </article>`;
  },

  async cercanos() {
    const lista = await cargarDestinos();
    try {
      const yo = await obtenerUbicacion();
      const ordenados = lista
        .map(d => ({ ...d, km: distanciaKm(yo, d) }))
        .sort((a, b) => a.km - b.km);
      return `
        <h2>Destinos cerca de ti</h2>
        <p class="origen">Tu ubicación: ${yo.lat.toFixed(4)}, ${yo.lng.toFixed(4)}</p>
        ${ordenados.map(d => tarjetaDestino(d, `<p><strong>${d.km.toFixed(1)} km</strong> en línea recta</p>`)).join('')}`;
    } catch (err) {
      // Permiso denegado o sin GPS: se ofrece una alternativa, no una pantalla vacía
      return `
        <h2>Destinos cerca de ti</h2>
        <p class="error">${escapar(err.message)} Te mostramos todos los destinos.</p>
        ${lista.map(d => tarjetaDestino(d)).join('')}`;
    }
  },

  async resenas() {
    const lista = await cargarDestinos();
    const resenas = (await RutaDB.leerResenas()).reverse();
    return `
      <section class="tarjeta">
        <h2>Escribe una reseña</h2>
        <form id="form-resena">
          <label for="r-destino">Destino</label>
          <select id="r-destino" required>
            ${lista.map(d => `<option value="${d.id}">${escapar(d.nombre)}</option>`).join('')}
          </select>
          <label for="r-calif">Calificación</label>
          <select id="r-calif">${[5, 4, 3, 2, 1].map(n => `<option>${n}</option>`).join('')}</select>
          <label for="r-texto">Comentario</label>
          <textarea id="r-texto" rows="3" required maxlength="500"></textarea>
          <button class="boton" type="submit" style="margin-top:.75rem">Guardar reseña</button>
        </form>
      </section>
      <h3>Mis reseñas</h3>
      ${resenas.length ? resenas.map(r => `
        <article class="tarjeta">
          <strong>${escapar(r.destino)}</strong> · ${'★'.repeat(r.calificacion)}
          <p>${escapar(r.texto)}</p>
          <span class="${r.estado}">${r.estado === 'pendiente' ? 'Pendiente de enviar' : 'Enviada'}</span>
        </article>`).join('') : '<p class="meta">Aún no escribes reseñas.</p>'}`;
  },

  async ajustes() {
    const permiso = 'Notification' in window ? Notification.permission : 'no soportado';
    return `
      <section class="tarjeta">
        <h2>Preferencias (localStorage)</h2>
        <label for="a-nombre">Tu nombre</label>
        <input id="a-nombre" value="${escapar(preferencias.nombre)}" maxlength="40">
        <label><input type="checkbox" id="a-tema" ${preferencias.tema === 'oscuro' ? 'checked' : ''}
          style="width:auto"> Tema oscuro</label>
      </section>
      <section class="tarjeta">
        <h2>Notificaciones</h2>
        <p class="meta">Permiso actual: <strong>${permiso}</strong></p>
        <button class="boton" id="btn-local">Probar notificación local</button>
        <button class="boton" id="btn-suscribir">Activar notificaciones push</button>
        <button class="boton secundario" id="btn-push">Enviar push de prueba (servidor)</button>
      </section>`;
  },
};

// Conecta los eventos de cada vista después de pintarla
const eventos = {
  inicio() {
    const boton = document.getElementById('btn-instalar');
    if (eventoInstalacion) boton.hidden = false;
    boton.addEventListener('click', async () => {
      eventoInstalacion.prompt();
      await eventoInstalacion.userChoice;
      eventoInstalacion = null;
      boton.hidden = true;
    });
  },
  destinos() {
    document.getElementById('filtro').addEventListener('change', e => {
      sessionStorage.setItem('filtroTipo', e.target.value);
      render();
    });
  },
  resenas() {
    document.getElementById('form-resena').addEventListener('submit', async e => {
      e.preventDefault();
      const select = document.getElementById('r-destino');
      await guardarResena({
        destinoId: Number(select.value),
        destino: select.options[select.selectedIndex].text,
        calificacion: Number(document.getElementById('r-calif').value),
        texto: document.getElementById('r-texto').value.trim(),
        autor: preferencias.nombre || 'Anónimo',
        fecha: new Date().toISOString(),
      });
      render();
    });
  },
  ajustes() {
    document.getElementById('a-nombre').addEventListener('change', e => {
      preferencias.nombre = e.target.value.trim();
      avisar('Nombre guardado.');
    });
    document.getElementById('a-tema').addEventListener('change', e => {
      preferencias.tema = e.target.checked ? 'oscuro' : 'claro';
      aplicarTema();
    });
    document.getElementById('btn-local').addEventListener('click', async () => {
      try {
        await pedirPermiso();
        await notificacionLocal('Ruta SG', 'Así se ve una notificación local de la app.');
      } catch (err) { avisar(err.message); }
      render();
    });
    document.getElementById('btn-suscribir').addEventListener('click', async () => {
      try {
        await suscribirPush();
        avisar('Suscripción push registrada en el servidor.');
      } catch (err) { avisar(err.message); }
      render();
    });
    document.getElementById('btn-push').addEventListener('click', async () => {
      try {
        const { enviados } = await pedirPushDePrueba();
        avisar(`Push enviado a ${enviados} suscripción(es). Cierra la app para comprobarlo.`);
      } catch (err) { avisar(err.message); }
    });
  },
};

// ===================== 7. Enrutador por hash =====================
async function render() {
  const [, ruta = 'inicio', parametro] = location.hash.split('/');
  const vista = vistas[ruta] ? ruta : 'inicio';
  document.querySelectorAll('.menu a').forEach(a =>
    a.classList.toggle('activo', a.getAttribute('href') === '#/' + vista));
  try {
    contenido.innerHTML = await vistas[vista](parametro);
    eventos[vista]?.();
  } catch (err) {
    contenido.innerHTML = `<p class="error">${escapar(err.message)}</p>`;
  }
}
window.addEventListener('hashchange', render);

// ===================== 8. Instalación (botón propio) =====================
let eventoInstalacion = null;
window.addEventListener('beforeinstallprompt', e => {
  e.preventDefault();          // evita el mini-banner automático
  eventoInstalacion = e;       // se guarda para lanzarlo con nuestro botón
  const boton = document.getElementById('btn-instalar');
  if (boton) boton.hidden = false;
});

// ===================== 9. Arranque: splash → home =====================
async function iniciar() {
  aplicarTema();
  actualizarEstadoRed();
  const minimo = new Promise(r => setTimeout(r, 800)); // que el splash no sea un destello
  await Promise.all([render(), minimo]);
  const splash = document.getElementById('splash');
  splash.classList.add('oculto');
  setTimeout(() => splash.remove(), 500);
  enviarPendientes();
}
iniciar();
