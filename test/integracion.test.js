// Prueba de integracion: recorre el camino completo desde los fragmentos de
// texto de un PDF real (items-pdf-prueba.json, generado a partir del PDF
// sintetico de test/fixtures/generar_pdf_prueba.py) hasta el registro final,
// pasando por agruparEnLineas y parsearPagina. A diferencia del resto de
// tests, que usan fixtures escritos a mano (test/fixtures/molde.js), esta
// prueba parte de coordenadas reales extraidas del PDF, y por eso habria
// detectado por si sola los defectos que ya han aparecido en este proyecto.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { agruparEnLineas, parsearPagina } from '../src/parser.js';

const paginas = JSON.parse(
  readFileSync(new URL('./fixtures/items-pdf-prueba.json', import.meta.url)));

const ESPERADO = [
  {
    ordenante: 'AYUNTAMIENTO DE VILLARRIBA',
    importe: 345,
    importeTexto: '345,00',
    fechaOperacion: '2025-02-03',
    fechaValor: '2025-02-04',
    fechaEnvio: '2025-02-05',
  },
  {
    ordenante: 'AYUNTAMIENTO DE VILLABAJO DE LOS MONTES',
    importe: 12345.67,
    importeTexto: '12.345,67',
    fechaOperacion: '2025-03-10',
    fechaValor: '2025-03-11',
    fechaEnvio: '2025-03-12',
  },
  {
    ordenante: 'MANCOMUNIDAD DE MUNICIPIOS DE LA COMARCA DEL NORTE',
    importe: 980.5,
    importeTexto: '980,50',
    fechaOperacion: '2025-04-18',
    fechaValor: '2025-04-19',
    fechaEnvio: '2025-04-20',
  },
];

test('integracion: las tres paginas del PDF de prueba se parsean sin anomalia', () => {
  paginas.forEach((items, i) => {
    const lineas = agruparEnLineas(items);
    const { registro, anomalia } = parsearPagina(lineas, i + 1);
    assert.equal(anomalia, null, `pagina ${i + 1}: ${JSON.stringify(anomalia)}`);
    const e = ESPERADO[i];
    assert.equal(registro.ordenante, e.ordenante, `pagina ${i + 1}: ordenante`);
    assert.equal(registro.importe, e.importe, `pagina ${i + 1}: importe`);
    assert.equal(registro.importeTexto, e.importeTexto, `pagina ${i + 1}: importeTexto`);
    assert.equal(registro.fechaOperacion, e.fechaOperacion, `pagina ${i + 1}: fechaOperacion`);
    assert.equal(registro.fechaValor, e.fechaValor, `pagina ${i + 1}: fechaValor`);
    assert.equal(registro.fechaEnvio, e.fechaEnvio, `pagina ${i + 1}: fechaEnvio`);
  });
});

test('integracion: concepto de la pagina 2 (tres lineas)', () => {
  const lineas = agruparEnLineas(paginas[1]);
  const { registro } = parsearPagina(lineas, 2);
  assert.equal(registro.concepto,
    'ALOJAMIENTO Y ALIMENTACION DE ANIMALES RECOGIDOS EN VIA PUBLICA');
});

test('integracion: fechas dentro del concepto de la pagina 3 no se confunden con campos', () => {
  const lineas = agruparEnLineas(paginas[2]);
  const { registro } = parsearPagina(lineas, 3);
  assert.ok(registro.concepto.includes('15.01.2025'));
  assert.ok(registro.concepto.includes('01/01/2025'));
  assert.equal(registro.fechaOperacion, '2025-04-18');
});

test('integracion: extra.iban de la pagina 1', () => {
  const lineas = agruparEnLineas(paginas[0]);
  const { registro } = parsearPagina(lineas, 1);
  assert.equal(registro.extra.iban, 'ES00 1111 2222 3333 4444 5555');
});
