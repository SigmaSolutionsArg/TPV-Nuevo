from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlmodel import Field, Session, SQLModel, col, or_, select

from app.database import get_session
from app.models.models import CATEGORIA_DEFAULT, CODIGO_RAPIDO, Producto, ahora

router = APIRouter(prefix="/productos", tags=["Productos"])


class ProductoCrear(SQLModel):
    codigo: str = Field(min_length=1)
    nombre: str = Field(min_length=1)
    precio: int = Field(ge=0)  # en centavos
    stock: int = 0
    categoria: str = CATEGORIA_DEFAULT


class ProductoEditar(SQLModel):
    codigo: Optional[str] = Field(default=None, min_length=1)
    nombre: Optional[str] = Field(default=None, min_length=1)
    precio: Optional[int] = Field(default=None, ge=0)
    stock: Optional[int] = None
    categoria: Optional[str] = Field(default=None, min_length=1)
    activo: Optional[bool] = None


def _codigo_existe(session: Session, codigo: str, excluir_id: Optional[int] = None) -> bool:
    query = select(Producto).where(Producto.codigo == codigo)
    if excluir_id is not None:
        query = query.where(Producto.id != excluir_id)
    return session.exec(query).first() is not None


def _no_es_rapido(producto: Producto):
    if producto.codigo == CODIGO_RAPIDO:
        raise HTTPException(400, "El producto rápido es del sistema y no se puede modificar")


@router.post("", response_model=Producto, status_code=201)
def crear_producto(datos: ProductoCrear, session: Session = Depends(get_session)):
    if _codigo_existe(session, datos.codigo):
        raise HTTPException(409, "Ya existe un producto con ese código")
    campos = datos.model_dump()
    campos["categoria"] = datos.categoria.strip() or CATEGORIA_DEFAULT
    producto = Producto(**campos)
    session.add(producto)
    session.commit()
    session.refresh(producto)
    return producto


@router.get("", response_model=list[Producto])
def listar_productos(
    q: Optional[str] = Query(None, description="Busca por nombre o código"),
    categoria: Optional[str] = Query(None, description="Filtra por categoría"),
    incluir_inactivos: bool = False,
    session: Session = Depends(get_session),
):
    # El producto rápido es interno: nunca aparece en el buscador
    query = select(Producto).where(Producto.codigo != CODIGO_RAPIDO)
    if not incluir_inactivos:
        query = query.where(Producto.activo == True)  # noqa: E712
    if categoria:
        query = query.where(Producto.categoria == categoria)
    if q:
        patron = f"%{q}%"
        query = query.where(
            or_(col(Producto.nombre).ilike(patron), col(Producto.codigo).ilike(patron))
        )
    return session.exec(query.order_by(Producto.nombre)).all()


# Va antes de /{producto_id} para que "categorias" no se interprete como un ID
@router.get("/categorias", response_model=list[str])
def listar_categorias(session: Session = Depends(get_session)):
    query = (
        select(Producto.categoria)
        .where(Producto.codigo != CODIGO_RAPIDO, Producto.activo == True)  # noqa: E712
        .distinct()
        .order_by(Producto.categoria)
    )
    return session.exec(query).all()

@router.get("/precio/{codigo}")
def consultar_precio(codigo: str, session: Session = Depends(get_session)):
    p = session.exec(
        select(Producto).where(
            Producto.codigo == codigo, Producto.activo == True  # noqa: E712
        )
    ).first()
    if not p or p.codigo == CODIGO_RAPIDO:
        raise HTTPException(404, "Producto no encontrado")
    return {"codigo": p.codigo, "nombre": p.nombre, "precio": round(p.precio / 100, 2)}


@router.get("/{producto_id}", response_model=Producto)
def obtener_producto(producto_id: int, session: Session = Depends(get_session)):
    producto = session.get(Producto, producto_id)
    if not producto:
        raise HTTPException(404, "Producto no encontrado")
    return producto


@router.put("/{producto_id}", response_model=Producto)
def editar_producto(
    producto_id: int, datos: ProductoEditar, session: Session = Depends(get_session)
):
    producto = session.get(Producto, producto_id)
    if not producto:
        raise HTTPException(404, "Producto no encontrado")
    _no_es_rapido(producto)

    cambios = datos.model_dump(exclude_unset=True)
    if "codigo" in cambios and _codigo_existe(session, cambios["codigo"], producto_id):
        raise HTTPException(409, "Ya existe otro producto con ese código")
    if "categoria" in cambios:
        cambios["categoria"] = cambios["categoria"].strip() or CATEGORIA_DEFAULT

    for campo, valor in cambios.items():
        setattr(producto, campo, valor)
    producto.updated_at = ahora()

    session.add(producto)
    session.commit()
    session.refresh(producto)
    return producto


@router.delete("/{producto_id}", response_model=Producto)
def desactivar_producto(producto_id: int, session: Session = Depends(get_session)):
    """No borra: lo marca inactivo para no romper el historial de ventas."""
    producto = session.get(Producto, producto_id)
    if not producto:
        raise HTTPException(404, "Producto no encontrado")
    _no_es_rapido(producto)
    producto.activo = False
    producto.updated_at = ahora()
    session.add(producto)
    session.commit()
    session.refresh(producto)
    return producto