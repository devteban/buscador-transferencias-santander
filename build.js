// Concatena PDF.js vendorizado, estilos y fuentes en un unico
// buscador.html autocontenido. Sin bundler: los fuentes usan `export`
// para poder testearse con node --test, y aqui se elimina esa palabra
// para que valgan como script clasico.
import { readFileSync, writeFileSync, existsSync } from 'node:fs';

const VENDOR = ['vendor/pdf.min.js', 'vendor/pdf.worker.min.js'];
for (const f of VENDOR) {
  if (!existsSync(f)) {
    console.error(`Falta ${f}. Descargalo con:
  curl -fSL -o ${f} https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/${f.split('/')[1]}`);
    process.exit(1);
  }
}

const leer = f => readFileSync(f, 'utf8');
const sinExport = f => leer(f).replace(/^export /gm, '');
// Defensa contra `</script` dentro de una cadena del JS minificado: si
// apareciera, cerraria la etiqueta y romperia el HTML en silencio.
const escaparScript = js => js.replace(/<\/script/gi, '<\\/script');

const html = `<!doctype html>
<html lang="es">
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Buscador de transferencias</title>
<style>
${leer('src/estilos.css')}
</style>
<body>
<div id="app"></div>
<script>${escaparScript(leer('vendor/pdf.min.js'))}</script>
<script>${escaparScript(leer('vendor/pdf.worker.min.js'))}</script>
<script>${escaparScript(sinExport('src/parser.js'))}</script>
<script>${escaparScript(sinExport('src/ui.js'))}</script>
</body>
</html>
`;

writeFileSync('buscador.html', html);
const kb = Math.round(Buffer.byteLength(html) / 1024);
console.log(`buscador.html generado (${kb} KB)`);
