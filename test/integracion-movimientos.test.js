import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { parsearPaginaAuto } from '../src/parser.js';

const paginas = JSON.parse(readFileSync(
  new URL('./fixtures/items-pdf-prueba-movimientos.json', import.meta.url)));

test('integracion movimientos: recorrido completo desde un PDF real hasta los registros', () => {
  assert.equal(paginas.length, 1);
  const { registros, anomalias } = parsearPaginaAuto(paginas[0], 1, 'prueba.pdf');

  // Una sola anomalia esperada: la fila 4 ("Comision mantenimiento cuenta")
  // se diseño a proposito SIN estructura "De ... Concepto", asi que le
  // falta el ordenante (campo del nucleo) y debe marcarse — pero sigue
  // apareciendo como registro, no desaparece (comprobado mas abajo).
  assert.equal(anomalias.length, 1);
  assert.equal(anomalias[0].archivo, 'prueba.pdf');
  assert.equal(anomalias[0].pagina, 1);
  assert.equal(anomalias[0].fila, 4);
  assert.equal(anomalias[0].motivo, 'campos_incompletos');
  assert.deepEqual(anomalias[0].camposFaltantes, ['ordenante']);
  assert.equal(registros.length, 5);

  assert.equal(registros[0].ordenante, 'Ayuntamiento De Villarriba');
  assert.equal(registros[0].concepto, 'Servicio 123');
  assert.equal(registros[0].importe, 1234.56);
  assert.equal(registros[0].fechaOperacion, '2025-01-10');
  assert.equal(registros[0].fechaValor, '2025-01-11');

  assert.equal(registros[1].ordenante, 'Ayuntamiento De Villabajo');
  assert.equal(registros[1].concepto, null); // sin "Concepto" en el molde

  assert.equal(registros[2].ordenante, 'Empresa Ejemplo, S.L.'); // coma interna
  assert.equal(registros[2].concepto, 'Factura 9');
  assert.equal(registros[2].importe, -50); // signo delante

  assert.equal(registros[3].ordenante, null); // sin "De", va todo a concepto
  assert.equal(registros[3].concepto, 'Comision mantenimiento cuenta');
  assert.equal(registros[3].importe, -75); // signo detras

  assert.equal(registros[4].importe, 980.5);

  for (const r of registros) {
    assert.equal(r.formato, 'movimientos');
    assert.equal(r.archivo, 'prueba.pdf');
    assert.equal(r.fechaEnvio, null);
  }
  assert.deepEqual(registros.map(r => r.fila), [1, 2, 3, 4, 5]);
});
