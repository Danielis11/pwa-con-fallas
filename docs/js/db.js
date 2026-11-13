// Capa de datos locales con IndexedDB.
// Es un script "clásico" (no módulo) a propósito: lo cargan la página (<script src>) y
// el Service Worker (importScripts) — así ambos comparten exactamente la misma base.
const RutaDB = (() => {
  const NOMBRE = 'rutaSG';
  const VERSION = 1;

  // Abre (o crea) la base. onupgradeneeded solo corre la primera vez o al subir VERSION.
  function abrir() {
    return new Promise((resolve, reject) => {
      const peticion = indexedDB.open(NOMBRE, VERSION);
      peticion.onupgradeneeded = e => {
        const db = e.target.result;
        db.createObjectStore('destinos', { keyPath: 'id' });
        const resenas = db.createObjectStore('resenas', { keyPath: 'id', autoIncrement: true });
        resenas.createIndex('estado', 'estado');
      };
      peticion.onsuccess = e => resolve(e.target.result);
      peticion.onerror = e => reject(e.target.error);
    });
  }

  // Ejecuta una operación dentro de una transacción y la convierte en promesa
  async function operar(almacen, modo, accion) {
    const db = await abrir();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(almacen, modo);
      const resultado = accion(tx.objectStore(almacen));
      tx.oncomplete = () => resolve(resultado && 'result' in resultado ? resultado.result : undefined);
      tx.onerror = () => reject(tx.error);
    });
  }

  return {
    // --- Catálogo de destinos (copia local de los datos remotos) ---
    guardarDestinos(lista) {
      return operar('destinos', 'readwrite', store => { lista.forEach(d => store.put(d)); });
    },
    leerDestinos() {
      return operar('destinos', 'readonly', store => store.getAll());
    },

    // --- Reseñas escritas por el turista (pueden quedar pendientes sin red) ---
    agregarResena(resena) {
      return operar('resenas', 'readwrite', store => store.add({ ...resena, estado: 'pendiente' }));
    },
    leerResenas() {
      return operar('resenas', 'readonly', store => store.getAll());
    },
    leerPendientes() {
      return operar('resenas', 'readonly', store => store.index('estado').getAll('pendiente'));
    },
    marcarEnviada(id) {
      return operar('resenas', 'readwrite', store => {
        const peticion = store.get(id);
        peticion.onsuccess = () => store.put({ ...peticion.result, estado: 'enviada' });
      });
    },

    // Envía al servidor cada reseña pendiente; la usan la página y el evento 'sync' del SW.
    // Si una falla, lanza error para que Background Sync lo reintente más tarde.
    async sincronizarResenas() {
      const pendientes = await this.leerPendientes();
      for (const resena of pendientes) {
        const res = await fetch('api/resenas', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(resena),
        });
        if (!res.ok) throw new Error('El servidor respondió ' + res.status);
        await this.marcarEnviada(resena.id);
      }
      return pendientes.length;
    },
  };
})();
