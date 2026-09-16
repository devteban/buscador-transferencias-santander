import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parsearPaginaMovimientos } from '../src/parser.js';
import { paginaMovimientos, linea } from './fixtures/molde.js';

test('parsearPaginaMovimientos: extrae los cuatro campos del nucleo de una fila', () => {
  const lineas = paginaMovimientos([{}]); // una fila con los valores por defecto
  const { registros, anomalias } = parsearPaginaMovimientos(
    lineas, 5, 'extracto.pdf');
  assert.equal(anomalias.length, 0);
  assert.equal(registros.length, 1);
  const r = registros[0];
  assert.equal(r.pagina, 5);
  assert.equal(r.archivo, 'extracto.pdf');
  assert.equal(r.formato, 'movimientos');
  assert.equal(r.fila, 1);
  assert.equal(r.fechaOperacion, '2025-03-16');
  assert.equal(r.fechaOperacionTexto, '16/03/2025');
  assert.equal(r.fechaValor, '2025-03-17');
  assert.equal(r.ordenante, 'Ayuntamiento De Villarriba');
  assert.equal(r.concepto, 'Servicio 123');
  assert.equal(r.importe, 1234.56);
  assert.equal(r.importeTexto, '1.234,56');
  assert.equal(r.fechaEnvio, null);
  assert.equal(r.fechaEnvioTexto, null);
});

test('parsearPaginaMovimientos: varias filas dan varios registros con fila incremental', () => {
  const lineas = paginaMovimientos([
    { importe: '100,00' }, { importe: '200,00' }, { importe: '300,00' },
  ]);
  const { registros, anomalias } = parsearPaginaMovimientos(lineas, 1, 'a.pdf');
  assert.equal(anomalias.length, 0);
  assert.equal(registros.length, 3);
  assert.deepEqual(registros.map(r => r.fila), [1, 2, 3]);
  assert.deepEqual(registros.map(r => r.importe), [100, 200, 300]);
});

test('parsearPaginaMovimientos: fila sin la palabra Concepto no genera anomalia', () => {
  // Verificado contra el documento real: hay filas legitimas sin Concepto.
  const lineas = paginaMovimientos([
    { descripcion: 'Transferencia De Ayuntamiento De Villabajo' },
  ]);
  const { registros, anomalias } = parsearPaginaMovimientos(lineas, 1, 'a.pdf');
  assert.equal(anomalias.length, 0);
  assert.equal(registros[0].concepto, null);
  assert.equal(registros[0].ordenante, 'Ayuntamiento De Villabajo');
});

test('parsearPaginaMovimientos: ordenante con coma interna no se trunca', () => {
  // La regla corta por ", Concepto", nunca por la primera coma: hay
  // ordenantes reales con sufijos societarios que contienen comas.
  const lineas = paginaMovimientos([
    { descripcion: 'Transferencia De Empresa Ejemplo, S.L., Concepto Factura 9' },
  ]);
  const { registros } = parsearPaginaMovimientos(lineas, 1, 'a.pdf');
  assert.equal(registros[0].ordenante, 'Empresa Ejemplo, S.L.');
  assert.equal(registros[0].concepto, 'Factura 9');
});

test('parsearPaginaMovimientos: fila sin estructura "De ... Concepto" va entera al concepto', () => {
  // Un listado de movimientos puede traer filas que no sean transferencias
  // (comisiones, recibos): no se ancla la deteccion en la palabra
  // "Transferencia".
  const lineas = paginaMovimientos([{ descripcion: 'Comision mantenimiento cuenta' }]);
  const { registros, anomalias } = parsearPaginaMovimientos(lineas, 1, 'a.pdf');
  assert.equal(registros[0].ordenante, null);
  assert.equal(registros[0].concepto, 'Comision mantenimiento cuenta');
  assert.ok(anomalias.some(a => a.camposFaltantes.includes('ordenante')));
});

test('parsearPaginaMovimientos: importe negativo con signo delante y detras', () => {
  const lineas = paginaMovimientos([
    { importe: '-50,00' }, { importe: '75,00-' },
  ]);
  const { registros, anomalias } = parsearPaginaMovimientos(lineas, 1, 'a.pdf');
  assert.equal(anomalias.length, 0);
  assert.equal(registros[0].importe, -50);
  assert.equal(registros[1].importe, -75);
});

test('parsearPaginaMovimientos: fila con importe ilegible entra igual, con anomalia', () => {
  const lineas = paginaMovimientos([{ importe: 'texto-no-importe' }]);
  const { registros, anomalias } = parsearPaginaMovimientos(lineas, 3, 'a.pdf');
  assert.equal(registros.length, 1); // no desaparece
  assert.equal(registros[0].importe, null);
  assert.equal(anomalias.length, 1);
  assert.equal(anomalias[0].pagina, 3);
  assert.equal(anomalias[0].archivo, 'a.pdf');
  assert.equal(anomalias[0].fila, 1);
  assert.equal(anomalias[0].motivo, 'campos_incompletos');
  assert.deepEqual(anomalias[0].camposFaltantes, ['importe']);
});

test('parsearPaginaMovimientos: la cabecera y el titulo no se confunden con filas', () => {
  const lineas = paginaMovimientos([{}], { conCabecera: true });
  const { registros } = parsearPaginaMovimientos(lineas, 1, 'a.pdf');
  assert.equal(registros.length, 1); // solo la fila real, no titulo ni cabecera
});

test('parsearPaginaMovimientos: pagina sin ninguna fila da lista vacia sin anomalia de pagina', () => {
  const { registros, anomalias } = parsearPaginaMovimientos([], 1, 'a.pdf');
  assert.deepEqual(registros, []);
  assert.deepEqual(anomalias, []);
});

test('parsearPaginaMovimientos: campos de busqueda normalizados', () => {
  const lineas = paginaMovimientos([{
    descripcion: 'Transferencia De Ayuntamiento De Alcalá, Concepto Limpieza Viaria',
  }]);
  const { registros } = parsearPaginaMovimientos(lineas, 1, 'a.pdf');
  assert.equal(registros[0].ordenanteBusqueda, 'ayuntamiento de alcala');
  assert.equal(registros[0].conceptoBusqueda, 'limpieza viaria');
});

test('parsearPaginaMovimientos: segunda fecha ilegible no hace desaparecer la fila', () => {
  const lineas = [
    linea(700, 20, '16/03/2025', 90, 'FechaMal', 160, 'Descripcion', 600, '100,00'),
  ];
  const { registros, anomalias } = parsearPaginaMovimientos(lineas, 1, 'a.pdf');
  assert.equal(registros.length, 1); // no desaparece
  assert.equal(registros[0].fila, 1);
  assert.equal(registros[0].fechaOperacion, '2025-03-16');
  assert.equal(registros[0].fechaValor, null);
  assert.ok(anomalias.some(a => a.fila === 1 && a.camposFaltantes.includes('fechaValor')));
});

test('parsearPaginaMovimientos: ordenante con dos comas internas no se trunca', () => {
  const lineas = paginaMovimientos([
    { descripcion: 'Transferencia De Empresa, Ejemplo, S.L., Concepto Factura 1' },
  ]);
  const { registros } = parsearPaginaMovimientos(lineas, 1, 'a.pdf');
  assert.equal(registros[0].ordenante, 'Empresa, Ejemplo, S.L.');
  assert.equal(registros[0].concepto, 'Factura 1');
});

test('parsearPaginaMovimientos: fecha embebida en la descripcion no se confunde con el importe', () => {
  // Una referencia con forma de importe en medio del texto no debe tomarse
  // como el importe real: solo el ULTIMO token de la linea cuenta.
  const lineas = [
    linea(700, 20, '16/03/2025', 90, '17/03/2025', 160,
          'Transferencia De Ayuntamiento De Villarriba, Concepto Ref. 123,45 del contrato',
          600, '500,00'),
  ];
  const { registros } = parsearPaginaMovimientos(lineas, 1, 'a.pdf');
  assert.equal(registros[0].importe, 500);
  assert.ok(registros[0].concepto.includes('123,45'));
});
