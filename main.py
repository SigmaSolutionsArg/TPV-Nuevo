from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import FastAPI
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles

from app.database import crear_tablas
from app.routes import (
    caja,
    compras,
    cuentas,
    empleados,
    gastos,
    ia,
    impresion,
    productos,
    remito_ia,
    stats,
    ventas,
)


@asynccontextmanager
async def lifespan(app: FastAPI):
    crear_tablas()
    yield


app = FastAPI(title="TPV", lifespan=lifespan)
app.include_router(productos.router)
app.include_router(ventas.router)
app.include_router(caja.router)
app.include_router(impresion.router)
app.include_router(stats.router)
app.include_router(ia.router)
app.include_router(compras.router)
app.include_router(remito_ia.router)
app.include_router(gastos.router)
app.include_router(empleados.router)
app.include_router(cuentas.router)


@app.get("/salud")
def salud():
    return {"ok": True}


STATIC = Path(__file__).parent / "app" / "static"


@app.get("/", include_in_schema=False)
def index():
    return FileResponse(STATIC / "index.html")


@app.get("/precio", include_in_schema=False)
def precio():
    return FileResponse(STATIC / "precio.html")


app.mount("/static", StaticFiles(directory=STATIC), name="static")
app.mount("/fotos", StaticFiles(directory=compras.FOTOS_DIR), name="fotos")
