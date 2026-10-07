from sqlalchemy import event, inspect, text
from sqlmodel import Session, SQLModel, create_engine, select

engine = create_engine(
    "sqlite:///tpv.db",
    connect_args={"check_same_thread": False},
)


@event.listens_for(engine, "connect")
def set_sqlite_pragmas(dbapi_conn, _):
    cur = dbapi_conn.cursor()
    cur.execute("PRAGMA journal_mode=WAL")
    cur.execute("PRAGMA foreign_keys=ON")
    cur.close()


# Columnas agregadas después de crear la tabla: (tabla, columna, definición SQL)
MIGRACIONES = [
    ("venta", "estado", "VARCHAR NOT NULL DEFAULT 'cobrada'"),
    ("venta", "fecha_cobro", "DATETIME"),
    ("producto", "categoria", "VARCHAR NOT NULL DEFAULT 'Sin categoría'"),
    ("remito", "pagado", "INTEGER NOT NULL DEFAULT 0"),
    ("gasto", "periodicidad", "VARCHAR"),
    ("movimientocuenta", "aplicado_a", "INTEGER"),  # <--- nueva
]

# Índices para que las estadísticas sigan rápidas cuando haya muchas ventas.
# (Mismos nombres que genera SQLAlchemy, así no se duplican en bases nuevas.)
INDICES = [
    "CREATE INDEX IF NOT EXISTS ix_venta_fecha ON venta (fecha)",
    "CREATE INDEX IF NOT EXISTS ix_venta_fecha_cobro ON venta (fecha_cobro)",
    "CREATE INDEX IF NOT EXISTS ix_venta_estado ON venta (estado)",
    "CREATE INDEX IF NOT EXISTS ix_itemventa_producto_id ON itemventa (producto_id)",
    "CREATE INDEX IF NOT EXISTS ix_producto_categoria ON producto (categoria)",
]


def migrar():
    insp = inspect(engine)
    with engine.begin() as conn:
        for tabla, columna, definicion in MIGRACIONES:
            if not insp.has_table(tabla):
                continue
            existentes = {c["name"] for c in insp.get_columns(tabla)}
            if columna not in existentes:
                conn.execute(text(f"ALTER TABLE {tabla} ADD COLUMN {columna} {definicion}"))
                if (tabla, columna) == ("venta", "fecha_cobro"):
                    # Las ventas ya cobradas no tienen fecha de cobro real:
                    # se aproxima con la fecha del ticket.
                    conn.execute(
                        text("UPDATE venta SET fecha_cobro = fecha WHERE estado = 'cobrada'")
                    )
                if (tabla, columna) == ("remito", "pagado"):
                    # Los remitos que ya estaban cargados se dan por pagados:
                    # la gestión de deudas arranca desde los remitos nuevos.
                    conn.execute(text("UPDATE remito SET pagado = monto"))
        for indice in INDICES:
            conn.execute(text(indice))


def asegurar_producto_rapido():
    """Crea (una sola vez) el producto comodín al que se asocian las ventas rápidas."""
    from app.models.models import CATEGORIA_RAPIDO, CODIGO_RAPIDO, Producto

    with Session(engine) as session:
        existe = session.exec(select(Producto).where(Producto.codigo == CODIGO_RAPIDO)).first()
        if not existe:
            session.add(
                Producto(
                    codigo=CODIGO_RAPIDO,
                    nombre="Producto rápido",
                    precio=0,
                    stock=0,
                    categoria=CATEGORIA_RAPIDO,
                )
            )
            session.commit()


def crear_tablas():
    from app.models import models  # noqa: F401  (registra las tablas)
    SQLModel.metadata.create_all(engine)
    migrar()
    asegurar_producto_rapido()


def get_session():
    with Session(engine) as session:
        yield session