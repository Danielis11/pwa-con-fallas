// Acceso a elementos físicos del dispositivo: GPS (Geolocation API) y vibración (Vibration API).

// Envuelve getCurrentPosition en una promesa. Requiere HTTPS (o localhost) y permiso del usuario.
export function obtenerUbicacion() {
  return new Promise((resolve, reject) => {
    if (!('geolocation' in navigator)) {
      reject(new Error('Este dispositivo no tiene geolocalización.'));
      return;
    }
    navigator.geolocation.getCurrentPosition(
      pos => resolve({ lat: pos.coords.latitude, lng: pos.coords.longitude }),
      err => reject(new Error(err.code === err.PERMISSION_DENIED
        ? 'Permiso de ubicación denegado.'
        : 'No se pudo obtener la ubicación: ' + err.message)),
      { enableHighAccuracy: true, timeout: 10000, maximumAge: 60000 }
    );
  });
}

// Distancia en km entre dos coordenadas (fórmula de Haversine, radio terrestre 6371 km)
export function distanciaKm(a, b) {
  const rad = g => g * Math.PI / 180;
  const dLat = rad(b.lat - a.lat);
  const dLng = rad(b.lng - a.lng);
  const h = Math.sin(dLat / 2) ** 2 +
    Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * 6371 * Math.asin(Math.sqrt(h));
}

// Vibración como mejora opcional: iOS/Safari no la soporta (detección de característica)
export function vibrar(patron = 200) {
  if ('vibrate' in navigator) navigator.vibrate(patron);
}
