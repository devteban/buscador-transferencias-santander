import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  normalizarImporte, normalizarFecha, normalizarTexto, agruparEnLineas,
  parsearPagina,
} from '../src/parser.js';
import { item, paginaMolde } from './fixtures/molde.js';

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

test('agruparEnLineas: fuentes de distinto tamano en la misma linea', () => {
  // Un fragmento grande y uno pequeno que visualmente comparten linea.
  const items = [item(10, 700, 'GRANDE', 20), item(80, 696, 'peq', 4)];
  assert.equal(agruparEnLineas(items).length, 1);
});

test('agruparEnLineas: deriva vertical acumulada no parte la linea', () => {
  // Cada salto es de 1 unidad, muy por debajo de la tolerancia, pero el
  // total entre extremos (5) la supera.
  const items = [
    item(10, 700, 'A'), item(40, 701, 'B'), item(70, 702, 'C'),
    item(100, 703, 'D'), item(130, 704, 'E'), item(160, 705, 'F'),
  ];
  const lineas = agruparEnLineas(items);
  assert.equal(lineas.length, 1);
  assert.equal(lineas[0].fragmentos.length, 6);
});

test('agruparEnLineas: el resultado no depende del orden de entrada', () => {
  const base = [
    item(10, 700, 'A'), item(60, 700, 'B'),
    item(10, 680, 'C'), item(60, 680, 'D'),
  ];
  const barajado = [base[2], base[1], base[3], base[0]];
  const a = agruparEnLineas(base).map(l => l.texto);
  const b = agruparEnLineas(barajado).map(l => l.texto);
  assert.deepEqual(a, b);
  assert.deepEqual(a, ['A B', 'C D']);
});

test('parsearPagina: extrae los seis campos del nucleo', () => {
  const { registro, anomalia } = parsearPagina(paginaMolde(), 12);
  assert.equal(anomalia, null);
  assert.equal(registro.pagina, 12);
  assert.equal(registro.ordenante, 'AYUNTAMIENTO DE VILLARRIBA');
  assert.equal(registro.importe, 345);
  assert.equal(registro.importeTexto, '345,00');
  assert.equal(registro.moneda, 'EUR');
  assert.equal(registro.concepto, 'ALOJAMIENTO Y ALIMENTACION');
  assert.equal(registro.fechaOperacion, '2025-02-03');
  assert.equal(registro.fechaValor, '2025-02-04');
  assert.equal(registro.fechaEnvio, '2025-02-05');
  assert.equal(registro.fechaOperacionTexto, '03-02-2025');
});

test('parsearPagina: ordenante de dos y tres lineas', () => {
  const dos = parsearPagina(paginaMolde({
    ordenante: ['AYUNTAMIENTO DE VILLARRIBA', 'DE LOS MONTES'],
  }), 1).registro;
  assert.equal(dos.ordenante, 'AYUNTAMIENTO DE VILLARRIBA DE LOS MONTES');

  const tres = parsearPagina(paginaMolde({
    ordenante: ['MANCOMUNIDAD DE MUNICIPIOS', 'DE LA COMARCA', 'DEL NORTE'],
  }), 1).registro;
  assert.equal(tres.ordenante,
    'MANCOMUNIDAD DE MUNICIPIOS DE LA COMARCA DEL NORTE');
});

test('parsearPagina: concepto de varias lineas se une con espacios', () => {
  const r = parsearPagina(paginaMolde({
    concepto: ['ALOJAMIENTO Y ALIMENTACION', 'DE ANIMALES', 'ENERO 2025'],
  }), 1).registro;
  assert.equal(r.concepto,
    'ALOJAMIENTO Y ALIMENTACION DE ANIMALES ENERO 2025');
});

test('parsearPagina: concepto en la misma linea que la etiqueta', () => {
  const r = parsearPagina(paginaMolde({
    conceptoPegado: true,
    concepto: ['REPARACION DE VALLADO PERIMETRAL'],
  }), 1).registro;
  assert.equal(r.concepto, 'REPARACION DE VALLADO PERIMETRAL');
});

test('parsearPagina: concepto de cuatro lineas', () => {
  const r = parsearPagina(paginaMolde({
    concepto: ['ALOJAMIENTO Y ALIMENTACION', 'DE ANIMALES', 'RECOGIDOS EN',
               'VIA PUBLICA'],
  }), 1).registro;
  assert.equal(r.concepto,
    'ALOJAMIENTO Y ALIMENTACION DE ANIMALES RECOGIDOS EN VIA PUBLICA');
});

test('parsearPagina: las fechas dentro del concepto no se confunden con campos', () => {
  const r = parsearPagina(paginaMolde({
    concepto: ['FACTURA FECHA 15.01.2025', 'PERIODO 01/01/2025 A 31/01/2025'],
    fechaOperacion: '03-02-2025',
  }), 1).registro;
  assert.equal(r.fechaOperacion, '2025-02-03');
  assert.ok(r.concepto.includes('15.01.2025'));
  assert.ok(r.concepto.includes('01/01/2025'));
});

test('parsearPagina: importe con separador de miles', () => {
  const r = parsearPagina(paginaMolde({ importe: '12.345,67' }), 1).registro;
  assert.equal(r.importe, 12345.67);
  assert.equal(r.importeTexto, '12.345,67');
});

test('parsearPagina: coge el importe del marcador, no los secundarios', () => {
  // El molde incluye "Importe origen: 345,00" y "Contravalor: 345,00".
  const r = parsearPagina(paginaMolde({ importe: '999,99' }), 1).registro;
  assert.equal(r.importe, 999.99);
});

test('parsearPagina: columnas desplazadas siguen parseando bien', () => {
  const r = parsearPagina(paginaMolde({
    desplazamiento: -8,
    ordenante: ['AYUNTAMIENTO DE VILLABAJO', 'DE LA SIERRA'],
  }), 1).registro;
  assert.equal(r.ordenante, 'AYUNTAMIENTO DE VILLABAJO DE LA SIERRA');
  assert.equal(r.importe, 345);
});

test('parsearPagina: campos de busqueda normalizados', () => {
  const r = parsearPagina(paginaMolde({
    ordenante: ['AYUNTAMIENTO DE ALCALÁ'],
    concepto: ['ALOJAMIENTO Y ALIMENTACIÓN'],
  }), 1).registro;
  assert.equal(r.ordenanteBusqueda, 'ayuntamiento de alcala');
  assert.equal(r.conceptoBusqueda, 'alojamiento y alimentacion');
});

test('parsearPagina: pagina sin marcador es anomalia y no da registro', () => {
  const { registro, anomalia } = parsearPagina(
    paginaMolde({ conMarcador: false }), 7);
  assert.equal(registro, null);
  assert.equal(anomalia.pagina, 7);
  assert.equal(anomalia.motivo, 'sin_marcador');
});

test('parsearPagina: pagina vacia es anomalia sin_texto', () => {
  const { registro, anomalia } = parsearPagina([], 3);
  assert.equal(registro, null);
  assert.equal(anomalia.motivo, 'sin_texto');
});

test('parsearPagina: falta un campo pero el registro se conserva', () => {
  // Requisito del spec: una anomalia de campo no puede ocultar la fila.
  const { registro, anomalia } = parsearPagina(
    paginaMolde({ importe: null }), 47);
  assert.notEqual(registro, null);
  assert.equal(registro.importe, null);
  assert.equal(registro.ordenante, 'AYUNTAMIENTO DE VILLARRIBA');
  assert.equal(anomalia.motivo, 'campos_incompletos');
  assert.deepEqual(anomalia.camposFaltantes, ['importe']);
});

test('parsearPagina: importe en formato no espanol cuenta como faltante', () => {
  const { registro, anomalia } = parsearPagina(
    paginaMolde({ importe: '1 234,56' }), 5);
  assert.equal(registro.importe, null);
  assert.deepEqual(anomalia.camposFaltantes, ['importe']);
});

test('parsearPagina: una etiqueta de fecha dentro del concepto no suplanta a la del pie', () => {
  // El escenario peligroso de verdad: la etiqueta literal, con una fecha en
  // el formato que el parser SI acepta.
  const { registro: r } = parsearPagina(paginaMolde({
    concepto: ['PAGO SEGUN Fecha operación: 09-09-2099 ACORDADA'],
    fechaOperacion: '03-02-2025',
  }), 1);
  assert.equal(r.fechaOperacion, '2025-02-03');
  assert.ok(r.concepto.includes('09-09-2099'));
});

test('parsearPagina: sin etiquetas de cierre, el ordenante no arrastra el concepto', () => {
  const lineas = paginaMolde().filter(
    l => !l.texto.includes('POR CUENTA DE:') && !l.texto.includes('Entidad:'));
  const { registro: r } = parsearPagina(lineas, 1);
  assert.equal(r.ordenante, 'AYUNTAMIENTO DE VILLARRIBA');
  assert.ok(!r.ordenante.includes('CONCEPTO'));
  assert.ok(!r.ordenante.includes('Refª'));
});

test('parsearPagina: con una sola marca >> no se inventa importe ni ordenante', () => {
  const lineas = paginaMolde().map(l => {
    const marcas = l.fragmentos.filter(f => f.texto.includes('>>'));
    if (marcas.length < 2) return l;
    const frags = l.fragmentos.filter(f => f !== marcas[1]);
    return { ...l, fragmentos: frags, texto: frags.map(f => f.texto).join(' ') };
  });
  const { registro: r, anomalia: a } = parsearPagina(lineas, 9);
  assert.equal(r.importe, null);
  assert.equal(r.ordenante, null);
  assert.equal(a.motivo, 'campos_incompletos');
});

test('parsearPagina: rellena los campos secundarios en extra', () => {
  const r = parsearPagina(paginaMolde(), 1).registro;
  assert.equal(r.extra.beneficiario, 'EMPRESA EJEMPLO SL');
  assert.equal(r.extra.iban, 'ES00 1111 2222 3333 4444 5555');
  assert.equal(r.extra.titular, 'EMPRESA EJEMPLO SL');
  assert.equal(r.extra.entidad, 'BANCO EJEMPLO, S.A.');
  assert.equal(r.extra.importeOrigen, 345);
  assert.equal(r.extra.contravalor, 345);
});

test('parsearPagina: extra ausente no rompe el nucleo', () => {
  const lineas = paginaMolde().filter(l => !l.texto.includes('IBAN:'));
  const { registro, anomalia } = parsearPagina(lineas, 1);
  assert.equal(anomalia, null);
  assert.equal(registro.extra.iban, undefined);
  assert.equal(registro.importe, 345);
});
