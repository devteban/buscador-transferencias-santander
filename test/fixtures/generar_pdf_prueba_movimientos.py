#!/usr/bin/env python3
"""
Genera un PDF de prueba que reproduce el molde del listado de movimientos,
con datos COMPLETAMENTE INVENTADOS.

Reproduce la geometria real medida en el documento real: fuente pequena
(4.68pt) y cada fila repartida en dos sub-alturas de texto (salto ~3.6,
menor que la fuente), con las filas entre si separadas ~10.2 (mayor que la
fuente). Es lo que hace que, con la tolerancia por defecto de
agruparEnLineas, cada fila se parta en dos lineas -el problema que motivo
el diseno multiformato.

    python3 test/fixtures/generar_pdf_prueba_movimientos.py pdf-prueba-movimientos.pdf
"""

import sys

ANCHO, ALTO = 842, 595

# Cinco filas inventadas: con y sin Concepto, con coma interna en el
# ordenante, con importe negativo delante y detras, y con separador de
# miles.
FILAS = [
    {"fop": "10/01/2025", "fval": "11/01/2025",
     "desc": "Transferencia De Ayuntamiento De Villarriba, Concepto Servicio 123",
     "imp": "1.234,56"},
    {"fop": "12/01/2025", "fval": "13/01/2025",
     "desc": "Transferencia De Ayuntamiento De Villabajo",
     "imp": "345,00"},
    {"fop": "14/01/2025", "fval": "15/01/2025",
     "desc": "Transferencia De Empresa Ejemplo, S.L., Concepto Factura 9",
     "imp": "-50,00"},
    {"fop": "16/01/2025", "fval": "17/01/2025",
     "desc": "Comision mantenimiento cuenta",
     "imp": "75,00-"},
    {"fop": "18/01/2025", "fval": "19/01/2025",
     "desc": "Transferencia De Mancomunidad De Municipios, Concepto Recogida enero",
     "imp": "980,50"},
]


def escapar(t):
    return t.replace("\\", r"\\").replace("(", r"\(").replace(")", r"\)")


def texto(x, y, t, tam=4.68):
    return f"BT /F1 {tam} Tf 1 0 0 1 {x} {y} Tm ({escapar(t)}) Tj ET\n"


def contenido():
    s = ""
    y = ALTO - 40
    s += texto(20, y, "Movimientos cuenta desde 01/01/2025 hasta 31/12/2025", tam=8)
    y -= 20
    s += texto(20, y, "Fecha Operacion", tam=6)
    s += texto(90, y, "Fecha Valor", tam=6)
    s += texto(160, y, "Concepto", tam=6)
    s += texto(600, y, "Importe", tam=6)
    y -= 20
    for f in FILAS:
        s += texto(20, y, f["fop"])
        s += texto(90, y, f["fval"])
        # La descripcion y el importe van a una sub-altura distinta de las
        # fechas (salto 3.6), reproduciendo la geometria real.
        y_desc = y - 3.6
        s += texto(160, y_desc, f["desc"])
        s += texto(600, y_desc, f["imp"])
        # Paso total entre filas: 13.8, NO 10.2. El salto medido "entre
        # filas" (10.2) es la distancia desde la sub-altura INFERIOR de una
        # fila hasta la sub-altura SUPERIOR de la siguiente; como la propia
        # fila ya baja 3.6 internamente, el paso total de "y" tiene que ser
        # 3.6 + 10.2 = 13.8 para que el patron alternante 3.6/10.2 salga
        # correcto. Con 10.2 a secas, el patron real es 3.6/6.6, que NO es
        # el que se midio en el documento real (verificado: con 13.8 la
        # tolerancia adaptativa da 6.9 sobre este PDF, igual que sobre el
        # documento real; con 10.2 da un valor distinto, 13.3).
        y -= 13.8
    return s


def construir():
    flujo = contenido().encode("cp1252", errors="replace")
    objetos = [
        b"<< /Type /Catalog /Pages 2 0 R >>",
        b"<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
        (f"<< /Type /Page /Parent 2 0 R /MediaBox [0 0 {ANCHO} {ALTO}] "
         f"/Resources << /Font << /F1 5 0 R >> >> "
         f"/Contents 4 0 R >>").encode("latin-1"),
        b"<< /Length " + str(len(flujo)).encode() + b" >>\nstream\n"
        + flujo + b"endstream",
        b"<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica "
        b"/Encoding /WinAnsiEncoding >>",
    ]
    salida = bytearray(b"%PDF-1.4\n")
    desplazamientos = []
    for i, cuerpo in enumerate(objetos, start=1):
        desplazamientos.append(len(salida))
        salida += f"{i} 0 obj\n".encode() + cuerpo + b"\nendobj\n"
    inicio_xref = len(salida)
    salida += f"xref\n0 {len(objetos) + 1}\n".encode()
    salida += b"0000000000 65535 f \n"
    for d in desplazamientos:
        salida += f"{d:010d} 00000 n \n".encode()
    salida += (f"trailer\n<< /Size {len(objetos) + 1} /Root 1 0 R >>\n"
               f"startxref\n{inicio_xref}\n%%EOF\n").encode()
    return bytes(salida)


if __name__ == "__main__":
    destino = sys.argv[1] if len(sys.argv) > 1 else "pdf-prueba-movimientos.pdf"
    datos = construir()
    with open(destino, "wb") as f:
        f.write(datos)
    print(f"{destino}: {len(FILAS)} filas, {len(datos)} bytes")
