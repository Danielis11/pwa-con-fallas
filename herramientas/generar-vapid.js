// Genera el par de claves VAPID (pública/privada) para las notificaciones push.
// Uso: npm run vapid   →  crea vapid.json en la raíz del proyecto (está en .gitignore:
// la clave privada NUNCA se sube al repositorio).
const fs = require('fs');
const path = require('path');
const webpush = require('web-push');

const archivo = path.join(__dirname, '..', 'vapid.json');
if (fs.existsSync(archivo)) {
  console.log('vapid.json ya existe; no se sobrescribe (las suscripciones actuales dejarían de servir).');
  process.exit(0);
}
const claves = webpush.generateVAPIDKeys();
fs.writeFileSync(archivo, JSON.stringify(claves, null, 2));
console.log('Claves VAPID generadas en vapid.json');
console.log('Pública:', claves.publicKey);
