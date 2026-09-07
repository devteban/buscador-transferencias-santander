import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  normalizarImporte, normalizarFecha, normalizarTexto, agruparEnLineas,
} from '../src/parser.js';
import { item } from './fixtures/molde.js';

test('normalizarImporte: formato espanol con y sin miles', () => {
  assert.equal(normalizarImporte('345,00'), 345);
  assert.equal(normalizarImporte('1.234,56'), 1234.56);
  assert.equal(normalizarImporte('1.234.567,89'), 1234567.89);
  assert.equal(normalizarImporte('0,05'), 0.05);
});

test('normalizarImporte: tolera espacios y codigo de moneda alrededor', () => {
  assert.equal(normalizarImporte('  1.234,56 EUR '), 1234.56);
});

test('normalizarImporte: rechaza lo que no es formato espanol', () => {
  assert.equal(normalizarImporte('1,234.56'), null); // formato ingles
  assert.equal(normalizarImporte('1 234,56'), null); // miles con espacio
  assert.equal(normalizarImporte('1234'), null);     // sin decimales
  assert.equal(normalizarImporte(''), null);
  assert.equal(normalizarImporte(null), null);
  assert.equal(normalizarImporte('12 3,45'), null); // espacio interno
  assert.equal(normalizarImporte('1 2,34'), null);
  assert.equal(normalizarImporte('9 9,00'), null);
});

test('normalizarFecha: dd-mm-aaaa a ISO', () => {
  assert.equal(normalizarFecha('03-02-2025'), '2025-02-03');
  assert.equal(normalizarFecha('31-12-1999'), '1999-12-31');
});

test('normalizarFecha: rechaza otros separadores y fechas imposibles', () => {
  assert.equal(normalizarFecha('03/02/2025'), null);
  assert.equal(normalizarFecha('03.02.2025'), null);
  assert.equal(normalizarFecha('32-01-2025'), null);
  assert.equal(normalizarFecha('03-13-2025'), null);
  assert.equal(normalizarFecha(''), null);
});

test('normalizarTexto: minusculas y sin acentos', () => {
  assert.equal(normalizarTexto('OPERACIÓN'), 'operacion');
  assert.equal(normalizarTexto('Alojamiento Y Alimentación'),
                               'alojamiento y alimentacion');
  assert.equal(normalizarTexto('  espacios   colapsados '),
                               'espacios colapsados');
  assert.equal(normalizarTexto(null), '');
});

test('agruparEnLineas: agrupa por Y y ordena por X', () => {
  const items = [
    item(120, 700, 'DERECHA'),
    item(10, 700, 'IZQUIERDA'),
    item(10, 680, 'SEGUNDA'),
  ];
  const lineas = agruparEnLineas(items);
  assert.equal(lineas.length, 2);
  assert.deepEqual(lineas[0].fragmentos.map(f => f.texto),
                   ['IZQUIERDA', 'DERECHA']);
  assert.deepEqual(lineas[1].fragmentos.map(f => f.texto), ['SEGUNDA']);
});

test('agruparEnLineas: tolera micro-desviaciones de Y en la misma linea', () => {
  // PDF.js rara vez da Y identica para fragmentos de la misma linea.
  const items = [item(10, 700, 'A'), item(60, 700.4, 'B'), item(120, 699.6, 'C')];
  const lineas = agruparEnLineas(items);
  assert.equal(lineas.length, 1);
  assert.equal(lineas[0].fragmentos.length, 3);
});

test('agruparEnLineas: ordena las lineas de arriba abajo', () => {
  const items = [item(10, 100, 'PIE'), item(10, 700, 'CABECERA')];
  const lineas = agruparEnLineas(items);
  assert.equal(lineas[0].fragmentos[0].texto, 'CABECERA');
  assert.equal(lineas[1].fragmentos[0].texto, 'PIE');
});

test('agruparEnLineas: separa fragmentos con espacio al componer el texto', () => {
  const items = [item(10, 700, 'UNO'), item(60, 700, 'DOS')];
  assert.equal(agruparEnLineas(items)[0].texto, 'UNO DOS');
});

test('agruparEnLineas: descarta fragmentos vacios', () => {
  const items = [item(10, 700, 'A'), item(40, 700, '   '), item(60, 700, 'B')];
  assert.equal(agruparEnLineas(items)[0].fragmentos.length, 2);
});

test('agruparEnLineas: lista vacia da lista vacia', () => {
  assert.deepEqual(agruparEnLineas([]), []);
});
