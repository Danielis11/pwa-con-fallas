// Notificaciones: locales (Notification API desde el Service Worker) y push (Push API + servidor).

export async function pedirPermiso() {
  if (!('Notification' in window)) throw new Error('Este navegador no soporta notificaciones.');
  const permiso = await Notification.requestPermission();
  if (permiso !== 'granted') throw new Error('Permiso de notificaciones: ' + permiso);
}

// Notificación LOCAL: la genera la propia app, sin servidor. Se muestra a través del
// Service Worker (registration.showNotification), que es lo que funciona también en Android.
export async function notificacionLocal(titulo, cuerpo) {
  if (!('Notification' in window) || Notification.permission !== 'granted') return;
  const reg = await navigator.serviceWorker.ready;
  await reg.showNotification(titulo, {
    body: cuerpo,
    icon: 'img/icons/icon-192.png',
    badge: 'img/icons/icon-192.png',
  });
}

// La clave pública VAPID viaja en Base64 URL; pushManager.subscribe la necesita como bytes
function base64UrlABytes(base64Url) {
  const relleno = '='.repeat((4 - base64Url.length % 4) % 4);
  const base64 = (base64Url + relleno).replace(/-/g, '+').replace(/_/g, '/');
  return Uint8Array.from(atob(base64), c => c.charCodeAt(0));
}

// Notificación PUSH, paso 2 y 3 del flujo: suscribirse y entregar la suscripción al servidor
export async function suscribirPush() {
  await pedirPermiso();
  const respuesta = await fetch('api/vapid-publica');
  if (!respuesta.ok) throw new Error('No hay servidor de notificaciones disponible.');
  const { clave } = await respuesta.json();

  const reg = await navigator.serviceWorker.ready;
  const suscripcion = await reg.pushManager.subscribe({
    userVisibleOnly: true,
    applicationServerKey: base64UrlABytes(clave),
  });
  const guardada = await fetch('api/suscripciones', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(suscripcion),
  });
  if (!guardada.ok) throw new Error('El servidor no guardó la suscripción.');
}

// Pide al servidor que envíe un push de prueba a todas las suscripciones registradas
export async function pedirPushDePrueba() {
  const respuesta = await fetch('api/push/prueba', { method: 'POST' });
  if (!respuesta.ok) throw new Error('El servidor no pudo enviar el push.');
  return respuesta.json();
}
