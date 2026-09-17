import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  normalizarImporte, normalizarFecha, normalizarTexto, agruparEnLineas,
  parsearPagina, detectarFormato, tolerenciaAdaptativa, parsearPaginaAuto,
} from '../src/parser.js';
import { item, paginaMolde } from './fixtures/molde.js';

/** Construye los items en bruto (formato PDF.js) de una pagina de
 * transferencia minima, para probar parsearPaginaAuto sin pasar por
 * paginaMolde (que ya da lineas agrupadas, no items). */
function paginaMoldeItems() {
  return [
    item(20, 760, 'TRANSFERENCIAS RECIBIDAS -    ORDEN DE TRANSFERENCIA'),
    item(20, 740, 'Fecha de envío: 05-02-2025'),
    item(20, 720, 'AYUNTAMIENTO DE VILLARRIBA'),
    item(260, 720, '>>'),
    item(300, 720, '345,00  EUR'),
    item(520, 720, '>>'),
    item(560, 720, 'EMPRESA EJEMPLO SL'),
    item(20, 700, 'CONCEPTO:'),
    item(20, 688, 'Servicio de ejemplo 123'),
    item(20, 60, 'Refª Origen:   /   Nuestra Refª: 12345ABC678'
      + 'Fecha operación: 03-02-2025 / Fecha valor: 04-02-2025'),
  ];
}

/**
 * Construye los items EN BRUTO (formato PDF.js) de una pagina de listado de
 * movimientos, reproduciendo la geometria real: cada fila se reparte en dos
 * sub-alturas (salto 3.6, menor que la fuente) y las filas entre si quedan
 * separadas con un paso total de 13.8 (salto real "entre filas" de 10.2 +
 * el propio salto interno de 3.6 que ya se ha descontado dentro de la
 * fila). NO USA `paginaMovimientos` de la Task 3: esa devuelve lineas ya
 * agrupadas (el nivel correcto para probar `parsearPaginaMovimientos` en
 * aislamiento), pero aqui hace falta EN BRUTO porque `parsearPaginaAuto`
 * tiene que poder medir la tolerancia adaptativa antes de agrupar nada.
 */
function paginaMovimientosItems(filas, opciones = {}) {
  const o = { conCabecera: true, ...opciones };
  const items = [];
  let y = 760;
  if (o.conCabecera) {
    items.push(item(20, y, 'Movimientos cuenta desde 01/01/2025 hasta 31/12/2025'));
    y -= 20;
    items.push(
      item(20, y, 'Fecha Operacion'), item(90, y, 'Fecha Valor'),
      item(160, y, 'Concepto'), item(600, y, 'Importe'),
    );
    y -= 20;
  }
  for (const f of filas) {
    const o2 = {
      fechaOperacion: '16/03/2025', fechaValor: '17/03/2025',
      descripcion: 'Transferencia De Ayuntamiento De Villarriba, Concepto Servicio 123',
      importe: '1.234,56', ...f,
    };
    items.push(item(20, y, o2.fechaOperacion), item(90, y, o2.fechaValor));
    if (o2.descripcion) items.push(item(160, y - 3.6, o2.descripcion));
    if (o2.importe !== null) items.push(item(600, y - 3.6, o2.importe));
    y -= 13.8;
  }
  return items;
}

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

test('normalizarImporte: sin opciones, comportamiento identico al actual', () => {
  assert.equal(normalizarImporte('1.234,56'), 1234.56);
  assert.equal(normalizarImporte('-1.234,56'), null); // rechazado, como hoy
});

test('normalizarImporte: con permitirNegativo, acepta el signo delante', () => {
  assert.equal(normalizarImporte('-1.234,56', { permitirNegativo: true }), -1234.56);
  assert.equal(normalizarImporte('-345,00', { permitirNegativo: true }), -345);
});

test('normalizarImporte: con permitirNegativo, acepta el signo detras', () => {
  assert.equal(normalizarImporte('1.234,56-', { permitirNegativo: true }), -1234.56);
  assert.equal(normalizarImporte('50,00 -', { permitirNegativo: true }), null);
  assert.equal(normalizarImporte('50,00- ', { permitirNegativo: true }), -50); // espacio EXTERIOR despues del signo se recorta con trim
  assert.equal(normalizarImporte(' -50,00', { permitirNegativo: true }), -50); // el espacio aqui es EXTERIOR (recortado por el trim de toda la cadena), sigue siendo valido
});

test('normalizarImporte: permitirNegativo no relaja el resto de reglas', () => {
  // Formato ingles, espacio interno, sin decimales: siguen rechazados.
  assert.equal(normalizarImporte('-1,234.56', { permitirNegativo: true }), null);
  assert.equal(normalizarImporte('-12 3,45', { permitirNegativo: true }), null);
  assert.equal(normalizarImporte('-1234', { permitirNegativo: true }), null);
});

test('normalizarImporte: sin permitirNegativo, un signo detras tambien se rechaza', () => {
  assert.equal(normalizarImporte('1.234,56-'), null);
});

test('agruparEnLineas: sin opciones, comportamiento identico al actual', () => {
  const items = [item(10, 700, 'A'), item(60, 698, 'B'), item(10, 680, 'C')];
  const lineas = agruparEnLineas(items);
  assert.equal(lineas.length, 2);
  assert.equal(lineas[0].texto, 'A B');
});

test('agruparEnLineas: con tolerancia fija, une fragmentos que la tolerancia por defecto separaria', () => {
  // altura 4 -> tolerancia por defecto max(2, 4*0.5) = 2; separados 3.6 no
  // se unirian por defecto, pero si con una tolerancia fija de 6.
  const items = [item(10, 700, 'FECHA', 4), item(300, 696.4, 'IMPORTE', 4)];
  const sinOpciones = agruparEnLineas(items);
  assert.equal(sinOpciones.length, 2); // se parte, como hoy sin ayuda

  const conTolerancia = agruparEnLineas(items, { tolerancia: 6 });
  assert.equal(conTolerancia.length, 1);
  assert.equal(conTolerancia[0].texto, 'FECHA IMPORTE');
});

test('agruparEnLineas: la tolerancia fija tambien separa filas mas alla de ella', () => {
  const items = [item(10, 700, 'FILA1', 4), item(10, 689, 'FILA2', 4)]; // salto 11
  const lineas = agruparEnLineas(items, { tolerancia: 6 });
  assert.equal(lineas.length, 2);
});

test('detectarFormato: reconoce el marcador de transferencia', () => {
  const items = [item(20, 700, 'TRANSFERENCIAS RECIBIDAS -    ORDEN DE TRANSFERENCIA')];
  assert.equal(detectarFormato(items), 'transferencia');
});

test('detectarFormato: reconoce un listado de movimientos por la forma de las filas', () => {
  const items = [];
  for (let i = 0; i < 4; i++) {
    items.push(item(20, 700 - i * 12, `0${i + 1}/01/2025`));
    items.push(item(400, 700 - i * 12, `1.234,5${i} EUR`.replace(' EUR', '')));
  }
  assert.equal(detectarFormato(items), 'movimientos');
});

test('detectarFormato: con menos de 3 fechas o 3 importes, no lo clasifica como movimientos', () => {
  const items = [item(20, 700, '01/01/2025'), item(400, 700, '10,00'),
                 item(20, 688, 'texto suelto sin mas filas')];
  assert.equal(detectarFormato(items), null);
});

test('detectarFormato: pagina vacia o sin ninguna forma reconocible da null', () => {
  assert.equal(detectarFormato([]), null);
  assert.equal(detectarFormato([item(20, 700, 'texto cualquiera sin forma')]), null);
});

test('tolerenciaAdaptativa: separa dos grupos de saltos y devuelve el punto medio', () => {
  // Filas de dos sub-alturas (salto 3.6 dentro, salto 10.2 entre filas),
  // reproduciendo la geometria medida en el documento real.
  const items = [];
  let y = 700;
  for (let f = 0; f < 6; f++) {
    items.push(item(20, y, 'A'));
    items.push(item(300, y - 3.6, 'B'));
    y -= 10.2;
  }
  const tol = tolerenciaAdaptativa(items);
  assert.ok(tol > 3.6 && tol < 10.2, `tolerancia ${tol} deberia caer entre 3.6 y 10.2`);
});

test('tolerenciaAdaptativa: con pocos saltos distintos, no hay evidencia suficiente', () => {
  const items = [item(20, 700, 'A'), item(20, 695, 'B')];
  assert.equal(tolerenciaAdaptativa(items), null);
});

test('tolerenciaAdaptativa: pagina vacia da null', () => {
  assert.equal(tolerenciaAdaptativa([]), null);
});

test('detectarFormato: el marcador de transferencia gana aunque tambien haya forma de movimientos', () => {
  // Una pagina con el marcador Y ademas varias fechas/importes sueltos
  // (coincidencia posible, no solo teorica): debe ganar 'transferencia'
  // siempre, porque esa comprobacion se hace y retorna ANTES de contar
  // fechas e importes.
  const items = [
    item(20, 750, 'TRANSFERENCIAS RECIBIDAS -    ORDEN DE TRANSFERENCIA'),
    item(20, 700, '01/01/2025'), item(400, 700, '10,00'),
    item(20, 688, '02/01/2025'), item(400, 688, '20,00'),
    item(20, 676, '03/01/2025'), item(400, 676, '30,00'),
  ];
  assert.equal(detectarFormato(items), 'transferencia');
});

test('detectarFormato: el umbral exige AMBOS contadores, no la suma', () => {
  // 2 fechas y 2 importes: ninguno llega a 3, debe ser null.
  const dosYDos = [
    item(20, 700, '01/01/2025'), item(400, 700, '10,00'),
    item(20, 688, '02/01/2025'), item(400, 688, '20,00'),
  ];
  assert.equal(detectarFormato(dosYDos), null);

  // 3 fechas pero solo 2 importes: sigue sin llegar al umbral en importe.
  const tresFechasDosImportes = [
    item(20, 700, '01/01/2025'), item(400, 700, '10,00'),
    item(20, 688, '02/01/2025'), item(400, 688, '20,00'),
    item(20, 676, '03/01/2025'),
  ];
  assert.equal(detectarFormato(tresFechasDosImportes), null);

  // 2 fechas pero 3 importes: mismo caso al reves.
  const dosFechasTresImportes = [
    item(20, 700, '01/01/2025'), item(400, 700, '10,00'),
    item(400, 688, '20,00'),
    item(400, 676, '30,00'),
  ];
  assert.equal(detectarFormato(dosFechasTresImportes), null);
});

test('tolerenciaAdaptativa: una rejilla perfectamente regular no produce una tolerancia espuria', () => {
  // Todos los saltos verticales iguales (una tabla sin el problema de
  // particion de filas): todos los ratios dan 1, ninguno supera el
  // mejorRatio inicial de 1, y debe devolver null (sin evidencia de dos
  // grupos distintos), no un numero cualquiera.
  const items = [];
  for (let i = 0; i < 8; i++) items.push(item(20, 700 - i * 10, `linea ${i}`));
  assert.equal(tolerenciaAdaptativa(items), null);
});

test('tolerenciaAdaptativa: saltos en cero no lanzan excepcion', () => {
  // Varios fragmentos en la misma Y exacta (salto 0 entre ellos), mezclados
  // con saltos normales: el guard "saltos[i] <= 0" debe saltarselos sin
  // dividir por cero.
  const items = [
    item(20, 700, 'A'), item(60, 700, 'B'), // misma Y, salto 0 entre ellas
    item(20, 690, 'C'), item(60, 690, 'D'),
    item(20, 680, 'E'), item(60, 680, 'F'),
    item(20, 670, 'G'), item(60, 670, 'H'),
  ];
  assert.doesNotThrow(() => tolerenciaAdaptativa(items));
});

test('parsearPaginaAuto: formato transferencia, sigue devolviendo el registro correcto', () => {
  const items = [];
  // Reutiliza la geometria de paginaMolde, pero via items en bruto: se
  // construye a mano una pagina minima con el marcador y los datos del
  // nucleo, para no depender de convertir lineas ya agrupadas a items.
  const L = paginaMoldeItems();
  const { registros, anomalias } = parsearPaginaAuto(L, 7, 'transferencias.pdf');
  assert.equal(anomalias.length, 0);
  assert.equal(registros.length, 1);
  assert.equal(registros[0].formato, 'transferencia');
  assert.equal(registros[0].archivo, 'transferencias.pdf');
  assert.equal(registros[0].fila, null);
  assert.equal(registros[0].pagina, 7);
  assert.equal(registros[0].ordenante, 'AYUNTAMIENTO DE VILLARRIBA');
});

test('parsearPaginaAuto: formato movimientos, varios registros con archivo y fila', () => {
  // 3 filas, no 2: detectarFormato exige >=3 fragmentos de importe, y con
  // fragmentos EN BRUTO cada fila aporta solo uno (a diferencia de
  // paginaMovimientos de la Task 3, que ya da lineas agrupadas y no sirve
  // aqui — parsearPaginaAuto necesita fragmentos en bruto para poder medir
  // la tolerancia adaptativa antes de agrupar lineas).
  const items = paginaMovimientosItems([
    { importe: '10,00' }, { importe: '20,00' }, { importe: '30,00' },
  ]);
  const { registros, anomalias } = parsearPaginaAuto(items, 2, 'movimientos.pdf');
  assert.equal(anomalias.length, 0);
  assert.equal(registros.length, 3);
  assert.equal(registros[0].formato, 'movimientos');
  assert.equal(registros[0].archivo, 'movimientos.pdf');
  assert.deepEqual(registros.map(r => r.fila), [1, 2, 3]);
  assert.deepEqual(registros.map(r => r.importe), [10, 20, 30]);
});

test('parsearPaginaAuto: pagina sin texto da anomalia sin_texto y ningun registro', () => {
  const { registros, anomalias } = parsearPaginaAuto([], 1, 'a.pdf');
  assert.deepEqual(registros, []);
  assert.equal(anomalias.length, 1);
  assert.equal(anomalias[0].motivo, 'sin_texto');
  assert.equal(anomalias[0].archivo, 'a.pdf');
  assert.equal(anomalias[0].pagina, 1);
});

test('parsearPaginaAuto: pagina que no encaja en ningun formato da formato_no_reconocido', () => {
  const items = [item(20, 700, 'una pagina cualquiera sin forma reconocible')];
  const { registros, anomalias } = parsearPaginaAuto(items, 4, 'a.pdf');
  assert.deepEqual(registros, []);
  assert.equal(anomalias.length, 1);
  assert.equal(anomalias[0].motivo, 'formato_no_reconocido');
  assert.equal(anomalias[0].pagina, 4);
  assert.equal(anomalias[0].archivo, 'a.pdf');
});
