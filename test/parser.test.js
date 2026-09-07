import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  normalizarImporte, normalizarFecha, normalizarTexto,
} from '../src/parser.js';

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
