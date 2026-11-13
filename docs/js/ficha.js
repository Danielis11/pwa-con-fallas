// "Hidratación" de la ficha generada en el servidor (SSR): el HTML ya llegó con el contenido;
// este script solo le agrega interactividad (calcular la distancia con el GPS).
import { obtenerUbicacion, distanciaKm, vibrar } from './dispositivo.js';

const ficha = document.querySelector('[data-lat]');
const boton = document.getElementById('btn-distancia');
const salida = document.getElementById('distancia');

if (ficha && boton) {
  boton.hidden = false; // sin JavaScript el botón no aparece: la ficha se sigue leyendo completa
  boton.addEventListener('click', async () => {
    salida.textContent = 'Buscando tu ubicación…';
    try {
      const yo = await obtenerUbicacion();
      const km = distanciaKm(yo, { lat: Number(ficha.dataset.lat), lng: Number(ficha.dataset.lng) });
      salida.textContent = `Estás a ${km.toFixed(1)} km en línea recta.`;
      vibrar(150);
    } catch (err) {
      salida.textContent = err.message;
    }
  });
}
