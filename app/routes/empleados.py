import json
from typing import Optional
from fastapi import APIRouter, Depends, HTTPException
from sqlmodel import Field, Session, SQLModel, col, select
from app.database import get_session
from app.models.models import Empleado

router = APIRouter(prefix="/empleados", tags=["Empleados"])

class EmpleadoIn(SQLModel):
    nombre: str = Field(min_length=1)
    telefono: str = ""
    email: str = ""
    direccion: str = ""
    lat: Optional[float] = None
    lng: Optional[float] = None
    sueldo: Optional[int] = None
    horarios: str = "{}"  # Validación básica de JSON

@router.get("")
def listar_empleados(incluir_inactivos: bool = False, session: Session = Depends(get_session)):
    query = select(Empleado)
    if not incluir_inactivos:
        query = query.where(Empleado.activo == True)
    return session.exec(query.order_by(Empleado.nombre)).all()

@router.post("", response_model=Empleado, status_code=201)
def crear_empleado(datos: EmpleadoIn, session: Session = Depends(get_session)):
    try:
        json.loads(datos.horarios)  # Validar que sea JSON
    except ValueError:
        raise HTTPException(422, "El formato de horarios no es válido")
        
    empleado = Empleado(**datos.model_dump())
    session.add(empleado)
    session.commit()
    session.refresh(empleado)
    return empleado

@router.put("/{empleado_id}", response_model=Empleado)
def editar_empleado(empleado_id: int, datos: EmpleadoIn, session: Session = Depends(get_session)):
    empleado = session.get(Empleado, empleado_id)
    if not empleado:
        raise HTTPException(404, "Empleado no encontrado")
        
    for k, v in datos.model_dump().items():
        setattr(empleado, k, v)
        
    session.add(empleado)
    session.commit()
    session.refresh(empleado)
    return empleado

@router.delete("/{empleado_id}")
def desactivar_empleado(empleado_id: int, session: Session = Depends(get_session)):
    empleado = session.get(Empleado, empleado_id)
    if not empleado:
        raise HTTPException(404, "Empleado no encontrado")
    empleado.activo = False
    session.add(empleado)
    session.commit()
    return {"ok": True}