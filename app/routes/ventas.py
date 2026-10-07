from datetime import date, datetime, time, timedelta
from typing import Optional
from zoneinfo import ZoneInfo

from fastapi import (
    APIRouter,
    BackgroundTasks,
    Depends,
    HTTPException,
    WebSocket,
    WebSocketDisconnect,
)
from sqlmodel import Field, Session, SQLModel, col, select

from app.database import get_session
from app.models.models import CODIGO_RAPIDO, ItemVenta, Pago, Producto, Venta, ahora

router = APIRouter(prefix="/ventas", tags=["Ventas"])

TZ = ZoneInfo("America/Argentina/Buenos_Aires")
PERMITIR_STOCK_NEGATIVO = True


# ==========================================
# 1. GESTOR DE WEBSOCKETS (Tiempo Real)
# ==========================================
class ConnectionManager:
    def __init__(self):
        self.active_connections: list[WebSocket] = []

    async def connect(self, websocket: WebSocket):
        await websocket.accept()
        self.active_connections.append(websocket)

    def disconnect(self, websocket: WebSocket):
        if websocket in self.active_connections:
            self.active_connections.remove(websocket)

    async def broadcast_caja_update(self):
        # Se itera sobre una copia para poder quitar conexiones muertas
        for connection in list(self.active_connections):
            try:
                await connection.send_text("update_caja")
            except Exception:
                self.disconnect(connection)


manager = ConnectionManager()


@router.websocket("/ws/caja")
async def websocket_caja(websocket: WebSocket):
    await manager.connect(websocket)
    try:
        while True:
            await websocket.receive_text()  # Mantiene la conexión viva
    except WebSocketDisconnect:
        manager.disconnect(websocket)


# ==========================================
# 2. ESQUEMAS (Pydantic / Entradas)
# ==========================================
class ItemEntrada(SQLModel):
    cantidad: int = Field(gt=0)
    # Producto del catálogo
    producto_id: Optional[int] = None
    # Producto rápido: no está en el catálogo, viaja con nombre y precio (centavos)
    rapido: bool = False
    nombre: Optional[str] = None
    precio: Optional[int] = Field(default=None, ge=0)


class VentaCrear(SQLModel):
    items: list[ItemEntrada] = Field(min_length=1)


class VentaDetalle(SQLModel):
    venta: Venta
    items: list[ItemVenta]
    pagos: list[Pago]


def _detalle(session: Session, venta: Venta) -> VentaDetalle:
    items = session.exec(select(ItemVenta).where(ItemVenta.venta_id == venta.id)).all()
    pagos = session.exec(select(Pago).where(Pago.venta_id == venta.id)).all()
    return VentaDetalle(venta=venta, items=items, pagos=pagos)


# ==========================================
# 3. ENDPOINTS (Rutas)
# ==========================================
@router.post("", response_model=VentaDetalle, status_code=201)
def crear_venta(
    datos: VentaCrear,
    background_tasks: BackgroundTasks,
    session: Session = Depends(get_session),
):
    """Genera el ticket: guarda items y total, descuenta stock. Nace 'pendiente'."""
    venta = Venta(estado="pendiente")
    session.add(venta)
    session.flush()

    rapido: Optional[Producto] = None
    total = 0
    for it in datos.items:
        # ---- Producto rápido: cuelga del producto comodín, no toca stock ----
        if it.rapido:
            nombre = (it.nombre or "").strip()
            if not nombre:
                raise HTTPException(422, "El producto rápido necesita un nombre")
            if it.precio is None:
                raise HTTPException(422, "El producto rápido necesita un precio")
            if rapido is None:
                rapido = session.exec(
                    select(Producto).where(Producto.codigo == CODIGO_RAPIDO)
                ).first()
                if not rapido:
                    raise HTTPException(500, "Falta el producto rápido del sistema")

            subtotal = it.precio * it.cantidad
            session.add(
                ItemVenta(
                    venta_id=venta.id,
                    producto_id=rapido.id,
                    nombre=nombre,
                    precio_unitario=it.precio,
                    cantidad=it.cantidad,
                    subtotal=subtotal,
                )
            )
            total += subtotal
            continue

        # ---- Producto del catálogo ----
        if it.producto_id is None:
            raise HTTPException(422, "Falta el producto_id")
        producto = session.get(Producto, it.producto_id)
        if not producto or not producto.activo:
            raise HTTPException(
                404, f"Producto {it.producto_id} no existe o está inactivo"
            )
        if not PERMITIR_STOCK_NEGATIVO and producto.stock < it.cantidad:
            raise HTTPException(409, f"Stock insuficiente de {producto.nombre}")

        subtotal = producto.precio * it.cantidad
        session.add(
            ItemVenta(
                venta_id=venta.id,
                producto_id=producto.id,
                nombre=producto.nombre,
                precio_unitario=producto.precio,
                cantidad=it.cantidad,
                subtotal=subtotal,
            )
        )
        producto.stock -= it.cantidad
        producto.updated_at = ahora()
        session.add(producto)
        total += subtotal

    venta.total = total
    session.add(venta)
    session.commit()
    session.refresh(venta)

    # Avisa a todas las cajas que hay un ticket nuevo
    background_tasks.add_task(manager.broadcast_caja_update)

    return _detalle(session, venta)


@router.get("", response_model=list[Venta])
def listar_ventas(
    fecha: Optional[date] = None,
    estado: Optional[str] = None,
    session: Session = Depends(get_session),
):
    query = select(Venta)
    if fecha:
        desde = datetime.combine(fecha, time.min, tzinfo=TZ)
        hasta = desde + timedelta(days=1)
        query = query.where(Venta.fecha >= desde, Venta.fecha < hasta)
    if estado:
        query = query.where(Venta.estado == estado)
    return session.exec(query.order_by(col(Venta.fecha).desc())).all()


@router.get("/{venta_id}", response_model=VentaDetalle)
def obtener_venta(venta_id: int, session: Session = Depends(get_session)):
    venta = session.get(Venta, venta_id)
    if not venta:
        raise HTTPException(404, "Venta no encontrada")
    return _detalle(session, venta)


@router.post("/{venta_id}/anular", response_model=VentaDetalle)
def anular_venta(
    venta_id: int,
    background_tasks: BackgroundTasks,
    session: Session = Depends(get_session),
):
    venta = session.get(Venta, venta_id)
    if not venta:
        raise HTTPException(404, "Venta no encontrada")
    if venta.anulada:
        raise HTTPException(409, "La venta ya estaba anulada")

    items = session.exec(select(ItemVenta).where(ItemVenta.venta_id == venta.id)).all()
    for it in items:
        producto = session.get(Producto, it.producto_id)
        # El producto rápido no maneja stock, no hay nada que devolver
        if producto and producto.codigo != CODIGO_RAPIDO:
            producto.stock += it.cantidad
            producto.updated_at = ahora()
            session.add(producto)

    venta.anulada = True
    venta.estado = "anulada" 
    venta.synced_at = None
    session.add(venta)
    session.commit()
    session.refresh(venta)

    # Avisa a las cajas que se anuló un ticket
    background_tasks.add_task(manager.broadcast_caja_update)

    return _detalle(session, venta)
