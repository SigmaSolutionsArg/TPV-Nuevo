import uuid as uuid_lib
from datetime import date, datetime, timezone
from typing import Optional

from sqlalchemy import Column
from sqlalchemy.types import DateTime, TypeDecorator
from sqlmodel import Field, SQLModel

# Producto "comodín" del sistema: todas las ventas rápidas cuelgan de este ID.
CODIGO_RAPIDO = "RAPIDO"
CATEGORIA_RAPIDO = "Varios"
CATEGORIA_DEFAULT = "Sin categoría"
# Medio de pago "a cuenta": el cliente se lo lleva y queda debiendo (no entra plata a la caja)
METODO_CUENTA = "cuenta_corriente"


def ahora():
    return datetime.now(timezone.utc)


class FechaUTC(TypeDecorator):
    """Fecha que se guarda siempre en UTC y se lee siempre con zona horaria UTC.

    SQLite no guarda la zona: antes se descartaba al escribir y volvía "naive",
    por eso los filtros por día y la hora en pantalla salían corridos 3 horas.
    Con este tipo, cualquier fecha con zona (ej. hora Argentina) se convierte
    a UTC al guardar o filtrar, y la API la devuelve con 'Z' al final.
    """

    impl = DateTime
    cache_ok = True

    def process_bind_param(self, value, dialect):
        if value is None:
            return None
        if value.tzinfo is None:
            value = value.replace(tzinfo=timezone.utc)
        return value.astimezone(timezone.utc).replace(tzinfo=None)

    def process_result_value(self, value, dialect):
        if value is None:
            return None
        return value.replace(tzinfo=timezone.utc)


class Producto(SQLModel, table=True):
    id: Optional[int] = Field(default=None, primary_key=True)
    codigo: str = Field(index=True, unique=True)  # código de barras o interno
    nombre: str
    precio: int  # en centavos
    stock: int = 0
    categoria: str = Field(default=CATEGORIA_DEFAULT, index=True)
    activo: bool = True
    updated_at: datetime = Field(
        default_factory=ahora, sa_column=Column(FechaUTC(), nullable=False)
    )


class Venta(SQLModel, table=True):
    id: Optional[int] = Field(default=None, primary_key=True)
    uuid: str = Field(
        default_factory=lambda: str(uuid_lib.uuid4()), index=True, unique=True
    )
    # Cuándo el mostrador generó el ticket
    fecha: datetime = Field(
        default_factory=ahora, sa_column=Column(FechaUTC(), nullable=False, index=True)
    )
    # Cuándo la caja lo liquidó (None mientras esté pendiente)
    fecha_cobro: Optional[datetime] = Field(
        default=None, sa_column=Column(FechaUTC(), nullable=True, index=True)
    )
    total: int = 0  # en centavos
    anulada: bool = False
    estado: str = Field(default="pendiente", index=True)  # "pendiente" o "cobrada"
    # None = pendiente de sincronizar
    synced_at: Optional[datetime] = Field(
        default=None, sa_column=Column(FechaUTC(), nullable=True)
    )


class ItemVenta(SQLModel, table=True):
    id: Optional[int] = Field(default=None, primary_key=True)
    venta_id: int = Field(foreign_key="venta.id", index=True)
    producto_id: int = Field(foreign_key="producto.id", index=True)
    nombre: (
        str  # copia del nombre al momento de vender (en rápidos: lo que se escribió)
    )
    precio_unitario: int  # copia del precio, en centavos
    cantidad: int
    subtotal: int


class Pago(SQLModel, table=True):
    id: Optional[int] = Field(default=None, primary_key=True)
    venta_id: int = Field(foreign_key="venta.id", index=True)
    metodo: str  # efectivo / tarjeta / transferencia
    monto: int  # en centavos


class Arqueo(SQLModel, table=True):
    """Foto del estado de la caja en un momento. No cierra ni modifica ventas.

    Cubre los cobros con desde <= fecha_cobro < hasta. El 'desde' de cada arqueo
    es el 'hasta' del anterior, así los arqueos no se pisan ni dejan huecos.
    Diferencia = contado - esperado (positivo = sobra, negativo = falta).
    """

    id: Optional[int] = Field(default=None, primary_key=True)
    fecha: datetime = Field(
        default_factory=ahora, sa_column=Column(FechaUTC(), nullable=False, index=True)
    )
    desde: datetime = Field(sa_column=Column(FechaUTC(), nullable=False))
    hasta: datetime = Field(sa_column=Column(FechaUTC(), nullable=False, index=True))
    cantidad_ventas: int = 0
    total_esperado: int = 0  # en centavos
    total_contado: int = 0
    diferencia: int = 0
    nota: str = ""


class ArqueoMetodo(SQLModel, table=True):
    id: Optional[int] = Field(default=None, primary_key=True)
    arqueo_id: int = Field(foreign_key="arqueo.id", index=True)
    metodo: str = Field(index=True)
    esperado: int = 0  # en centavos
    contado: int = 0
    diferencia: int = 0


class Proveedor(SQLModel, table=True):
    id: Optional[int] = Field(default=None, primary_key=True)
    nombre: str = Field(index=True)
    cuit: str = ""
    contacto: str = ""
    telefono: str = ""
    email: str = ""
    direccion: str = ""
    notas: str = ""
    activo: bool = True
    created_at: datetime = Field(
        default_factory=ahora, sa_column=Column(FechaUTC(), nullable=False)
    )


class Remito(SQLModel, table=True):
    id: Optional[int] = Field(default=None, primary_key=True)
    proveedor_id: int = Field(foreign_key="proveedor.id", index=True)
    numero: str = ""
    fecha: date = Field(index=True)  # fecha que figura en el remito
    monto: int = 0  # en centavos, opcional
    pagado: int = 0  # en centavos: lo que ya se le pagó al proveedor por este remito
    nota: str = ""
    created_at: datetime = Field(
        default_factory=ahora, sa_column=Column(FechaUTC(), nullable=False)
    )


class RemitoFoto(SQLModel, table=True):
    id: Optional[int] = Field(default=None, primary_key=True)
    remito_id: int = Field(foreign_key="remito.id", index=True)
    archivo: str  # nombre del archivo en la carpeta fotos_remitos/
    created_at: datetime = Field(
        default_factory=ahora, sa_column=Column(FechaUTC(), nullable=False)
    )


class RemitoItem(SQLModel, table=True):
    """Línea de un remito (lo que dijo el remito, ya revisado por vos)."""

    id: Optional[int] = Field(default=None, primary_key=True)
    remito_id: int = Field(foreign_key="remito.id", index=True)
    producto_id: Optional[int] = Field(default=None, foreign_key="producto.id")
    codigo: str = ""
    nombre: str
    cantidad: int
    costo_unitario: int = 0  # centavos
    subtotal: int = 0  # centavos


class Gasto(SQLModel, table=True):
    id: Optional[int] = Field(default=None, primary_key=True)
    fecha: date = Field(index=True)
    descripcion: str
    monto: int  # en centavos
    tipo: str = Field(default="unitario")  # "unitario" o "periodico"
    categoria: str = Field(default="Otros", index=True)
    periodicidad: Optional[str] = Field(default=None)  # "mensual", "semanal", etc.
    created_at: datetime = Field(
        default_factory=ahora, sa_column=Column(FechaUTC(), nullable=False)
    )


class Empleado(SQLModel, table=True):
    id: Optional[int] = Field(default=None, primary_key=True)
    nombre: str = Field(index=True)
    telefono: str = ""
    email: str = ""
    direccion: str = ""
    lat: Optional[float] = None  # Latitud del mapa
    lng: Optional[float] = None  # Longitud del mapa
    sueldo: Optional[int] = None  # En centavos, opcional
    horarios: str = "{}"  # Turnos en formato JSON
    activo: bool = True
    created_at: datetime = Field(
        default_factory=ahora, sa_column=Column(FechaUTC(), nullable=False)
    )


class CuentaCorriente(SQLModel, table=True):
    """Cuenta de un cliente al que se le vende "a cuenta".

    saldo = deuda_inicial + ventas cargadas a la cuenta - pagos recibidos.
    """

    id: Optional[int] = Field(default=None, primary_key=True)
    nombre: str = Field(index=True)
    deuda_inicial: int = 0  # centavos: lo que ya debía cuando se abrió la cuenta
    nota: str = ""
    activo: bool = True  # inactiva = no aparece en la caja, pero conserva su historial
    created_at: datetime = Field(
        default_factory=ahora, sa_column=Column(FechaUTC(), nullable=False)
    )


class MovimientoCuenta(SQLModel, table=True):
    """Un cargo (venta a cuenta) o un pago de una cuenta corriente."""

    id: Optional[int] = Field(default=None, primary_key=True)
    cuenta_id: int = Field(foreign_key="cuentacorriente.id", index=True)
    fecha: datetime = Field(
        default_factory=ahora, sa_column=Column(FechaUTC(), nullable=False, index=True)
    )
    tipo: str  # "venta" (suma deuda) o "pago" (resta deuda)
    monto: int  # centavos, siempre positivo
    metodo: str = ""  # en los pagos: con qué pagó (efectivo, transferencia...)
    # Sin foreign key a propósito: si se borran ventas (reset de pruebas) no se rompe nada.
    venta_id: Optional[int] = Field(default=None, index=True)
    # En los pagos: a qué deuda se aplicó. None = pago general, 0 = deuda inicial, otro = N° de ticket.
    aplicado_a: Optional[int] = Field(default=None)
    nota: str = ""