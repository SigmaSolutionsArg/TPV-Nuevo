"""Impresión ESC/POS directa a la cola de Windows (modo RAW). No necesita librerías extra."""
import ctypes
import sys
import textwrap
from ctypes import wintypes
from datetime import timezone
from zoneinfo import ZoneInfo

# ---------------- Configuración ----------------
NOMBRE_NEGOCIO = "MI NEGOCIO"
IMPRESORA = None  # None = la predeterminada de Windows. O el nombre exacto, ej: "NICTOM IT02"
ANCHO = 32  # caracteres por línea en papel de 58 mm
CORTAR = True
CODIGO_BARRAS = True  # código de barras con el número de ticket
AVANCE_LINEAS = 4  # líneas de papel que avanza antes de cortar / arrancar
CODEPAGE = 19  # 19 = CP858 (acentos y ñ)
# ------------------------------------------------

TZ = ZoneInfo("America/Argentina/Buenos_Aires")
ENCODING = "cp858"


class ErrorImpresora(Exception):
    pass


# ---------- Comandos ESC/POS ----------
INIT = b"\x1b@"
LF = b"\n"
CENTRO = b"\x1ba\x01"
IZQ = b"\x1ba\x00"
NEGRITA_ON = b"\x1bE\x01"
NEGRITA_OFF = b"\x1bE\x00"
TAM_NORMAL = b"\x1d!\x00"
TAM_DOBLE = b"\x1d!\x11"  # doble ancho y alto


def t(texto: str) -> bytes:
    return texto.encode(ENCODING, errors="replace")


def pesos(centavos: int) -> str:
    return "$" + f"{round(centavos / 100):,}".replace(",", ".")


def linea(izq: str, der: str, ancho: int = ANCHO) -> str:
    izq = izq[: max(0, ancho - len(der) - 1)]
    return izq + " " * (ancho - len(izq) - len(der)) + der


def codigo_barras(texto: str) -> bytes:
    datos = b"{B" + texto.encode("ascii")  # Code128, subconjunto B
    return (
        CENTRO
        + b"\x1dh\x50"  # alto 80 puntos
        + b"\x1dw\x02"  # ancho de módulo
        + b"\x1dH\x02"  # número debajo del código
        + b"\x1dkI" + bytes([len(datos)]) + datos
        + LF
    )


def _final() -> bytes:
    out = b"\x1bd" + bytes([AVANCE_LINEAS])
    if CORTAR:
        out += b"\x1dVB\x03"  # corte parcial
    return out


def armar_ticket(venta, items) -> bytes:
    fecha = venta.fecha
    if fecha.tzinfo is None:
        fecha = fecha.replace(tzinfo=timezone.utc)
    fecha = fecha.astimezone(TZ).strftime("%d/%m/%Y %H:%M")

    b = bytearray(INIT + b"\x1bt" + bytes([CODEPAGE]))
    b += CENTRO + NEGRITA_ON + t(NOMBRE_NEGOCIO) + LF + NEGRITA_OFF
    b += t("TICKET") + LF
    b += TAM_DOBLE + NEGRITA_ON + t(f"#{venta.id}") + LF + TAM_NORMAL + NEGRITA_OFF
    b += t(fecha) + LF
    b += IZQ + t("-" * ANCHO) + LF

    for it in items:
        for renglon in textwrap.wrap(it.nombre, ANCHO) or [""]:
            b += t(renglon) + LF
        b += t(linea(f"{it.cantidad} x {pesos(it.precio_unitario)}", pesos(it.subtotal))) + LF

    b += t("-" * ANCHO) + LF
    b += TAM_DOBLE + NEGRITA_ON + t(linea("TOTAL", pesos(venta.total), ANCHO // 2)) + LF
    b += TAM_NORMAL + NEGRITA_OFF + LF
    b += CENTRO + t("Presentar en caja para abonar") + LF + LF
    if CODIGO_BARRAS:
        b += codigo_barras(str(venta.id))
    b += _final()
    return bytes(b)


def armar_prueba() -> bytes:
    b = bytearray(INIT + b"\x1bt" + bytes([CODEPAGE]))
    b += CENTRO + TAM_DOBLE + NEGRITA_ON + t("PRUEBA") + LF + TAM_NORMAL + NEGRITA_OFF
    b += t("Impresora lista") + LF + LF
    b += IZQ + t("Acentos: áéíóú ñ Ñ ¿? ¡!") + LF
    b += t("Moneda: $ 1.500") + LF
    b += t("0123456789012345678901234567890123456789") + LF
    b += t("(la linea de arriba debe cortarse en 32)") + LF + LF
    if CODIGO_BARRAS:
        b += codigo_barras("12345")
    b += _final()
    return bytes(b)


# ---------- Envío a la cola de Windows (RAW) ----------
class _DOC_INFO_1(ctypes.Structure):
    _fields_ = [
        ("pDocName", wintypes.LPWSTR),
        ("pOutputFile", wintypes.LPWSTR),
        ("pDatatype", wintypes.LPWSTR),
    ]


_w = ctypes.WinDLL("winspool.drv", use_last_error=True) if sys.platform == "win32" else None
if _w:
    _w.GetDefaultPrinterW.argtypes = [wintypes.LPWSTR, ctypes.POINTER(wintypes.DWORD)]
    _w.OpenPrinterW.argtypes = [wintypes.LPWSTR, ctypes.POINTER(wintypes.HANDLE), wintypes.LPVOID]
    _w.StartDocPrinterW.argtypes = [wintypes.HANDLE, wintypes.DWORD, ctypes.c_void_p]
    _w.StartPagePrinter.argtypes = [wintypes.HANDLE]
    _w.WritePrinter.argtypes = [wintypes.HANDLE, ctypes.c_void_p, wintypes.DWORD, ctypes.POINTER(wintypes.DWORD)]
    _w.EndPagePrinter.argtypes = [wintypes.HANDLE]
    _w.EndDocPrinter.argtypes = [wintypes.HANDLE]
    _w.ClosePrinter.argtypes = [wintypes.HANDLE]


def _predeterminada() -> str:
    n = wintypes.DWORD(0)
    _w.GetDefaultPrinterW(None, ctypes.byref(n))
    if n.value == 0:
        raise ErrorImpresora("Windows no tiene una impresora predeterminada configurada")
    buf = ctypes.create_unicode_buffer(n.value)
    if not _w.GetDefaultPrinterW(buf, ctypes.byref(n)):
        raise ErrorImpresora("No se pudo leer la impresora predeterminada")
    return buf.value


def imprimir(datos: bytes) -> None:
    if _w is None:
        raise ErrorImpresora("La impresión directa solo está implementada para Windows")
    nombre = IMPRESORA or _predeterminada()

    h = wintypes.HANDLE()
    if not _w.OpenPrinterW(nombre, ctypes.byref(h), None):
        raise ErrorImpresora(f"No se pudo abrir la impresora '{nombre}': {ctypes.WinError(ctypes.get_last_error())}")
    try:
        doc = _DOC_INFO_1("Ticket TPV", None, "RAW")
        if not _w.StartDocPrinterW(h, 1, ctypes.byref(doc)):
            raise ErrorImpresora(f"La impresora rechazó el trabajo: {ctypes.WinError(ctypes.get_last_error())}")
        try:
            _w.StartPagePrinter(h)
            escrito = wintypes.DWORD(0)
            ok = _w.WritePrinter(h, datos, len(datos), ctypes.byref(escrito))
            _w.EndPagePrinter(h)
            if not ok or escrito.value != len(datos):
                raise ErrorImpresora("No se pudieron enviar todos los datos a la impresora")
        finally:
            _w.EndDocPrinter(h)
    finally:
        _w.ClosePrinter(h)