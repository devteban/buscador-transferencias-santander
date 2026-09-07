# Buscador de transferencias en PDF — diseño

Fecha: 2026-09-07

## Problema

Extractos bancarios en PDF de más de 1500 páginas, con una transferencia
por página. Hoy no hay forma práctica de responder preguntas como "todas
las transferencias de este ordenante entre 100 y 500 euros con fecha valor
en 2025". El `Ctrl+F` del visor busca texto suelto, no permite combinar
criterios ni filtrar por rangos, y no produce una lista exportable.

Los PDF contienen datos confidenciales (nombres, IBAN, importes). Cualquier
solución que suba el archivo a un servicio externo queda descartada.

## Objetivo

Una herramienta local que se abre en el navegador sin instalar nada,
convierte el PDF en una tabla de transferencias y permite filtrarla
combinando criterios, ordenarla y exportar el resultado a CSV.

## Restricciones

- **Sin instalación.** Un único archivo `buscador.html`; doble clic y
  funciona. Sin servidor, sin Node, sin extensiones.
- **Sin red.** El archivo entregado no hace ninguna petición de red. El PDF
  se lee con la File API y nunca sale de la máquina.
- **Sin persistencia.** El PDF se carga en cada sesión. No se guarda índice
  ni caché entre aperturas. Nada queda escrito en disco salvo los CSV que
  el usuario exporte a propósito.
- **Sin OCR.** Los PDF tienen capa de texto extraíble. Confirmado en el
  sondeo: media de 2191 caracteres por página.
- **Confidencialidad durante el desarrollo.** Ningún dato real entra en el
  código, en los tests ni en la conversación de desarrollo. La estructura se
  obtuvo con `sondeo_estructura.py`, que enmascara los valores.

## Estructura del PDF de origen

Derivada del sondeo enmascarado (`sondeo.txt`), sobre una muestra de 3
páginas.

**Una página equivale a una transferencia.** Cada página es una "ORDEN DE
TRANSFERENCIA" autocontenida. No hay registros partidos entre páginas.

Molde, en tres columnas:

```
                                    Oficina: <oficina>
                                    Fecha de envío: dd-mm-aaaa
TRANSFERENCIAS RECIBIDAS -  ORDEN DE TRANSFERENCIA

  ORDENANTE                IMPORTE                      BENEFICIARIO
  <ordenante>       >>   <n.nnn,nn> EUR       >>   <beneficiario>
  <...sigue ordenante>
  POR CUENTA DE: <...>     Importe origen: ... EUR      IBAN: ESnn nnnn ...
  Entidad: <entidad>       Cambio aplicado origen: ...  Titular: <titular>
                           Gastos deducidos origen: ... Último Beneficiario: <...>
                           Importe recibido: ... EUR
                           Importe pendiente: ...
                           Importe liquidado bruto: ... EUR
                           Contravalor: ... EUR
                           GASTOS POR CUENTA DE: <...>
                           TOTAL NUESTROS GASTOS : ... EUR
  CONCEPTO:
  <1 a 3 líneas libres>

 Refª Origen: <...> / Nuestra Refª: <...>Fecha operación: dd-mm-aaaa / Fecha valor: dd-mm-aaaa
```

Cuatro particularidades que condicionan el parser:

1. **Ocho importes por página.** El principal (tras el primer `>>`) más
   *origen, recibido, pendiente, liquidado bruto, contravalor, gastos
   deducidos origen* y *total nuestros gastos*. Cada importe debe anclarse a
   su etiqueta; buscar "un número seguido de EUR" devuelve el equivocado.
2. **`Nuestra Refª` y `Fecha operación` van pegadas sin espacio**
   (`...123456Fecha operación:`). Hay que cortar por la etiqueta, nunca por
   separación de espacios.
3. **Las columnas se desplazan entre páginas** (hasta un carácter de
   diferencia en la muestra). Queda descartado parsear por posición fija.
4. **El concepto contiene fechas** en formatos `dd.mm.aaaa` y `dd/mm/aaaa`,
   mientras los campos de fecha usan `dd-mm-aaaa`. El separador distinto
   permite distinguirlos de forma fiable.

**Limitación conocida de la muestra:** solo se analizaron 3 páginas, todas
transferencias recibidas del mismo tipo. En 1500 páginas es previsible
encontrar variantes no observadas: importes con separador de miles,
ordenantes de tres o más líneas, conceptos más largos, campos hoy vacíos
(`POR CUENTA DE:`, `Refª Origen:`, `Último Beneficiario:`) con contenido, o
páginas de otro tipo. El diseño asume esto y lo trata en "Páginas que no
encajan".

## Arquitectura

```
buscador.html  <-- build.js --+-- vendor/pdf.js    (descargado una vez)
(entregable,                  +-- src/parser.js    (lógica pura)
 doble clic)                  +-- src/ui.js        (interfaz)
                                     ^
                              test/parser.test.js  (node --test)
```

La frontera central: **`parser.js` no conoce PDF.js ni el DOM**. Recibe
líneas de texto con coordenadas y devuelve registros o anomalías. Toda la
lógica de extracción queda así testeable sin PDF y sin navegador, que es lo
que permite probarla a fondo con datos inventados sin tocar datos reales.

`build.js` concatena las tres piezas en un `buscador.html` autocontenido. Se
ejecuta con `node build.js`; no requiere `npm install`, porque `node:test` y
`fs` bastan. El usuario final nunca ejecuta el build.

PDF.js se descarga una sola vez desde cdnjs a `vendor/`. Requiere red en ese
momento y nunca más. Se usa la build *legacy* UMD, que expone un global y
puede embeberse en línea.

**Incógnita a despejar antes de implementar:** si PDF.js puede operar bajo
`file://` sin worker. Es lo que hace viable el archivo único. Si la versión
elegida no lo permite, las salidas son la build *legacy* con
`disableWorker`, o arrancar el worker desde un `Blob` URL (que hereda origen
y funciona bajo `file://`). Esta decisión no altera el resto del diseño.

## Parser

### Paso 1 — Reconstruir líneas

`getTextContent()` devuelve fragmentos sueltos con matriz de
transformación. Se agrupan por coordenada Y con tolerancia (la mitad de la
altura de fuente del fragmento, mínimo 2 unidades), y dentro de cada línea
se ordenan por X.

Cada línea conserva sus fragmentos con la X de origen:

```js
{ y: 712.4, texto: "...", fragmentos: [ { x: 56.7, texto: "..." }, ... ] }
```

El texto de la línea se compone insertando un espacio cuando el hueco entre
el final de un fragmento y el comienzo del siguiente supera el ancho
aproximado de un espacio en esa fuente.

La X debe conservarse: es lo que permite separar la columna izquierda de las
demás en las líneas de continuación del ordenante.

### Paso 2 — Anclas

Dos anclas que el molde garantiza:

- **La línea del `>>`.** Tiene la forma
  `<ordenante> >> <importe> EUR >> <beneficiario>`. Además, la X del primer
  `>>` define el borde derecho de la columna izquierda **calculado en esa
  página concreta**, lo que neutraliza el desplazamiento entre páginas.
- **`CONCEPTO:`**, que ocupa su propia línea.

### Paso 3 — Extracción

| Campo | Regla |
|---|---|
| Ordenante | texto a la izquierda del primer `>>`, más las líneas siguientes cuyos fragmentos caigan a la izquierda del borde calculado, hasta llegar a `POR CUENTA DE:` o `Entidad:` |
| Importe | texto entre el primer y el segundo `>>`, patrón `<número>,dd` seguido opcionalmente de código de moneda |
| Beneficiario | texto a la derecha del segundo `>>` |
| Concepto | líneas entre `CONCEPTO:` y la línea que contiene `Fecha operación:` (excluida), descartando vacías y unidas con espacio. Si hay texto en la propia línea de `CONCEPTO:`, se incluye |
| Fecha operación | tras la etiqueta `Fecha operación:`, patrón `dd-mm-aaaa` |
| Fecha valor | tras la etiqueta `Fecha valor:`, patrón `dd-mm-aaaa` |
| Fecha envío | tras la etiqueta `Fecha de envío:`, patrón `dd-mm-aaaa` |

Delimitar el concepto por `Fecha operación:` en lugar de por `Refª Origen:`
evita depender del carácter `ª`, que puede llegar fragmentado, y evita
confundirlo con `Importe origen:`.

El resto de campos (IBAN, titular, entidad, oficina, los siete importes
secundarios, referencias, `POR CUENTA DE`, último beneficiario) se extraen
también por etiqueta, con la misma técnica. El coste marginal es nulo y
evita reprocesar si algún día hacen falta.

### Paso 4 — Normalización

- **Importes:** `1.234,56` se convierte a `1234.56` como número, para poder
  filtrar por rango. Se conserva además el texto original para mostrarlo tal
  como aparece en el PDF.
- **Fechas:** `dd-mm-aaaa` se convierte a `aaaa-mm-dd` internamente, para
  ordenar y comparar rangos. Se muestran en su formato original.
- **Texto:** se guarda una copia en minúsculas y sin diacríticos
  (normalización NFD y eliminación de marcas) para las búsquedas, de modo
  que `operacion` encuentre `OPERACIÓN` y `alojamiento` encuentre
  `ALOJAMIENTO`.

### Registro resultante

```js
{
  pagina: 12,
  ordenante: "...",       ordenanteBusqueda: "...",
  importe: 345.0,         importeTexto: "345,00",   moneda: "EUR",
  concepto: "...",        conceptoBusqueda: "...",
  fechaOperacion: "2025-02-03", fechaOperacionTexto: "03-02-2025",
  fechaValor: "...",            fechaValorTexto: "...",
  fechaEnvio: "...",            fechaEnvioTexto: "...",
  extra: { iban, titular, beneficiario, entidad, oficina, ... }
}
```

## Páginas que no encajan

Requisito, no extra. Una página se acepta si contiene el marcador
`ORDEN DE TRANSFERENCIA` y el parser obtiene los seis campos del núcleo
(ordenante, importe, concepto y las tres fechas; el número de página no se
extrae, se conoce). En caso contrario **no se descarta en silencio**: se
registra una anomalía.

```js
{ pagina: 47, camposFaltantes: ["importe"], motivo: "campos_incompletos" }
```

Motivos: `sin_texto` (página sin capa de texto, probable escaneo),
`sin_marcador` (no es una orden de transferencia), `campos_incompletos`,
`error_parser` (excepción no prevista).

La interfaz muestra un panel plegado: *"37 páginas no encajaron en el
molde"*, con la lista de números de página y el campo que falló. **Solo
números de página y nombres de campo, nunca contenido.** Este panel es el
canal por el que se descubren y corrigen variantes del molde sin que nadie
tenga que enseñar datos reales.

**Una anomalía no implica perder el registro.** Una página con motivo
`campos_incompletos` o `error_parser` entra igualmente en la tabla, con los
campos que sí se pudieron extraer y los demás vacíos, y además aparece
listada en el panel. Así un fallo en un solo campo no oculta una
transferencia que quizá era la buscada. Solo `sin_texto` y `sin_marcador`
no producen fila, porque no hay nada que mostrar.

Una excepción al parsear una página nunca aborta el proceso: se anota como
anomalía y se continúa.

## Interfaz

Flujo: cargar (arrastrar o seleccionar archivo) → barra de progreso
*"página 340 de 1500"* → tabla.

La extracción se hace **por lotes de 25 páginas**, cediendo el control al
navegador entre lotes, de modo que la barra avanza y la interfaz responde.
Estimación para 1500 páginas: entre 20 segundos y un minuto. A partir de
ahí, filtrar es instantáneo porque los registros están en memoria.

**Columnas visibles por defecto (el núcleo):** página, ordenante, importe,
concepto, fecha operación, fecha valor, fecha envío. El resto de campos
extraídos queda disponible en un selector de columnas.

**Filtros**, todos combinables y aplicados en vivo mientras se escribe:

- Ordenante — contiene, sin distinguir mayúsculas ni acentos
- Concepto — contiene, sin distinguir mayúsculas ni acentos
- Importe — mínimo y máximo
- Fecha operación, fecha valor, fecha envío — desde y hasta, cada una

El filtro de importe opera sobre el importe principal, el que sigue al
primer `>>`, no sobre los secundarios.

Contador de resultados siempre visible. Orden inicial por número de página,
que es el orden del PDF; se cambia haciendo clic en cualquier cabecera.
Botón de limpiar filtros.

**Exportar CSV:** las filas actualmente filtradas, con las columnas
actualmente visibles. Lo que se ve es lo que se exporta. Separador `;` y BOM
UTF-8, que es lo que Excel en español abre correctamente de doble clic; con
coma y sin BOM, Excel colapsa todo en una columna y rompe los acentos. La
descarga se genera con un `Blob` local.

Las filas se renderizan directamente, sin virtualización: con 1500 registros
el DOM va sobrado. Si en el futuro fueran decenas de miles, habría que
añadirla; no se construye ahora.

## Errores

| Situación | Comportamiento |
|---|---|
| PDF protegido con contraseña | Se pide la contraseña y se reintenta |
| El archivo no es un PDF | Mensaje claro, sin traza técnica |
| Página sin capa de texto | Anomalía `sin_texto`, avisando de posible escaneo |
| Excepción parseando una página | Anomalía `error_parser`; el proceso continúa |
| PDF sin ninguna página válida | Aviso de que el molde no coincide, con el recuento por motivo |

## Pruebas

Los tests de `parser.js` corren con `node --test`, sin dependencias
externas, alimentados con **fixtures de texto escritos a mano con datos
inventados** que replican el molde y sus variantes:

- Ordenante de una, dos y tres líneas
- Concepto de una a cuatro líneas, y concepto en la misma línea que la
  etiqueta
- Importes con separador de miles (`1.234,56`) y sin él
- Campos opcionales vacíos
- Columnas desplazadas respecto a la página anterior
- Fechas dentro del concepto, que no deben confundirse con los campos de
  fecha
- Una página sin el marcador, que debe aparecer como anomalía y no
  desaparecer
- Una página con el marcador pero sin importe, que debe dar
  `campos_incompletos`

Ningún test lee el PDF real. La verificación final la hace el usuario:
abre la herramienta con el PDF de 1500 páginas y comprueba el panel de
anomalías. El recuento y los motivos son toda la información necesaria para
ajustar el parser.

## Fuera de alcance

- OCR de PDF escaneados
- Persistencia o caché del índice entre sesiones
- Renderizado de la página original junto a la tabla
- Virtualización de la tabla
- Edición o anotación del PDF
- Agregados y estadísticas (sumas, agrupaciones por ordenante)

## Entregables

| Archivo | Propósito |
|---|---|
| `buscador.html` | El entregable. Autocontenido, doble clic |
| `src/parser.js` | Lógica de extracción, sin DOM ni PDF.js |
| `src/ui.js` | Interfaz, filtros, tabla, exportación |
| `build.js` | Concatena todo en `buscador.html` |
| `test/parser.test.js` | Tests unitarios del parser |
| `test/fixtures/` | Moldes de texto con datos inventados |
| `sondeo_estructura.py` | Ya existe. Sondeo enmascarado, para volver a analizar la estructura si cambia el formato del banco |
