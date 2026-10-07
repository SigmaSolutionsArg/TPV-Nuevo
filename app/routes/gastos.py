from datetime import date, datetime, time, timedelta
from typing import Optional
from zoneinfo import ZoneInfo
from fastapi import APIRouter, Depends, HTTPException
from sqlmodel import Field, Session, SQLModel, col, select
from app.database import get_session
from app.models.models import Gasto

router = APIRouter(prefix="/gastos", tags=["Gastos"])
TZ = ZoneInfo("America/Argentina/Buenos_Aires")

class GastoIn(SQLModel):
    fecha: date
    descripcion: str = Field(min_length=1)
    monto: int = Field(gt=0)
    tipo: str
    categoria: str
    periodicidad: Optional[str] = None

@router.get("/prevision")
def prevision_gastos(session: Session = Depends(get_session)):
    """Busca los últimos gastos periódicos y proyecta la carga mensual."""
    gastos = session.exec(
        select(Gasto).where(Gasto.tipo == "periodico").order_by(col(Gasto.fecha).desc())
    ).all()
    
    vistos = set()
    proyeccion = []
    
    for g in gastos:
        clave = g.descripcion.strip().lower()
        if clave not in vistos:
            vistos.add(clave)
            
            # Normalizar a costo mensual estimado
            monto_mensual = g.monto
            if g.periodicidad == "semanal": monto_mensual = g.monto * 4
            elif g.periodicidad == "quincenal": monto_mensual = g.monto * 2
            elif g.periodicidad == "bimestral": monto_mensual = g.monto // 2
            elif g.periodicidad == "anual": monto_mensual = g.monto // 12
            
            proyeccion.append({
                "descripcion": g.descripcion,
                "categoria": g.categoria,
                "monto_ultimo": g.monto,
                "monto_mensual_estimado": monto_mensual,
                "periodicidad": g.periodicidad or "mensual",
                "ultima_fecha": g.fecha
            })
            
    return {
        "proyeccion": proyeccion,
        "total_mensual_estimado": sum(p["monto_mensual_estimado"] for p in proyeccion)
    }

@router.get("")
def listar_gastos(mes: Optional[str] = None, session: Session = Depends(get_session)):
    query = select(Gasto)
    if mes:
        try:
            y, m = map(int, mes.split("-"))
            desde = date(y, m, 1)
            hasta = date(y + 1, 1, 1) if m == 12 else date(y, m + 1, 1)
            query = query.where(Gasto.fecha >= desde, Gasto.fecha < hasta)
        except ValueError:
            pass
    return session.exec(query.order_by(col(Gasto.fecha).desc(), col(Gasto.id).desc())).all()

@router.post("", response_model=Gasto, status_code=201)
def crear_gasto(datos: GastoIn, session: Session = Depends(get_session)):
    gasto = Gasto(**datos.model_dump())
    session.add(gasto)
    session.commit()
    session.refresh(gasto)
    return gasto

@router.put("/{gasto_id}", response_model=Gasto)
def editar_gasto(gasto_id: int, datos: GastoIn, session: Session = Depends(get_session)):
    gasto = session.get(Gasto, gasto_id)
    if not gasto:
        raise HTTPException(404, "Gasto no encontrado")
    for k, v in datos.model_dump().items():
        setattr(gasto, k, v)
    session.add(gasto)
    session.commit()
    session.refresh(gasto)
    return gasto

@router.delete("/{gasto_id}")
def borrar_gasto(gasto_id: int, session: Session = Depends(get_session)):
    gasto = session.get(Gasto, gasto_id)
    if not gasto:
        raise HTTPException(404, "Gasto no encontrado")
    session.delete(gasto)
    session.commit()
    return {"ok": True}