#!/usr/bin/env python3
"""
Extrae de pdf-prueba.pdf los fragmentos de texto con sus coordenadas, en la
misma forma que los entrega PDF.js, y los vuelca a items-pdf-prueba.json.

El PDF de prueba lo genera generar_pdf_prueba.py con un formato conocido, asi
que las posiciones se leen directamente del flujo de contenido. Esto da las
coordenadas exactas; pypdf con visitor_text NO sirve, porque devuelve la
matriz a ceros en los fragmentos que continuan una linea.

    python3 test/fixtures/generar_pdf_prueba.py pdf-prueba.pdf
    python3 test/fixtures/extraer_items.py pdf-prueba.pdf
"""

import json
import re
import sys
from pypdf import PdfReader

RE = re.compile(
    rb'/F1 ([\d.]+) Tf 1 0 0 1 ([\d.-]+) ([\d.-]+) Tm \((.*?)\) Tj', re.S)


def extraer(ruta):
    paginas = []
    for pag in PdfReader(ruta).pages:
        items = []
        for tam, x, y, txt in RE.findall(pag.get_contents().get_data()):
            texto = txt.replace(b'\\(', b'(').replace(b'\\)', b')')
            fs = float(tam)
            items.append({
                "str": texto.decode('cp1252'),
                "transform": [fs, 0, 0, fs, float(x), float(y)],
                "height": fs,
            })
        paginas.append(items)
    return paginas


if __name__ == "__main__":
    origen = sys.argv[1] if len(sys.argv) > 1 else "pdf-prueba.pdf"
    destino = "test/fixtures/items-pdf-prueba.json"
    paginas = extraer(origen)
    with open(destino, "w", encoding="utf-8") as f:
        json.dump(paginas, f, ensure_ascii=False, indent=1)
    print(f"{destino}: {len(paginas)} paginas, "
          f"{[len(p) for p in paginas]} fragmentos")
