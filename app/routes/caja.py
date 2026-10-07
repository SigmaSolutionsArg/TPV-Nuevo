from datetime import date, datetime, time, timedelta
from typing import Optional
from zoneinfo import ZoneInfo

from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException, Query
from pydantic import BaseModel
from sqlmodel import Session, col, select

from app.database import get_session
from app.models.models import (
    METODO_CUENTA,
    Arqueo,
    ArqueoMetodo,
    CuentaCorriente,
    MovimientoCuenta,
    Pago,
    Venta,
    ahora,
)
from app.routes.ventas import manager

router = APIRouter(prefix="/caja", tags=["Caja"])
TZ = ZoneInfo("America/Argentina/Buenos_Aires")

# Orden en que se muestran los métodos en el arqueo (los demás, si aparecen, van al final)
METODOS_ARQUEO = ["efectivo", "mercado_pago", "transferencia", "debito", "credito"]


# ==========================================
# 1. ESQUEMAS (Pydantic / Entradas)
# ==========================================
class PagoEntrada(BaseModel):
    metodo: str
    monto: int


class CobrarRequest(BaseModel):
    pagos: list[PagoEntrada]
    cuenta_id: Optional[int] = None  # obligatorio si algún pago es a cuenta corriente


class ArqueoEntrada(BaseModel):
    hasta: datetime  # el instante que mostró la vista previa
    contado: dict[str, int]  # método -> centavos contados
    nota: str = ""


# ==========================================
# 2. OPERACIONES DE CAJA (Cobro)
# ==========================================
@router.post("/cobrar/{venta_id}")
def cobrar_venta(
    venta_id: int,
    datos: CobrarRequest,
    background_tasks: BackgroundTasks,
    session: Session = Depends(get_session),
):
    venta = session.get(Venta, venta_id)
    if not venta:
        raise HTTPException(404, "Venta no encontrada")
    if venta.estado != "pendiente":
        raise HTTPException(400, f"La venta ya está {venta.estado}")
    if venta.anulada:
        raise HTTPException(400, "La venta está anulada")

    total_pagado = sum(p.monto for p in datos.pagos)
    if total_pagado < venta.total:
        raise HTTPException(400, "El pago es menor al total de la venta")

    vuelto = total_pagado - venta.total

    # Pago a cuenta corriente: el cliente se lleva la mercadería y queda debiendo
    a_cuenta = [p for p in datos.pagos if p.metodo == METODO_CUENTA]
    cuenta = None
    if a_cuenta:
        if len(a_cuenta) > 1:
            raise HTTPException(400, "Solo puede haber un pago a cuenta corriente por ticket")
        if not datos.cuenta_id:
            raise HTTPException(400, "Elegí la cuenta corriente del cliente")
        cuenta = session.get(CuentaCorriente, datos.cuenta_id)
        if not cuenta or not cuenta.activo:
            raise HTTPException(400, "La cuenta corriente no existe o está inactiva")
        if a_cuenta[0].monto > venta.total:
            raise HTTPException(400, "No se puede cargar a la cuenta más que el total del ticket")

    for p in datos.pagos:
        monto_real = p.monto
        if p.metodo == "efectivo" and vuelto > 0:
            descuento = min(monto_real, vuelto)
            monto_real -= descuento
            vuelto -= descuento

        if monto_real > 0:
            session.add(Pago(venta_id=venta.id, metodo=p.metodo, monto=monto_real))
            if cuenta and p.metodo == METODO_CUENTA:
                session.add(
                    MovimientoCuenta(
                        cuenta_id=cuenta.id, tipo="venta", monto=monto_real, venta_id=venta.id
                    )
                )

    venta.estado = "cobrada"
    venta.fecha_cobro = ahora()  # momento en que la caja liquida el ticket
    venta.synced_at = None  # pendiente de sincronizar
    session.add(venta)
    session.commit()

    # Avisa a las pantallas de caja para que actualicen la lista
    background_tasks.add_task(manager.broadcast_caja_update)

    return {"ok": True, "vuelto": total_pagado - venta.total, "venta_id": venta.id}


# ==========================================
# 3. REPORTES Y RESÚMENES
# ==========================================
@router.get("/resumen")
def resumen_del_dia(
    fecha: Optional[date] = None, session: Session = Depends(get_session)
):
    fecha = fecha or datetime.now(TZ).date()
    desde = datetime.combine(fecha, time.min, tzinfo=TZ)
    hasta = desde + timedelta(days=1)

    # Tickets generados ese día en el mostrador (para contar anulados y pendientes)
    creadas = session.exec(
        select(Venta).where(Venta.fecha >= desde, Venta.fecha < hasta)
    ).all()

    # Cobros liquidados ese día en la caja (para el total de la caja)
    cobradas = session.exec(
        select(Venta).where(
            Venta.fecha_cobro >= desde,
            Venta.fecha_cobro < hasta,
            Venta.estado == "cobrada",
            Venta.anulada == False,  # noqa: E712
        )
    ).all()

    por_metodo: dict[str, int] = {}
    ids = [v.id for v in cobradas]
    if ids:
        pagos = session.exec(select(Pago).where(col(Pago.venta_id).in_(ids))).all()
        for p in pagos:
            por_metodo[p.metodo] = por_metodo.get(p.metodo, 0) + p.monto

    return {
        "fecha": fecha,
        "cantidad_ventas": len(cobradas),
        "cantidad_anuladas": sum(1 for v in creadas if v.anulada),
        "cantidad_pendientes": sum(
            1 for v in creadas if v.estado == "pendiente" and not v.anulada
        ),
        "total": sum(v.total for v in cobradas),
        "por_metodo": por_metodo,
    }


# ==========================================
# 4. ARQUEO DE CAJA
# ==========================================
# El arqueo NO cierra ni toca ventas: solo compara lo que el sistema dice que
# entró (desde el arqueo anterior) contra lo que la persona contó, y lo guarda.
def _ultimo_arqueo(session: Session) -> Optional[Arqueo]:
    return session.exec(select(Arqueo).order_by(col(Arqueo.hasta).desc())).first()


def _inicio_periodo(session: Session) -> datetime:
    ultimo = _ultimo_arqueo(session)
    if ultimo:
        return ultimo.hasta
    return datetime.combine(datetime.now(TZ).date(), time.min, tzinfo=TZ)  # inicio del día


def _esperado(session: Session, desde: datetime, hasta: datetime) -> tuple[int, dict[str, int]]:
    """Cantidad de tickets y total cobrado por método entre desde (incl.) y hasta (excl.)."""
    filtros = (
        Venta.fecha_cobro >= desde,
        Venta.fecha_cobro < hasta,
        Venta.estado == "cobrada",
        Venta.anulada == False,  # noqa: E712
    )
    cantidad = len(session.exec(select(Venta.id).where(*filtros)).all())
    pagos = session.exec(
        select(Pago).join(Venta, col(Venta.id) == col(Pago.venta_id)).where(*filtros)
    ).all()

    por_metodo = {m: 0 for m in METODOS_ARQUEO}
    for p in pagos:
        if p.metodo == METODO_CUENTA:
            continue  # venta a cuenta corriente: no entró plata a la caja
        por_metodo[p.metodo] = por_metodo.get(p.metodo, 0) + p.monto

    # Pagos de deuda de cuentas corrientes recibidos en el período: eso sí entró a la caja
    cobros = session.exec(
        select(MovimientoCuenta).where(
            MovimientoCuenta.tipo == "pago",
            MovimientoCuenta.fecha >= desde,
            MovimientoCuenta.fecha < hasta,
        )
    ).all()
    for c in cobros:
        por_metodo[c.metodo] = por_metodo.get(c.metodo, 0) + c.monto
    return cantidad, por_metodo


def _detalle_arqueo(session: Session, arqueo_id: int) -> list[ArqueoMetodo]:
    return session.exec(
        select(ArqueoMetodo).where(ArqueoMetodo.arqueo_id == arqueo_id).order_by(ArqueoMetodo.id)
    ).all()


@router.get("/arqueo/preview")
def arqueo_preview(session: Session = Depends(get_session)):
    """Totales esperados por método desde el arqueo anterior hasta este instante."""
    desde = _inicio_periodo(session)
    hasta = ahora()
    cantidad, por_metodo = _esperado(session, desde, hasta)
    ultimo = _ultimo_arqueo(session)
    return {
        "desde": desde,
        "hasta": hasta,
        "ultimo_arqueo": ultimo.fecha if ultimo else None,
        "cantidad_ventas": cantidad,
        "metodos": [{"metodo": m, "esperado": v} for m, v in por_metodo.items()],
        "total": sum(por_metodo.values()),
    }


@router.post("/arqueo", status_code=201)
def crear_arqueo(datos: ArqueoEntrada, session: Session = Depends(get_session)):
    desde = _inicio_periodo(session)
    hasta = datos.hasta if datos.hasta.tzinfo else datos.hasta.replace(tzinfo=ahora().tzinfo)
    hasta = min(hasta, ahora())
    if hasta <= desde:
        raise HTTPException(409, "Ya hay un arqueo posterior a ese momento. Abrí el arqueo de nuevo.")
    if any(v < 0 for v in datos.contado.values()):
        raise HTTPException(400, "Los montos contados no pueden ser negativos")

    # El esperado se recalcula en el servidor: no se confía en lo que muestra la pantalla
    cantidad, esperado = _esperado(session, desde, hasta)
    metodos = list(esperado) + [m for m in datos.contado if m not in esperado]

    arqueo = Arqueo(
        desde=desde,
        hasta=hasta,
        cantidad_ventas=cantidad,
        total_esperado=sum(esperado.values()),
        total_contado=sum(datos.contado.get(m, 0) for m in metodos),
        nota=datos.nota.strip(),
    )
    arqueo.diferencia = arqueo.total_contado - arqueo.total_esperado
    session.add(arqueo)
    session.flush()

    for m in metodos:
        esp, con = esperado.get(m, 0), datos.contado.get(m, 0)
        session.add(
            ArqueoMetodo(arqueo_id=arqueo.id, metodo=m, esperado=esp, contado=con, diferencia=con - esp)
        )
    session.commit()
    session.refresh(arqueo)
    return {"arqueo": arqueo, "metodos": _detalle_arqueo(session, arqueo.id)}


@router.get("/arqueos")
def listar_arqueos(limit: int = Query(30, ge=1, le=500), session: Session = Depends(get_session)):
    """Historial de arqueos, del más nuevo al más viejo (base para estadísticas futuras)."""
    arqueos = session.exec(select(Arqueo).order_by(col(Arqueo.hasta).desc()).limit(limit)).all()
    return [{"arqueo": a, "metodos": _detalle_arqueo(session, a.id)} for a in arqueos]