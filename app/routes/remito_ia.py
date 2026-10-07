"""Remitos + IA: Gemini lee la foto del remito, propone los productos y, al guardar, se aplican.

Ponelo en app/routes/remito_ia.py.
- POST /compras/remitos/analizar : manda las fotos a Gemini y devuelve la tabla propuesta
  (cada línea con el producto existente si el código coincide, o marcada como "nuevo").
- aplicar_items(): lo llama crear_remito (compras.py) dentro de la misma transacción:
  suma stock a los existentes, crea los nuevos y guarda las líneas en RemitoItem.
"""
import base64
import json
import os
import re
import time
import unicodedata
from concurrent.futures import FIRST_COMPLETED, ThreadPoolExecutor, wait
from difflib import SequenceMatcher
from pathlib import Path
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException
from sqlmodel import Field, Session, SQLModel, select

from app.database import get_session
from app.models.models import CATEGORIA_DEFAULT, CODIGO_RAPIDO, Producto, Remito, RemitoItem, ahora
from app.routes import ia

router = APIRouter(prefix="/compras/remitos", tags=["Compras"])

MAX_IMG_BYTES = 8 * 1024 * 1024
ESPERA_COBERTURA = 7  # seg: si el modelo tarda más que esto, se lanza el siguiente en paralelo

# Modelo elegido para leer remitos (se puede cambiar desde "Comparar modelos"). Se guarda en modelo_remitos.txt
_ARCHIVO_MODELO = Path(__file__).resolve().parents[2] / "modelo_remitos.txt"


def _modelo_guardado() -> Optional[str]:
    try:
        return _ARCHIVO_MODELO.read_text(encoding="utf-8").strip() or None
    except OSError:
        return None


MODELO_REMITOS: Optional[str] = os.environ.get("GEMINI_MODEL_REMITOS") or _modelo_guardado()

PROMPT = """Leé este remito / factura de compra de un proveedor argentino (si hay varias imágenes, son páginas del MISMO remito).
Respondé SOLO un JSON, sin explicaciones, con esta forma exacta (cada renglón es un arreglo de 5 posiciones):
{"proveedor":"","numero":"","fecha":"YYYY-MM-DD","total":0,"items":[["codigo","descripcion",cantidad,precio_unitario,subtotal]]}
Reglas:
- Un arreglo por renglón de producto, en el orden de la hoja. No inventes renglones ni códigos: lo que no se lea va "" o 0.
- codigo: el código/SKU/EAN del renglón, copiado exacto. descripcion: el texto del producto.
- Números como número JSON (punto decimal, sin $ ni separador de miles), importes en pesos.
- cantidad: unidades del renglón tal cual figuran. precio_unitario: por unidad sin IVA si figura, si no 0. subtotal: el del renglón si figura, si no 0.
- total: total del remito si figura, si no 0. fecha en ISO o "" si no se lee.
- La imagen puede ser chica, borrosa o escaneada: igual leé todo lo que puedas. NUNCA te niegues ni escribas texto fuera del JSON."""


# ---------------- Esquemas ----------------
class AnalizarIn(SQLModel):
    imagenes: list[str] = Field(min_length=1, max_length=6)  # data URL base64


class ItemRemitoIn(SQLModel):
    producto_id: Optional[int] = None  # None = producto nuevo (o se busca por código)
    codigo: str = ""
    nombre: str = Field(min_length=1)
    cantidad: int = Field(ge=1)
    costo: int = Field(default=0, ge=0)  # centavos, por unidad
    precio_venta: int = Field(default=0, ge=0)  # centavos; solo para productos nuevos (0 = usa el costo)
    categoria: str = ""  # solo para productos nuevos


# ---------------- Utilidades ----------------
def _clave(codigo: str) -> str:
    """Código normalizado para comparar (sin símbolos, minúsculas y sin ceros a la izquierda)."""
    return re.sub(r"[^0-9a-z]", "", (codigo or "").lower()).lstrip("0")


def _toks(texto: str) -> list[str]:
    t = unicodedata.normalize("NFD", (texto or "").lower())
    t = re.sub(r"[\u0300-\u036f]", "", t)
    return re.findall(r"[a-z0-9]+", t)


def _mismo_nombre(a: str, b: str) -> bool:
    """¿Los dos nombres parecen el mismo producto? Tolera abreviaturas ("CARRET." ~ "carretilla")."""
    ta, tb = _toks(a), _toks(b)
    if not ta or not tb:
        return True  # no hay nada para comparar

    def hay(x: str, lista: list[str]) -> bool:
        return any(x == y or (len(x) >= 3 and len(y) >= 3 and (x.startswith(y) or y.startswith(x))) for y in lista)

    comunes = sum(1 for x in set(ta) if hay(x, tb))
    if comunes / min(len(set(ta)), len(set(tb))) >= 0.5:
        return True
    return SequenceMatcher(None, " ".join(ta), " ".join(tb)).ratio() >= 0.6


def _num(v) -> float:
    if isinstance(v, (int, float)):
        return float(v)
    s = re.sub(r"[^\d,.\-]", "", str(v or ""))
    if "," in s and "." in s:
        s = s.replace(".", "").replace(",", ".") if s.rfind(",") > s.rfind(".") else s.replace(",", "")
    elif "," in s:
        s = s.replace(",", ".")
    try:
        return float(s)
    except ValueError:
        return 0.0


def _imagen(data_url: str) -> tuple[str, bytes]:
    m = re.match(r"data:(image/[\w.+-]+);base64,(.+)$", data_url or "", re.S)
    if not m:
        raise HTTPException(400, "Imagen inválida")
    try:
        datos = base64.b64decode(m.group(2))
    except Exception:
        raise HTTPException(400, "Imagen inválida")
    if len(datos) > MAX_IMG_BYTES:
        raise HTTPException(413, "Una de las imágenes es demasiado grande")
    return m.group(1), datos


def _parsear(texto: str) -> dict:
    t = re.sub(r"^```(?:json)?|```$", "", (texto or "").strip(), flags=re.M).strip()
    data = json.loads(t)
    if isinstance(data, list):
        data = {"items": data}
    cols = ("codigo", "descripcion", "cantidad", "precio_unitario", "subtotal")
    data["items"] = [
        dict(zip(cols, it)) if isinstance(it, (list, tuple)) else it for it in (data.get("items") or [])
    ]
    return data


def _config(types, nombre: str, temperatura: float, pensar: bool = True):
    """Config de generación. Apaga/minimiza el "pensamiento" del modelo: leer un remito no lo necesita y es lo que más tarda."""
    extra = {}
    if pensar and "pro" not in nombre:
        try:
            if "2.5" in nombre:
                extra["thinking_config"] = types.ThinkingConfig(thinking_budget=0)
            elif "gemini-3" in nombre:
                extra["thinking_config"] = types.ThinkingConfig(thinking_level="MINIMAL")
        except Exception:
            pass  # la librería instalada no soporta esa opción: se usa sin ella
    try:  # tope de espera por intento: un modelo saturado (503) puede colgarse más de un minuto
        extra["http_options"] = types.HttpOptions(timeout=30_000)
    except Exception:
        pass
    return types.GenerateContentConfig(response_mime_type="application/json", temperature=temperatura, **extra)


def _generar(cliente, types, nombre: str, contenido: list, temperatura: float):
    cfg = _config(types, nombre, temperatura, True)
    try:
        return cliente.models.generate_content(model=nombre, contents=contenido, config=cfg)
    except Exception as e:
        # si el modelo rechaza la opción de "pensamiento" (400), se reintenta sin ella
        if cfg.thinking_config is None or getattr(e, "code", None) in (401, 403, 404, 429, 500, 503):
            raise
        return cliente.models.generate_content(
            model=nombre, contents=contenido, config=_config(types, nombre, temperatura, False)
        )


def _renglones(data: dict) -> list[dict]:
    return [i for i in (data.get("items") or []) if isinstance(i, dict) and str(i.get("descripcion") or "").strip()]


def _una_lectura(cliente, types, nombre: str, contenido: list) -> dict:
    """Una lectura con un modelo (reintenta una vez si la respuesta no se pudo interpretar)."""
    for temperatura in (0.1, 0.4):
        try:
            data = _parsear(_generar(cliente, types, nombre, contenido, temperatura).text)
        except Exception as e:
            if getattr(e, "code", None) is not None:
                raise  # error de la API (429, 503, 404...): no se reintenta con el mismo modelo
            continue
        if _renglones(data):
            return data
    raise ValueError("sin renglones")


def _leer_remito(imagenes: list[tuple[str, bytes]]) -> dict:
    """Lee el remito lo más rápido posible: arranca con el modelo elegido, y si falla o tarda
    lanza el siguiente en paralelo; gana la primera respuesta válida."""
    cliente = ia._crear_cliente()
    from google.genai import types

    contenido = [types.Part.from_bytes(data=b, mime_type=m) for m, b in imagenes] + [PROMPT]

    def juntar(lista):
        out: list[str] = []
        for n in lista:
            if n and n not in out:
                out.append(n)
        return out

    # Sin llamar a la API para listar modelos salvo que haga falta (esa lista se guarda 1 hora)
    candidatos = juntar([MODELO_REMITOS, ia._ultimo_ok, ia.MODELO, *ia._modelos_cache["lista"]])
    if len(candidatos) < 3:
        candidatos = juntar([*candidatos, *ia._modelos_disponibles(cliente)])
    candidatos = candidatos[:4]

    errores: dict[str, str] = {}
    for ronda in range(2):
        ex = ThreadPoolExecutor(max_workers=len(candidatos))
        pendientes: dict = {}
        cola = list(candidatos)

        def lanzar() -> bool:
            if not cola:
                return False
            n = cola.pop(0)
            pendientes[ex.submit(_una_lectura, cliente, types, n, contenido)] = n
            return True

        lanzar()
        while pendientes:
            hechos, _ = wait(list(pendientes), timeout=ESPERA_COBERTURA, return_when=FIRST_COMPLETED)
            if not hechos:
                if lanzar():
                    continue  # tarda: se prueba otro modelo a la vez, sin cancelar el primero
                hechos, _ = wait(list(pendientes), return_when=FIRST_COMPLETED)
            for f in hechos:
                n = pendientes.pop(f)
                try:
                    data = f.result()
                except Exception as e:
                    codigo = getattr(e, "code", None)
                    if codigo in ia.CODIGOS_FATALES:
                        ex.shutdown(wait=False, cancel_futures=True)
                        raise HTTPException(502, f"Gemini rechazó la clave ({codigo}). Revisá GEMINI_API_KEY.")
                    errores[n] = str(codigo or e)
                    lanzar()  # falló: arranca el siguiente enseguida
                    continue
                ia._ultimo_ok = n
                ex.shutdown(wait=False, cancel_futures=True)
                return data
        ex.shutdown(wait=False)
        pasajeros = any(v in ("503", "500", "sin renglones") for v in errores.values())
        if ronda == 0 and pasajeros:
            time.sleep(2)  # error pasajero (saturación): una segunda vuelta
            continue
        break
    detalle = " | ".join(f"{n}: {e}" for n, e in errores.items())
    raise HTTPException(502, f"No se pudo leer el remito. {detalle}"[:500])


# ---------------- Endpoint ----------------
@router.post("/analizar")
def analizar(datos: AnalizarIn, session: Session = Depends(get_session)):
    data = _leer_remito([_imagen(d) for d in datos.imagenes])

    productos = [p for p in session.exec(select(Producto)).all() if p.codigo != CODIGO_RAPIDO]
    por_codigo = {p.codigo: p for p in productos}
    por_clave: dict[str, Producto] = {}
    for p in productos:
        if _clave(p.codigo):
            por_clave.setdefault(_clave(p.codigo), p)

    items = []
    for it in data.get("items") or []:
        if not isinstance(it, dict):
            continue
        codigo = str(it.get("codigo") or "").strip()
        p = por_codigo.get(codigo) or (por_clave.get(_clave(codigo)) if _clave(codigo) else None)
        cantidad = max(1, round(_num(it.get("cantidad")) or 1))
        costo = _num(it.get("precio_unitario"))
        if not costo and _num(it.get("subtotal")):
            costo = _num(it.get("subtotal")) / cantidad
        items.append(
            {
                "producto_id": p.id if p else None,
                "codigo": p.codigo if p else codigo,
                "nombre": str(it.get("descripcion") or "").strip() or (p.nombre if p else ""),
                "nombre_actual": p.nombre if p else None,
                "stock_actual": p.stock if p else None,
                "coincide": _mismo_nombre(str(it.get("descripcion") or ""), p.nombre) if p else True,
                "cantidad": cantidad,
                "costo": round(costo, 2),
                "precio_venta": round(p.precio / 100, 2) if p else 0,
            }
        )

    fecha = str(data.get("fecha") or "")
    return {
        "proveedor": str(data.get("proveedor") or ""),
        "numero": str(data.get("numero") or ""),
        "fecha": fecha if re.fullmatch(r"\d{4}-\d{2}-\d{2}", fecha) else "",
        "total": round(_num(data.get("total")), 2),
        "items": items,
    }


@router.get("/codigo")
def verificar_codigo(codigo: str, nombre: str = "", session: Session = Depends(get_session)):
    """¿Ya existe ese código en la base? Si existe, dice si el nombre se parece al que viene del remito."""
    codigo = codigo.strip()
    p = session.exec(select(Producto).where(Producto.codigo == codigo)).first() if codigo else None
    if not p and _clave(codigo):
        p = next((x for x in session.exec(select(Producto)).all() if _clave(x.codigo) == _clave(codigo)), None)
    if not p or p.codigo == CODIGO_RAPIDO:
        return {"existe": False}
    return {
        "existe": True,
        "producto_id": p.id,
        "codigo": p.codigo,
        "nombre_actual": p.nombre,
        "stock_actual": p.stock,
        "coincide": _mismo_nombre(nombre, p.nombre),
    }


# ---------------- Aplicar al guardar el remito ----------------
def aplicar_items(session: Session, remito: Remito, items: list[ItemRemitoIn], aplicar_stock: bool = False) -> None:
    """Se llama dentro de la transacción de crear_remito (después del flush). No hace commit.

    Guarda las líneas del remito y crea los productos nuevos (con su precio de venta y categoría).
    NO toca el stock: las compras se registran acá y el stock se calcula aparte (el parámetro
    aplicar_stock se ignora, queda por compatibilidad con compras.py).
    """
    for it in items:
        p = None
        if it.producto_id:
            p = session.get(Producto, it.producto_id)
            if not p:
                raise HTTPException(404, f"El producto #{it.producto_id} ya no existe")
        codigo = it.codigo.strip()
        if not p and codigo:
            p = session.exec(select(Producto).where(Producto.codigo == codigo)).first()
        if not p:
            if not codigo:
                raise HTTPException(400, f"Falta el código del producto nuevo «{it.nombre}»")
            p = Producto(
                codigo=codigo,
                nombre=it.nombre.strip(),
                precio=it.precio_venta or it.costo,
                stock=0,
                categoria=it.categoria.strip() or CATEGORIA_DEFAULT,
            )
            session.add(p)
            session.flush()  # así una segunda línea con el mismo código nuevo lo encuentra
        session.add(
            RemitoItem(
                remito_id=remito.id,
                producto_id=p.id,
                codigo=p.codigo,
                nombre=it.nombre.strip(),
                cantidad=it.cantidad,
                costo_unitario=it.costo,
                subtotal=it.costo * it.cantidad,
            )
        )