from fastapi import APIRouter, Depends, HTTPException
from sqlmodel import Session, select

from app import impresora
from app.database import get_session
from app.models.models import ItemVenta, Venta

router = APIRouter(prefix="/imprimir", tags=["Impresión"])


@router.post("/ticket/{venta_id}")
def imprimir_ticket(venta_id: int, session: Session = Depends(get_session)):
    venta = session.get(Venta, venta_id)
    if not venta:
        raise HTTPException(404, "Venta no encontrada")
    items = session.exec(select(ItemVenta).where(ItemVenta.venta_id == venta.id)).all()
    try:
        impresora.imprimir(impresora.armar_ticket(venta, items))
    except impresora.ErrorImpresora as e:
        raise HTTPException(503, str(e))
    return {"ok": True}


@router.get("/prueba")
def imprimir_prueba():
    """Se puede abrir directo en el navegador: http://127.0.0.1:8000/imprimir/prueba"""
    try:
        impresora.imprimir(impresora.armar_prueba())
    except impresora.ErrorImpresora as e:
        raise HTTPException(503, str(e))
    return {"ok": True}