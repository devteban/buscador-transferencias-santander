// Logica de extraccion. No conoce el DOM ni PDF.js: recibe lineas de texto
// con coordenadas y devuelve registros. Eso es lo que la hace testeable sin
// navegador y sin usar el PDF real.

const RE_IMPORTE = /^\d{1,3}(?:\.\d{3})*,\d{2}$|^\d{1,3},\d{2}$/;
const RE_FECHA = /^(\d{2})-(\d{2})-(\d{4})$/;

export function normalizarImporte(texto) {
  if (typeof texto !== 'string') return null;
  // Se recortan los extremos y el codigo de moneda, pero NUNCA los espacios
  // internos: el texto viene de fragmentos de PDF unidos con espacios, y
  // borrarlos convertiria "12 3,45" en un importe valido de 123,45.
  const limpio = texto.trim().replace(/\s*[A-Z]{3}$/, '').trim();
  if (!RE_IMPORTE.test(limpio)) return null;
  const n = Number(limpio.replace(/\./g, '').replace(',', '.'));
  return Number.isFinite(n) ? n : null;
}

export function normalizarFecha(texto) {
  if (typeof texto !== 'string') return null;
  const m = RE_FECHA.exec(texto.trim());
  if (!m) return null;
  const [, dd, mm, aaaa] = m;
  const d = Number(dd), mes = Number(mm);
  if (mes < 1 || mes > 12 || d < 1 || d > 31) return null;
  // Rechaza dias que no existen en ese mes (30 de febrero, 31 de abril).
  const fecha = new Date(`${aaaa}-${mm}-${dd}T00:00:00Z`);
  if (fecha.getUTCDate() !== d || fecha.getUTCMonth() + 1 !== mes) return null;
  return `${aaaa}-${mm}-${dd}`;
}

export function normalizarTexto(texto) {
  if (typeof texto !== 'string') return '';
  return texto
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

// Tolerancia vertical para decidir si dos fragmentos son la misma linea.
// PDF.js casi nunca da Y identica; media altura de fuente es el criterio
// habitual, con un minimo para fuentes muy pequenas.
function toleranciaY(alturaFuente) {
  return Math.max(2, alturaFuente * 0.5);
}

export function agruparEnLineas(items) {
  // Se ordena por Y antes de agrupar para que el resultado no dependa del
  // orden en que PDF.js emita los fragmentos, y se compara cada fragmento
  // con el ANTERIOR en vez de con un ancla fija: asi una linea ancha con
  // deriva vertical acumulada no se parte por la mitad.
  const utiles = (items || [])
    .filter(it => it && it.str && it.str.trim())
    .map(it => ({
      x: it.transform[4],
      y: it.transform[5],
      altura: it.height || Math.abs(it.transform[3]) || 10,
      texto: it.str.trim(),
    }))
    .sort((a, b) => b.y - a.y);
  if (utiles.length === 0) return [];

  const grupos = [];
  let actual = null;
  let anterior = null;
  for (const f of utiles) {
    // La tolerancia es la mayor de las dos alturas implicadas, para que
    // unir A con B de el mismo resultado que unir B con A.
    const tol = anterior === null
      ? 0
      : Math.max(toleranciaY(f.altura), toleranciaY(anterior.altura));
    if (actual === null || Math.abs(anterior.y - f.y) > tol) {
      actual = { y: f.y, fragmentos: [] };
      grupos.push(actual);
    }
    actual.fragmentos.push({ x: f.x, texto: f.texto });
    anterior = f;
  }

  for (const g of grupos) {
    g.fragmentos.sort((a, b) => a.x - b.x);
    g.texto = g.fragmentos.map(f => f.texto).join(' ');
  }
  return grupos;
}
