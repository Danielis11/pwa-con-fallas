# Parte B · Estudio de casos

## Caso 1 · Avisos de la presidencia municipal

**¿Local o push?** Push. Una notificación local la genera la propia app, y solo puede hacerlo mientras está abierta. Un aviso push lo manda el servidor y lo recibe el **service worker** aunque la app esté cerrada, porque el navegador despierta al SW cuando llega el mensaje.

**Flujo completo:**
1. El ciudadano toca «Activar avisos» y la app llama a `Notification.requestPermission()`. Se pide con un gesto del usuario, no al cargar.
2. Si responde `granted`, la app hace `registration.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: <clave pública VAPID> })`.
3. La suscripción (endpoint + claves) se envía al servidor con `POST /api/suscripciones` y se guarda en la base de datos.
4. Cuando hay un corte de agua, el servidor firma el mensaje con la clave **privada** VAPID y lo envía con `web-push` al servicio push del navegador (FCM, Mozilla, Apple).
5. El servicio entrega el mensaje al dispositivo y se dispara el evento `push` en el SW.
6. El SW lee el JSON y llama a `showNotification(titulo, { body, icon, data: { url } })`.
7. En `notificationclick` el SW abre la app o la enfoca en la página del aviso.
8. Si el servidor recibe 404 o 410, borra esa suscripción.

**iPhone:** Safari en iOS (16.4 o posterior) solo permite push si la PWA está **instalada en la pantalla de inicio**. En el navegador normal no llegan los avisos, y en versiones viejas de iOS no hay soporte. Qué haría:
- Detectar iOS sin instalar y mostrar instrucciones de «Compartir › Agregar a inicio».
- Ofrecer un canal alterno: SMS, WhatsApp o correo.
- Mostrar los avisos vigentes en la propia app al abrirla (Network First), para que nadie se quede sin la información.

**Clave privada VAPID:** en el servidor, como variable de entorno (`VAPID_PRIVADA`) o en un gestor de secretos del hosting. Nunca en el repositorio: quien la tenga puede mandar notificaciones haciéndose pasar por la presidencia, y lo que se sube a Git queda en el historial aunque después se borre. Por eso `vapid.json` está en `.gitignore`. La clave **pública** sí puede ir al cliente.

## Caso 2 · Catálogo del vivero

**IndexedDB**, por dos características:
1. **Capacidad.** `localStorage` tiene un límite de unos 5 MB y solo guarda texto. 2 000 plantas con datos (y las fotos en Blob, si se quiere) no caben. IndexedDB permite cientos de MB, según el espacio del dispositivo.
2. **Consultas y rendimiento.** IndexedDB es asíncrona (no congela la interfaz) y guarda objetos con **índices**: se puede buscar por nombre, tipo o existencias sin cargar todo. `localStorage` es síncrono y obliga a guardar un solo JSON gigante y hacer `JSON.parse` completo en cada lectura.

**Estrategias de caché:**
- **Precios y existencias: Network First.** Cambian cada semana y un precio viejo hace perder dinero. Con señal se trae lo más nuevo; sin señal se usa la última copia guardada, mostrando la fecha («Precios actualizados al 10/11»).
- **Fotos: Cache First** (o Stale-While-Revalidate). Casi nunca cambian y son lo que más pesa. Servirlas desde la caché ahorra datos y carga al instante. Conviene limitar cuántas se guardan para no llenar el almacenamiento.
- **Por qué no la misma:** con Cache First para los precios se mostrarían precios viejos aunque haya red (la falla T03). Con Network First para las fotos se descargarían otra vez en cada visita, lento y caro con poca señal.

**Primera vez sin señal:** no hay nada guardado, así que no se pueden inventar datos. El **app shell** sí está en caché si la app se instaló antes con red. Debe ver una pantalla clara: «Necesitas conexión una vez para descargar el catálogo. Conéctate a Wi-Fi antes de ir a la feria». Si ni siquiera hay shell, el SW responde con `offline.html`. Además, conviene ofrecer un botón «Descargar catálogo para usar sin señal» que precargue todo cuando haya Wi-Fi.

## Caso 3 · Hotel que quiere aparecer en Google

**SSR y CSR:**
- **Pasaría a SSR** las páginas públicas que deben indexarse y mostrarse rápido: inicio, listado de habitaciones, ficha de cada habitación, ubicación y contacto. El HTML llega ya con el contenido, así que el buscador lo lee sin ejecutar JavaScript y en un celular lento la primera pantalla aparece pronto (mejor FCP/LCP).
- **Dejaría en CSR** lo privado o muy interactivo, que no necesita aparecer en Google: el calendario de disponibilidad, el proceso de reserva y pago, «Mis reservaciones» y el panel de administración.

**Hidratación:** el HTML generado en el servidor llega «estático». Después se descarga el JavaScript, que se engancha a ese HTML para agregarle eventos e interactividad sin volver a pintarlo. En la página de habitaciones la necesitan solo las partes interactivas: el selector de fechas, el carrusel de fotos, el botón «Reservar» y el cálculo del precio según noches y huéspedes. El texto, el precio base y la descripción no necesitan hidratarse (igual que en `ficha.js`, que solo hidrata el botón de distancia).

**SSR sin conexión:** el service worker intercepta las navegaciones con **Network First**. Cada página SSR que se abre con red se guarda en caché; sin red se devuelve esa copia. Si la página nunca se abrió, se responde `offline.html`. Los CSS y JS deben referirse con **rutas absolutas** (falla T05) y estar en caché, para que la copia se vea bien. Se pueden precachear las fichas principales en el `install`.

## Caso 4 · Encuestas de campo

**Guardar y enviar:**
1. Cada encuesta se guarda al momento en **IndexedDB** con un id único generado en el dispositivo (UUID), el id del encuestador, la fecha de modificación y `estado: 'pendiente'`. Nada se pierde si se cierra la app o se acaba la batería.
2. Al guardar se registra un **Background Sync** (`registration.sync.register('enviar-encuestas')`, con la misma etiqueta que escucha el SW, falla T07).
3. Cuando vuelve la señal, el evento `sync` del SW envía las pendientes. Solo marca `enviada` las que el servidor confirmó. Si alguna falla, la promesa se rechaza y el navegador **reintenta** después.
4. El servidor acepta envíos repetidos sin duplicar (usa el UUID como llave), por si un envío se corta a la mitad.

**¿Qué versión gana?** Regla propuesta: **«gana la última modificación»** (*last-write-wins*), comparando la fecha de edición de cada versión. Además, el servidor conserva la versión perdedora en un historial.
- **Desventaja:** se pueden perder datos válidos. Si un encuestador corrigió la edad y el otro el domicilio, solo queda uno de los dos cambios. También depende de que los relojes de los teléfonos estén bien.
- **Mejora:** fusionar por campo, o marcar el registro como «en conflicto» para que un supervisor decida.

**Sin Background Sync** (Safari y Firefox no lo tienen): la app detecta si existe (`'sync' in registration`). Si no, envía las pendientes:
- al abrir la app,
- en el evento `online`,
- con un botón «Enviar pendientes».

Además, muestra un contador de encuestas pendientes y avisa al encuestador que debe abrir la app con señal para que se envíen. Es lo que ya hace Ruta SG con `enviarPendientes()`.
