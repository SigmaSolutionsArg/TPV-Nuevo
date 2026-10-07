from typing import Optional

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import func, or_
from sqlmodel import Field, Session, SQLModel, col, select

from app.database import get_session
from app.models.models import CuentaCorriente, MovimientoCuenta, Venta

router = APIRouter(prefix="/cuentas", tags=["Cuentas corrientes"])

# Con qué puede pagar un cliente la deuda de su cuenta
METODOS_PAGO = {"efectivo", "transferencia", "mercado_pago", "debito", "credito"}

# Valor de "aplicado_a" que apunta a la deuda inicial (cualquier otro número es el N° de un ticket)
INICIAL = 0


# ==========================================
# 1. ESQUEMAS
# ==========================================
class CuentaIn(SQLModel):
    nombre: str = Field(min_length=1)
    deuda_inicial: int = Field(default=0, ge=0)  # centavos
    nota: str = ""
    activo: bool = True


class PagoCuentaIn(SQLModel):
    monto: int = Field(gt=0)  # centavos
    metodo: str = "efectivo"
    nota: str = ""
    # None = pago general (cubre primero las deudas más viejas) · 0 = deuda inicial · otro = N° de ticket
    aplicado_a: Optional[int] = Field(default=None, ge=0)


# ==========================================
# 2. SALDOS
# ==========================================
def _totales(session: Session, cuenta_id: Optional[int] = None) -> dict[int, dict[str, int]]:
    """Por cuenta: lo vendido a cuenta ("venta") y lo pagado ("pago").

    Las ventas anuladas (o que ya no existen) no cuentan: si se anula un ticket,
    la deuda baja sola. Se calcula en SQL, sin traer los movimientos a memoria.
    """
    q = (
        select(
            MovimientoCuenta.cuenta_id,
            MovimientoCuenta.tipo,
            func.coalesce(func.sum(MovimientoCuenta.monto), 0),
        )
        .join(Venta, col(Venta.id) == col(MovimientoCuenta.venta_id), isouter=True)
        .where(or_(col(MovimientoCuenta.tipo) != "venta", col(Venta.anulada) == False))  # noqa: E712
        .group_by(MovimientoCuenta.cuenta_id, MovimientoCuenta.tipo)
    )
    if cuenta_id is not None:
        q = q.where(MovimientoCuenta.cuenta_id == cuenta_id)
    out: dict[int, dict[str, int]] = {}
    for cid, tipo, total in session.exec(q).all():
        out.setdefault(cid, {})[tipo] = int(total)
    return out


def _cuenta_json(c: CuentaCorriente, t: dict[str, int]) -> dict:
    compras = t.get("venta", 0)
    pagos = t.get("pago", 0)
    return {
        "id": c.id,
        "nombre": c.nombre,
        "nota": c.nota,
        "activo": c.activo,
        "deuda_inicial": c.deuda_inicial,
        "compras": compras,  # vendido a cuenta (sin tickets anulados)
        "pagos": pagos,
        "saldo": c.deuda_inicial + compras - pagos,  # lo que debe hoy
        "created_at": c.created_at,
    }


def _nombre_libre(session: Session, nombre: str, excluir_id: Optional[int] = None) -> str:
    n = nombre.strip()
    if not n:
        raise HTTPException(422, "Poné el nombre de la cuenta")
    q = select(CuentaCorriente).where(func.lower(col(CuentaCorriente.nombre)) == n.lower())
    if excluir_id is not None:
        q = q.where(CuentaCorriente.id != excluir_id)
    if session.exec(q).first():
        raise HTTPException(409, "Ya existe una cuenta con ese nombre")
    return n


def _cuenta_o_404(session: Session, cuenta_id: int) -> CuentaCorriente:
    c = session.get(CuentaCorriente, cuenta_id)
    if not c:
        raise HTTPException(404, "Cuenta corriente no encontrada")
    return c


# ==========================================
# 3. DEUDAS (cada ticket a cuenta + la deuda inicial) Y EVOLUCIÓN
# ==========================================
def _movimientos(session: Session, cuenta_id: int):
    """Todos los movimientos de la cuenta, del más viejo al más nuevo, con su ticket (si tiene)."""
    return session.exec(
        select(MovimientoCuenta, Venta)
        .join(Venta, col(Venta.id) == col(MovimientoCuenta.venta_id), isouter=True)
        .where(MovimientoCuenta.cuenta_id == cuenta_id)
        .order_by(col(MovimientoCuenta.fecha), col(MovimientoCuenta.id))
    ).all()


def _deudas(cuenta: CuentaCorriente, filas) -> list[dict]:
    """Reparte los pagos entre las deudas y devuelve cada una con lo que le falta.

    1) Los pagos con destino ("aplicado_a") van a su deuda.
    2) Los pagos generales (y todos los anteriores a esta función) cubren primero las deudas más viejas.
    Los tickets anulados no son deuda.
    """
    deudas: list[dict] = []
    if cuenta.deuda_inicial > 0:
        deudas.append(
            {"ref": INICIAL, "tipo": "inicial", "venta_id": None, "fecha": cuenta.created_at,
             "monto": cuenta.deuda_inicial, "pagado": 0}
        )
    for m, v in filas:
        if m.tipo == "venta" and v is not None and not v.anulada:
            deudas.append(
                {"ref": m.venta_id, "tipo": "venta", "venta_id": m.venta_id, "fecha": m.fecha,
                 "monto": m.monto, "pagado": 0}
            )

    por_ref = {d["ref"]: d for d in deudas}
    libre = 0  # plata de pagos generales (o dirigidos a una deuda que ya no existe)
    for m, _ in filas:
        if m.tipo != "pago":
            continue
        d = por_ref.get(m.aplicado_a) if m.aplicado_a is not None else None
        if d is None:
            libre += m.monto
            continue
        puesto = min(m.monto, d["monto"] - d["pagado"])
        d["pagado"] += puesto
        libre += m.monto - puesto

    for d in deudas:  # lo libre cubre primero lo más viejo
        if libre <= 0:
            break
        puesto = min(libre, d["monto"] - d["pagado"])
        d["pagado"] += puesto
        libre -= puesto

    for d in deudas:
        d["pendiente"] = d["monto"] - d["pagado"]
    return deudas


def _serie(cuenta: CuentaCorriente, filas) -> list[dict]:
    """Evolución de la cuenta evento por evento: saldo, compras acumuladas y pagos acumulados."""
    puntos: list[dict] = []
    saldo = compras = pagos = 0
    if cuenta.deuda_inicial > 0:
        saldo = cuenta.deuda_inicial
        puntos.append(
            {"fecha": cuenta.created_at, "tipo": "inicial", "monto": cuenta.deuda_inicial, "metodo": "",
             "venta_id": None, "saldo": saldo, "compras": compras, "pagos": pagos}
        )
    for m, v in filas:
        if m.tipo == "venta":
            if v is None or v.anulada:
                continue
            compras += m.monto
            saldo += m.monto
        else:
            pagos += m.monto
            saldo -= m.monto
        puntos.append(
            {"fecha": m.fecha, "tipo": m.tipo, "monto": m.monto, "metodo": m.metodo,
             "venta_id": m.venta_id, "saldo": saldo, "compras": compras, "pagos": pagos}
        )
    return puntos


# ==========================================
# 4. CUENTAS
# ==========================================
@router.get("")
def listar_cuentas(activas: bool = False, session: Session = Depends(get_session)):
    """Todas las cuentas con su saldo. activas=true es lo que usa la caja para elegir."""
    q = select(CuentaCorriente)
    if activas:
        q = q.where(CuentaCorriente.activo == True)  # noqa: E712
    cuentas = session.exec(q.order_by(func.lower(col(CuentaCorriente.nombre)))).all()
    tot = _totales(session)
    return [_cuenta_json(c, tot.get(c.id, {})) for c in cuentas]


@router.post("", status_code=201)
def crear_cuenta(datos: CuentaIn, session: Session = Depends(get_session)):
    cuenta = CuentaCorriente(
        nombre=_nombre_libre(session, datos.nombre),
        deuda_inicial=datos.deuda_inicial,
        nota=datos.nota.strip(),
        activo=True,  # una cuenta nueva siempre arranca activa
    )
    session.add(cuenta)
    session.commit()
    session.refresh(cuenta)
    return _cuenta_json(cuenta, {})


@router.get("/{cuenta_id:int}")
def detalle_cuenta(cuenta_id: int, session: Session = Depends(get_session)):
    """La cuenta con su historial (lo más nuevo primero), sus deudas y la evolución para el gráfico."""
    cuenta = _cuenta_o_404(session, cuenta_id)
    filas = _movimientos(session, cuenta_id)
    movimientos = [
        {
            "id": m.id,
            "fecha": m.fecha,
            "tipo": m.tipo,
            "monto": m.monto,
            "metodo": m.metodo,
            "venta_id": m.venta_id,
            "aplicado_a": m.aplicado_a,
            "nota": m.nota,
            # un cargo de un ticket anulado (o borrado) no suma deuda
            "anulada": m.tipo == "venta" and (v is None or v.anulada),
        }
        for m, v in reversed(filas[-500:])
    ]
    return {
        **_cuenta_json(cuenta, _totales(session, cuenta_id).get(cuenta_id, {})),
        "movimientos": movimientos,
        "deudas": _deudas(cuenta, filas),
        "serie": _serie(cuenta, filas),
    }


@router.put("/{cuenta_id:int}")
def editar_cuenta(cuenta_id: int, datos: CuentaIn, session: Session = Depends(get_session)):
    cuenta = _cuenta_o_404(session, cuenta_id)
    cuenta.nombre = _nombre_libre(session, datos.nombre, excluir_id=cuenta_id)
    cuenta.deuda_inicial = datos.deuda_inicial
    cuenta.nota = datos.nota.strip()
    cuenta.activo = datos.activo
    session.add(cuenta)
    session.commit()
    session.refresh(cuenta)
    return _cuenta_json(cuenta, _totales(session, cuenta_id).get(cuenta_id, {}))


# ==========================================
# 5. PAGOS (el cliente le paga a la cuenta)
# ==========================================
@router.post("/{cuenta_id:int}/pagos", status_code=201)
def registrar_pago(cuenta_id: int, datos: PagoCuentaIn, session: Session = Depends(get_session)):
    cuenta = _cuenta_o_404(session, cuenta_id)
    if datos.metodo not in METODOS_PAGO:
        raise HTTPException(422, "Medio de pago no válido")
    t = _totales(session, cuenta_id).get(cuenta_id, {})
    saldo = cuenta.deuda_inicial + t.get("venta", 0) - t.get("pago", 0)
    if saldo <= 0:
        raise HTTPException(409, "La cuenta no tiene deuda para pagar")
    if datos.monto > saldo:
        raise HTTPException(422, "El pago no puede ser mayor a la deuda de la cuenta")

    # Pago dirigido a una deuda puntual: no puede pasarse de lo que a esa deuda le falta
    if datos.aplicado_a is not None:
        deudas = _deudas(cuenta, _movimientos(session, cuenta_id))
        d = next((x for x in deudas if x["ref"] == datos.aplicado_a), None)
        if not d:
            raise HTTPException(422, "Esa deuda no existe en la cuenta")
        if d["pendiente"] <= 0:
            raise HTTPException(409, "Esa deuda ya está saldada")
        if datos.monto > d["pendiente"]:
            raise HTTPException(422, "El pago no puede ser mayor a lo que falta de esa deuda")

    session.add(
        MovimientoCuenta(
            cuenta_id=cuenta_id,
            tipo="pago",
            monto=datos.monto,
            metodo=datos.metodo,
            nota=datos.nota.strip(),
            aplicado_a=datos.aplicado_a,
        )
    )
    session.commit()
    return {"ok": True, "saldo": saldo - datos.monto}


@router.delete("/{cuenta_id:int}/pagos/{movimiento_id:int}")
def borrar_pago(cuenta_id: int, movimiento_id: int, session: Session = Depends(get_session)):
    """Corrige un pago mal cargado. Las ventas a cuenta no se borran: se anula el ticket."""
    mov = session.get(MovimientoCuenta, movimiento_id)
    if not mov or mov.cuenta_id != cuenta_id or mov.tipo != "pago":
        raise HTTPException(404, "Pago no encontrado")
    session.delete(mov)
    session.commit()
    return {"ok": True}