# Lotería Mexicana · salas QR

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
