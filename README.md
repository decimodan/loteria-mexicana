# Loteria Mexa · salas QR

Al abrir `/`, se genera una sala y un QR con su enlace (`/?sala=…`). Comparte **ese enlace**: abrir la página raíz sin él crea otra sala.

- Primer dispositivo que elige administrador: controla la baraja, escucha las cartas y consulta todos los cartones en el centro VAR.
- Jugadores: nombre y uno o dos cartones, cada uno con 16 cartas diferentes seleccionadas en orden de lectura. Solo consultan sus propios datos.
- Regla inicial: **cartón lleno**. El servidor comprueba cada cartón después de cada carta.
- Al detectar posibles ganadores, se pausa la baraja. El administrador ve la evidencia congelada y confirma o rechaza cada caso. Los empates se revisan por separado.
- Un ganador confirmado se anuncia a todos y termina la ronda. Nueva ronda barajea de nuevo, conserva los jugadores/cartones y limpia las revisiones.
- Los registros y cambios de cartones se bloquean después de la primera carta.

## Identidad y privacidad

La identidad utiliza una cookie HttpOnly, SameSite=Strict (Secure en HTTPS). La asignación de administrador es atómica en un Durable Object por sala y persiste al recargar. El puesto no se libera al cerrar la pestaña: vuelve desde el mismo navegador. Si se pierde la cookie, crea una sala nueva. No hay cuentas ni recuperación/transferencia del administrador todavía. Quien tenga el enlace puede elegir administrador si el puesto está libre.

El servidor no expone la baraja futura ni cartones ajenos a jugadores. `/var` usa la misma interfaz protegida por rol; no concede privilegios. El endpoint antiguo `/api/deck` está deshabilitado. Sin servidor disponible, se muestra un error y no se avanza la baraja localmente. La sincronización consulta el servidor cada 2 segundos con la pestaña visible.

## Desarrollo y validación

```sh
npm install
npm run check
npm run build
npx wrangler dev --port 8787
# En otra terminal:
npm run test:rooms
```

`astro dev` sirve para desarrollar la UI; las salas requieren el Worker y Durable Objects, por lo que la prueba integrada se hace con Wrangler. `TEST_ORIGIN` permite cambiar el destino del test (usar solo entorno de pruebas: crea salas y juega rondas).

El deploy se realiza automáticamente después de merge a `main`; no ejecutar deploy manual.

## Cartones físicos y PDF

En la sala, abre **Crear cartones físicos y descargar PDF**, elige de **1 a 100** y pulsa **Generar cartones**, después **Descargar PDF**. El PDF conserva el mismo lote al descargar de nuevo; generar otra vez crea un lote nuevo. Una página por cartón en papel Carta, a escala 100%, con 16 cartas llenando las casillas, número consecutivo (1, 2, 3…) y QR vectorial con margen blanco. Las cartas no se repiten en un cartón y no se repiten combinaciones dentro del lote (no se garantiza exclusividad entre lotes).

Desde una sala los QR apuntan a esa sala; puedes desmarcar **Vincular los QR a esta sala** para reutilizarlos en otras. `/cartones` también permite crear cartones reutilizables sin abrir una sala.

- **QR de sala**: escanear abre el registro del jugador con las 16 cartas cargadas. Escribe tu nombre y guarda. No asigna administrador ni registra automáticamente.
- **QR reutilizable**: escanear muestra el cartón y pide pegar el enlace de la sala; después confirma nombre y registro.
- Para un segundo cartón, escanea desde el mismo navegador donde guardaste el primero, o pega el enlace/código del QR en **Agregar cartón con QR** dentro del registro. Conserva el primero y respeta el máximo de dos.
- El número impreso viaja en el QR y se conserva en el registro, centro VAR y anuncio de ganador. La numeración empieza en 1 en cada lote; no es un identificador global ni un mecanismo de autenticación. Los QR anteriores sin número siguen funcionando con la numeración de registro. Al editar las cartas manualmente se pierde el número impreso para no asociarlo a un diseño diferente.
- El papel contiene únicamente marca **Loteria Mexa**, número de cartón, rejilla 4×4 y QR; las instrucciones quedan en la web, no en el cartón. Las imágenes se ajustan a la casilla completa sin recortar nombres o números.
- Los QR incluyen un formato `v1` con índices de un catálogo **inmutable** (`print-card-catalog-v1.json`). No reordenarlo: versiones futuras deben conservar la decodificación de cartones impresos. El QR contiene solo cartas y, opcionalmente, la sala; no contiene nombres, cookies ni permisos.
- El servidor sigue validando cada cartón y bloqueando registros/cambios durante la ronda. Los PDF se generan localmente; no se guardan lotes en el servidor. El enlace QR depende de que el dominio del sitio siga disponible.

Pruebas del generador, QR y PDF: `npm run test:print` (Node >=22.12). Las pruebas integradas de salas también registran un cartón generado desde su QR y comprueban que la evidencia VAR coincida.

El PDF sigue el estilo de cartón tradicional: márgenes blancos de 6.35 mm y separaciones de 2.12 mm entre cartas, sin marcos añadidos. La barra superior muestra el número a la izquierda, **Loteria Mexa** centrado y el QR a la derecha, conservando su zona blanca de seguridad. Imprime en papel Carta al100%, sin necesidad de impresión sin bordes.
