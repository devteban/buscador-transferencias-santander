// Logica de extraccion. No conoce el DOM ni PDF.js: recibe lineas de texto
// con coordenadas y devuelve registros. Eso es lo que la hace testeable sin
// navegador y sin usar el PDF real.

const RE_IMPORTE = /^\d{1,3}(?:\.\d{3})*,\d{2}$|^\d{1,3},\d{2}$/;
const RE_FECHA = /^(\d{2})-(\d{2})-(\d{4})$/;

export function normalizarImporte(texto) {
  if (typeof texto !== 'string') return null;
  const limpio = texto.replace(/\s|EUR|[A-Z]{3}$/g, '').trim();
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
