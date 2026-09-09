# buscador-transferencias-santander

Buscador local para extractos bancarios en PDF de miles de páginas (órdenes
de transferencia recibidas, formato Santander). Convierte el PDF en una
tabla filtrable y exportable, entera en el navegador, sin ningún servidor ni
dependencia externa en tiempo de uso.

## Uso

Abre `buscador.html` con doble clic y suelta el PDF encima de la ventana.
Nada más que instalar, nada que configurar.

- El PDF **no sale de tu equipo**: se procesa entero en el navegador con
  PDF.js. `buscador.html` no hace ninguna petición de red — puedes
  comprobarlo en las herramientas de desarrollo del navegador, la pestaña
  Red se queda vacía.
- **No queda nada guardado al cerrar la pestaña.** Hay que volver a cargar
  el PDF en cada sesión. Es una decisión de diseño, no una limitación: así
  no hay ningún dato bancario persistido en disco, ni siquiera en el
  almacenamiento local del navegador.

## Qué hace

Una vez cargado el PDF, cada página que encaja en el molde de "orden de
transferencia" se convierte en una fila con estos campos: ordenante,
importe, concepto, fecha de operación, fecha valor y fecha de envío. Sobre
esa tabla:

- **Filtros combinables**: por texto de ordenante, texto de concepto, rango
  de importe y rango en cada una de las tres fechas. Se combinan con Y
  lógico y se aplican en tiempo real.
- **Ordenación por columna**: clic en la cabecera, clic de nuevo para
  invertir el sentido.
- **Selector de columnas**: además de las seis columnas principales hay
  columnas secundarias ocultas por defecto (beneficiario, IBAN, titular,
  entidad, oficina, nuestra referencia, importe origen, importe recibido,
  contravalor) que se activan desde el desplegable «Columnas» sin
  reprocesar el PDF — se extraen igualmente, solo no se muestran.
- **Exportar CSV**: exporta exactamente lo que está filtrado, ordenado y
  visible en ese momento (columnas ocultas no se incluyen). El CSV usa `;`
  como separador y BOM UTF-8 porque Excel en español, con `,` y sin BOM,
  mete todo en una sola columna y rompe los acentos.

## El panel de anomalías

Cada página del PDF que **no** encaja en el molde esperado —falta el
marcador de "orden de transferencia", falta algún campo del núcleo, la
página no tiene texto— se cuenta como anomalía en vez de intentar
adivinarse. El panel de anomalías, siempre visible junto a los resultados,
resume cuántas páginas hay por motivo y las lista con su número de página y
el nombre del campo que faltó.

Es, a propósito, el único canal para depurar el parser sin exponer datos:
solo enseña números de página y nombres de campo, nunca el contenido de la
página. Si el panel muestra anomalías, ese es el material a compartir para
ajustar el parser — nunca el PDF en sí.

## Desarrollo

```bash
# Descargar PDF.js (solo la primera vez; no se versiona, vendor/ está en .gitignore)
mkdir -p vendor
curl -fSL -o vendor/pdf.min.js \
  https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js
curl -fSL -o vendor/pdf.worker.min.js \
  https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js

node --test test/*.test.js   # 38 tests: test/parser.test.js + test/integracion.test.js
node build.js                 # genera buscador.html a partir de src/
```

PDF.js queda fijado en la **3.11.174**: es la última versión con build UMD.
De la 4 en adelante PDF.js solo distribuye módulos ES (`import`/`export`),
que el navegador rechaza cargar bajo el esquema `file://` por CORS. Eso
rompería el requisito de fichero único que se abre con doble clic —
subir de versión exigiría servir la app por HTTP, que es justo lo que este
proyecto evita.

### Regenerar los fixtures de prueba

El PDF de prueba (`pdf-prueba.pdf`) no se versiona — es un PDF, y
`.gitignore` excluye `*.pdf` sin excepción, también para los de prueba. Se
regenera así:

```bash
python3 test/fixtures/generar_pdf_prueba.py pdf-prueba.pdf
python3 test/fixtures/extraer_items.py pdf-prueba.pdf
```

- `generar_pdf_prueba.py` construye un PDF sintético que reproduce el
  molde de las órdenes de transferencia (mismas etiquetas, misma
  disposición en columnas) pero con datos completamente inventados.
- `extraer_items.py` extrae de ese PDF los fragmentos de texto con sus
  coordenadas, en la misma forma en que los entrega PDF.js en el
  navegador, y los vuelca a `test/fixtures/items-pdf-prueba.json`. Ese
  JSON sí se versiona y es lo que alimenta `test/integracion.test.js`; el
  PDF en sí no hace falta versionarlo porque el JSON ya contiene todo lo
  que el test necesita.

## Formatos aceptados

El parser es deliberadamente estricto, no permisivo:

- **Importes**: solo formato español completo, `1.234,56` o `12,34` (punto
  de millar opcional, coma decimal obligatoria con dos dígitos). Un importe
  en cualquier otro formato — `1234.56`, `1,234.56`, sin decimales — no se
  interpreta ni se fuerza: el campo queda vacío y la página se marca como
  anomalía por campo incompleto.
- **Fechas**: solo `dd-mm-aaaa` (con los separadores exactos y validando
  que el día exista en ese mes). Cualquier otro formato de fecha tiene el
  mismo destino: anomalía, no interpretación.

Esto es intencional: ante un dato ambiguo, la herramienta prefiere fallar
de forma visible en el panel de anomalías a arriesgarse a mostrar un
importe o una fecha equivocados en un extracto bancario.

## Confidencialidad

- `.gitignore` excluye `*.pdf` (cualquier extracto, real o de prueba) y
  `sondeo*.txt` (la salida del sondeo de estructura).
- Los tests usan datos completamente inventados: ningún fixture, ni el PDF
  de prueba ni el JSON de items, procede de un documento real.
- `sondeo_estructura.py` sirve para volver a analizar el molde si el banco
  cambia el formato del PDF, sin necesidad de compartir el extracto en
  claro: extrae el texto de unas pocas páginas, decide qué palabras son
  plantilla (se repiten en la mayoría de las páginas muestreadas: etiquetas,
  cabeceras, pies) y enmascara todo lo demás por clase de carácter (dígitos
  a `#`, mayúsculas a `X`, minúsculas a `x`), conservando solo la forma y la
  posición. Se usa así:

  ```bash
  python3 sondeo_estructura.py extracto.pdf > sondeo.txt
  ```

  Conviene revisar `sondeo.txt` antes de compartirlo o de mirarlo con
  detenimiento: si aparece alguna palabra que no debería haberse
  conservado, se puede forzar su máscara con `--ocultar PALABRA` o subir el
  `--umbral`.

## Documentación

- Diseño: `docs/superpowers/specs/2026-09-07-buscador-transferencias-pdf-design.md`
- Plan: `docs/superpowers/plans/2026-09-07-buscador-transferencias-pdf.md`
