"""Compras: proveedores y remitos con fotos.

Las fotos llegan desde el navegador como imagen en base64 (ya reducida y comprimida),
se validan y se guardan como archivos en la carpeta `fotos_remitos/` (junto a tpv.db).
En la base de datos solo queda el nombre del archivo.
No necesita librerías extra.
"""
import base64
import uuid
from collections import defaultdict
from datetime import date
from pathlib import Path
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import func
from sqlmodel import Field, Session, SQLModel, col, select

from app.database import get_session
from app.models.models import Producto, Proveedor, Remito, RemitoFoto, RemitoItem

from app.routes.remito_ia import ItemRemitoIn, aplicar_items

router = APIRouter(prefix="/compras", tags=["Compras"])

FOTOS_DIR = Path(__file__).resolve().parents[2] / "fotos_remitos"
FOTOS_DIR.mkdir(exist_ok=True)
MAX_FOTOS = 10
MAX_BYTES = 8 * 1024 * 1024  # por foto


# ==========================================
# 1. ESQUEMAS
# ==========================================
class ProveedorCrear(SQLModel):
    nombre: str = Field(min_length=1)
    cuit: str = ""
    contacto: str = ""
    telefono: str = ""
    email: str = ""
    direccion: str = ""
    notas: str = ""


class ProveedorEditar(SQLModel):
    nombre: Optional[str] = Field(default=None, min_length=1)
    cuit: Optional[str] = None
    contacto: Optional[str] = None
    telefono: Optional[str] = None
    email: Optional[str] = None
    direccion: Optional[str] = None
    notas: Optional[str] = None
    activo: Optional[bool] = None


class RemitoCrear(SQLModel):
    proveedor_id: int
    numero: str = ""
    fecha: date
    monto: int = Field(default=0, ge=0)  # en centavos, opcional
    pagado: int = Field(default=0, ge=0)  # en centavos: lo que ya pagaste de este remito
    nota: str = ""
    fotos: list[str] = Field(default_factory=list, max_length=MAX_FOTOS)  # imágenes en base64 (data URL)
    items: list[ItemRemitoIn] = Field(default_factory=list, max_length=300)
    aplicar_stock: bool = True


class RemitoEditar(SQLModel):
    proveedor_id: int
    numero: str = ""
    fecha: date
    monto: int = Field(default=0, ge=0)  # centavos
    pagado: int = Field(default=0, ge=0)  # centavos
    nota: str = ""
    # None = no tocar las fotos · "" = quitarlas · imagen en base64 = reemplazarlas por esta
    foto: Optional[str] = None
    items: list[ItemRemitoIn] = Field(default_factory=list, max_length=300)  # reemplaza las líneas


class PagoEditar(SQLModel):
    pagado: int = Field(ge=0)  # centavos: TOTAL pagado del remito (no el pago nuevo)


# ==========================================
# 2. PROVEEDORES
# ==========================================
def _limpiar(d: dict) -> dict:
    return {k: (v.strip() if isinstance(v, str) else v) for k, v in d.items()}


def _duplicado(session: Session, nombre: Optional[str], cuit: Optional[str], excluir_id: Optional[int] = None) -> Optional[str]:
    if nombre:
        q = select(Proveedor).where(func.lower(Proveedor.nombre) == nombre.lower())
        if excluir_id is not None:
            q = q.where(Proveedor.id != excluir_id)
        if session.exec(q).first():
            return "Ya existe un proveedor con ese nombre"
    if cuit:
        q = select(Proveedor).where(Proveedor.cuit == cuit)
        if excluir_id is not None:
            q = q.where(Proveedor.id != excluir_id)
        if session.exec(q).first():
            return "Ya existe un proveedor con ese CUIT"
    return None


@router.post("/proveedores", response_model=Proveedor, status_code=201)
def crear_proveedor(datos: ProveedorCrear, session: Session = Depends(get_session)):
    campos = _limpiar(datos.model_dump())
    if not campos["nombre"]:
        raise HTTPException(422, "Poné un nombre")
    msg = _duplicado(session, campos["nombre"], campos["cuit"])
    if msg:
        raise HTTPException(409, msg)
    proveedor = Proveedor(**campos)
    session.add(proveedor)
    session.commit()
    session.refresh(proveedor)
    return proveedor


@router.get("/proveedores")
def listar_proveedores(incluir_inactivos: bool = False, session: Session = Depends(get_session)):
    query = select(Proveedor)
    if not incluir_inactivos:
        query = query.where(Proveedor.activo == True)  # noqa: E712
    conteos = dict(
        session.exec(select(Remito.proveedor_id, func.count(Remito.id)).group_by(Remito.proveedor_id)).all()
    )
    proveedores = session.exec(query.order_by(Proveedor.nombre)).all()
    return [{**p.model_dump(), "cantidad_remitos": conteos.get(p.id, 0)} for p in proveedores]


@router.put("/proveedores/{proveedor_id}", response_model=Proveedor)
def editar_proveedor(proveedor_id: int, datos: ProveedorEditar, session: Session = Depends(get_session)):
    proveedor = session.get(Proveedor, proveedor_id)
    if not proveedor:
        raise HTTPException(404, "Proveedor no encontrado")
    cambios = _limpiar(datos.model_dump(exclude_unset=True))
    if "nombre" in cambios and not cambios["nombre"]:
        raise HTTPException(422, "Poné un nombre")
    msg = _duplicado(session, cambios.get("nombre"), cambios.get("cuit"), proveedor_id)
    if msg:
        raise HTTPException(409, msg)
    for campo, valor in cambios.items():
        setattr(proveedor, campo, valor)
    session.add(proveedor)
    session.commit()
    session.refresh(proveedor)
    return proveedor


@router.delete("/proveedores/{proveedor_id}", response_model=Proveedor)
def desactivar_proveedor(proveedor_id: int, session: Session = Depends(get_session)):
    """No borra: lo marca inactivo para no perder sus remitos."""
    proveedor = session.get(Proveedor, proveedor_id)
    if not proveedor:
        raise HTTPException(404, "Proveedor no encontrado")
    proveedor.activo = False
    session.add(proveedor)
    session.commit()
    session.refresh(proveedor)
    return proveedor


# ==========================================
# 3. REMITOS
# ==========================================
def _extension(raw: bytes) -> Optional[str]:
    if raw[:3] == b"\xff\xd8\xff":
        return "jpg"
    if raw[:8] == b"\x89PNG\r\n\x1a\n":
        return "png"
    if raw[:4] == b"RIFF" and raw[8:12] == b"WEBP":
        return "webp"
    return None


def _guardar_foto(data_url: str) -> str:
    cuerpo = data_url.split(",", 1)[1] if data_url.startswith("data:") and "," in data_url else data_url
    try:
        raw = base64.b64decode(cuerpo, validate=True)
    except Exception:
        raise HTTPException(422, "Una de las fotos no es válida")
    if len(raw) > MAX_BYTES:
        raise HTTPException(413, "Una de las fotos pesa demasiado (máximo 8 MB)")
    ext = _extension(raw)
    if not ext:
        raise HTTPException(422, "Solo se aceptan fotos JPG, PNG o WEBP")
    nombre = f"{uuid.uuid4().hex}.{ext}"
    (FOTOS_DIR / nombre).write_bytes(raw)
    return nombre


def _remito_json(r: Remito, proveedor_nombre: str, fotos: list[str], cantidad_items: int = 0, unidades: int = 0) -> dict:
    return {
        "id": r.id,
        "proveedor_id": r.proveedor_id,
        "proveedor": proveedor_nombre,
        "numero": r.numero,
        "fecha": r.fecha,
        "monto": r.monto,
        "pagado": r.pagado,
        "deuda": max(0, r.monto - r.pagado),  # lo que todavía se le debe al proveedor
        "nota": r.nota,
        "fotos": fotos,
        "cantidad_items": cantidad_items,  # líneas (productos distintos) del remito
        "unidades": unidades,  # suma de cantidades
        "created_at": r.created_at,
    }


@router.get("/remitos")
def listar_remitos(
    proveedor_id: Optional[int] = None,
    limit: int = Query(500, ge=1, le=2000),
    session: Session = Depends(get_session),
):
    """Remitos del más nuevo al más viejo, con el nombre del proveedor y las URLs de sus fotos."""
    query = select(Remito, Proveedor).join(Proveedor, col(Proveedor.id) == col(Remito.proveedor_id))
    if proveedor_id:
        query = query.where(Remito.proveedor_id == proveedor_id)
    filas = session.exec(query.order_by(col(Remito.fecha).desc(), col(Remito.id).desc()).limit(limit)).all()

    fotos: dict[int, list[str]] = defaultdict(list)
    ids = [r.id for r, _ in filas]
    if ids:
        for f in session.exec(
            select(RemitoFoto).where(col(RemitoFoto.remito_id).in_(ids)).order_by(RemitoFoto.id)
        ).all():
            fotos[f.remito_id].append(f"/fotos/{f.archivo}")

    conteo: dict[int, tuple[int, int]] = {}
    if ids:
        for rid, n, u in session.exec(
            select(RemitoItem.remito_id, func.count(RemitoItem.id), func.coalesce(func.sum(RemitoItem.cantidad), 0))
            .where(col(RemitoItem.remito_id).in_(ids))
            .group_by(RemitoItem.remito_id)
        ).all():
            conteo[rid] = (n, int(u))

    return [_remito_json(r, p.nombre, fotos[r.id], *conteo.get(r.id, (0, 0))) for r, p in filas]


def _urls_fotos(session: Session, remito_id: int) -> list[str]:
    return [
        f"/fotos/{f.archivo}"
        for f in session.exec(select(RemitoFoto).where(RemitoFoto.remito_id == remito_id).order_by(RemitoFoto.id)).all()
    ]


@router.get("/remitos/{remito_id:int}")
def obtener_remito(remito_id: int, session: Session = Depends(get_session)):
    """Un remito completo (con sus líneas) para abrirlo en el modal de edición."""
    remito = session.get(Remito, remito_id)
    if not remito:
        raise HTTPException(404, "Remito no encontrado")
    proveedor = session.get(Proveedor, remito.proveedor_id)
    filas = session.exec(
        select(RemitoItem, Producto)
        .join(Producto, col(Producto.id) == col(RemitoItem.producto_id), isouter=True)
        .where(RemitoItem.remito_id == remito_id)
        .order_by(RemitoItem.id)
    ).all()
    items = [
        {
            "producto_id": it.producto_id,
            "codigo": it.codigo,
            "nombre": it.nombre,
            "nombre_actual": p.nombre if p else None,
            "cantidad": it.cantidad,
            "costo": round(it.costo_unitario / 100, 2),  # en pesos, como los maneja la tabla
            "precio_venta": round(p.precio / 100, 2) if p else 0,
        }
        for it, p in filas
    ]
    return {
        **_remito_json(
            remito,
            proveedor.nombre if proveedor else "",
            _urls_fotos(session, remito_id),
            len(items),
            sum(i["cantidad"] for i in items),
        ),
        "items": items,
    }


@router.post("/remitos", status_code=201)
def crear_remito(datos: RemitoCrear, session: Session = Depends(get_session)):
    proveedor = session.get(Proveedor, datos.proveedor_id)
    if not proveedor or not proveedor.activo:
        raise HTTPException(404, "El proveedor no existe o está inactivo")

    if datos.pagado > datos.monto:
        raise HTTPException(422, "Lo pagado no puede ser mayor al monto del remito")

    numero = datos.numero.strip()
    if numero:
        repetido = session.exec(
            select(Remito).where(Remito.proveedor_id == proveedor.id, Remito.numero == numero)
        ).first()
        if repetido:
            raise HTTPException(409, "Ya cargaste un remito con ese número para este proveedor")

    guardadas: list[str] = []
    try:
        for f in datos.fotos:
            guardadas.append(_guardar_foto(f))
        remito = Remito(
            proveedor_id=proveedor.id,
            numero=numero,
            fecha=datos.fecha,
            monto=datos.monto,
            pagado=datos.pagado,
            nota=datos.nota.strip(),
        )
        session.add(remito)
        session.flush()
        aplicar_items(session, remito, datos.items, datos.aplicar_stock)
        for nombre in guardadas:
            session.add(RemitoFoto(remito_id=remito.id, archivo=nombre))
        session.commit()
        session.refresh(remito)
    except Exception:
        session.rollback()
        for nombre in guardadas:  # si algo falló, no quedan fotos huérfanas en el disco
            (FOTOS_DIR / nombre).unlink(missing_ok=True)
        raise

    return _remito_json(remito, proveedor.nombre, [f"/fotos/{n}" for n in guardadas])


@router.put("/remitos/{remito_id:int}")
def editar_remito(remito_id: int, datos: RemitoEditar, session: Session = Depends(get_session)):
    remito = session.get(Remito, remito_id)
    if not remito:
        raise HTTPException(404, "Remito no encontrado")
    proveedor = session.get(Proveedor, datos.proveedor_id)
    if not proveedor:
        raise HTTPException(404, "El proveedor no existe")
    if proveedor.id != remito.proveedor_id and not proveedor.activo:
        raise HTTPException(404, "El proveedor está inactivo")  # el actual puede seguir aunque esté inactivo
    if datos.pagado > datos.monto:
        raise HTTPException(422, "Lo pagado no puede ser mayor al monto del remito")

    numero = datos.numero.strip()
    if numero:
        repetido = session.exec(
            select(Remito).where(
                Remito.proveedor_id == proveedor.id, Remito.numero == numero, Remito.id != remito.id
            )
        ).first()
        if repetido:
            raise HTTPException(409, "Ya cargaste un remito con ese número para este proveedor")

    nueva: Optional[str] = None
    viejas: list[str] = []
    try:
        if datos.foto:
            nueva = _guardar_foto(datos.foto)
        remito.proveedor_id = proveedor.id
        remito.numero = numero
        remito.fecha = datos.fecha
        remito.monto = datos.monto
        remito.pagado = datos.pagado
        remito.nota = datos.nota.strip()
        session.add(remito)

        # Las líneas se reemplazan por las que llegan (el stock no se toca, igual que al crear)
        for it in session.exec(select(RemitoItem).where(RemitoItem.remito_id == remito.id)).all():
            session.delete(it)
        session.flush()
        aplicar_items(session, remito, datos.items, False)

        if datos.foto is not None:
            for f in session.exec(select(RemitoFoto).where(RemitoFoto.remito_id == remito.id)).all():
                viejas.append(f.archivo)
                session.delete(f)
            if nueva:
                session.add(RemitoFoto(remito_id=remito.id, archivo=nueva))
        session.commit()
    except Exception:
        session.rollback()
        if nueva:  # no quedan fotos huérfanas si algo falló
            (FOTOS_DIR / nueva).unlink(missing_ok=True)
        raise
    for nombre in viejas:  # recién ahora, con todo guardado, se borran las fotos reemplazadas
        (FOTOS_DIR / nombre).unlink(missing_ok=True)

    session.refresh(remito)
    return _remito_json(remito, proveedor.nombre, _urls_fotos(session, remito.id))


@router.patch("/remitos/{remito_id:int}/pago")
def actualizar_pago(remito_id: int, datos: PagoEditar, session: Session = Depends(get_session)):
    """Gestión rápida: fija el total pagado de un remito."""
    remito = session.get(Remito, remito_id)
    if not remito:
        raise HTTPException(404, "Remito no encontrado")
    if datos.pagado > remito.monto:
        raise HTTPException(422, "Lo pagado no puede ser mayor al monto del remito")
    remito.pagado = datos.pagado
    session.add(remito)
    session.commit()
    session.refresh(remito)
    return {
        "id": remito.id,
        "monto": remito.monto,
        "pagado": remito.pagado,
        "deuda": max(0, remito.monto - remito.pagado),
    }