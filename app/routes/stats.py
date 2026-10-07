from collections import defaultdict
from datetime import date, datetime, time, timedelta
from statistics import mean, median
from typing import Optional
from zoneinfo import ZoneInfo

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import func
from sqlmodel import Session, select

from app.database import get_session
from app.models.models import (
    CATEGORIA_DEFAULT,
    CATEGORIA_RAPIDO,
    CODIGO_RAPIDO,
    ItemVenta,
    Pago,
    Producto,
    Venta,
)

router = APIRouter(prefix="/stats", tags=["Estadísticas"])
TZ = ZoneInfo("America/Argentina/Buenos_Aires")

MAX_DIAS = 366
MAX_PRODUCTOS = 500  # productos que viajan al navegador (el ranking se arma allá)
TOP_LISTAS = 10
DIAS_RIESGO = 14  # un producto está "en riesgo" si el stock alcanza menos de estos días

RANGOS_TIEMPO = [(60, "Menos de 1 min"), (180, "1 a 3 min"), (300, "3 a 5 min"), (600, "5 a 10 min")]
ETIQUETA_TIEMPO_MAX = "Más de 10 min"
RANGOS_PEDIDO = [(1, "1 unidad"), (5, "2 a 5"), (10, "6 a 10"), (24, "11 a 24"), (49, "25 a 49")]
ETIQUETA_PEDIDO_MAX = "50 o más"


def _limites(desde: date, hasta: date):
    ini = datetime.combine(desde, time.min, tzinfo=TZ)
    fin = datetime.combine(hasta + timedelta(days=1), time.min, tzinfo=TZ)
    return ini, fin


def _primero_de_mes(d: date, meses_atras: int) -> date:
    y, m = d.year, d.month - meses_atras
    while m <= 0:
        m += 12
        y -= 1
    return date(y, m, 1)


def _bucket(valor: float, rangos: list[tuple[float, str]], conteo: list[int], estricto: bool):
    for i, (limite, _) in enumerate(rangos):
        if (valor < limite) if estricto else (valor <= limite):
            conteo[i] += 1
            return
    conteo[-1] += 1


@router.get("/dashboard")
def dashboard(desde: Optional[date] = None, hasta: Optional[date] = None, session: Session = Depends(get_session)):
    hoy = datetime.now(TZ).date()
    hasta = hasta or hoy
    desde = desde or hasta - timedelta(days=29)
    if desde > hasta:
        raise HTTPException(422, "La fecha 'desde' no puede ser posterior a 'hasta'")
    dias = (hasta - desde).days + 1
    if dias > MAX_DIAS:
        raise HTTPException(422, f"El rango máximo es de {MAX_DIAS} días")

    ini, fin = _limites(desde, hasta)
    prev_hasta = desde - timedelta(days=1)
    prev_desde = prev_hasta - timedelta(days=dias - 1)
    prev_ini, prev_fin = _limites(prev_desde, prev_hasta)

    # Filtros base
    wh_cobradas = (Venta.fecha_cobro >= ini, Venta.fecha_cobro < fin, Venta.estado == "cobrada", Venta.anulada == False)
    wh_prev = (Venta.fecha_cobro >= prev_ini, Venta.fecha_cobro < prev_fin, Venta.estado == "cobrada", Venta.anulada == False)

    # 1. KPIs Globales (Directo en DB)
    kpis_v = session.exec(select(func.count(Venta.id), func.coalesce(func.sum(Venta.total), 0)).where(*wh_cobradas)).first()
    ventas, total = kpis_v if kpis_v else (0, 0)

    unidades = session.exec(select(func.coalesce(func.sum(ItemVenta.cantidad), 0)).join(Venta).where(*wh_cobradas)).first() or 0

    kpis_vp = session.exec(select(func.count(Venta.id), func.coalesce(func.sum(Venta.total), 0)).where(*wh_prev)).first()
    ventas_prev, total_prev = kpis_vp if kpis_vp else (0, 0)

    unidades_prev = session.exec(select(func.coalesce(func.sum(ItemVenta.cantidad), 0)).join(Venta).where(*wh_prev)).first() or 0

    anuladas = session.exec(select(func.count(Venta.id)).where(Venta.fecha >= ini, Venta.fecha < fin, Venta.anulada == True)).first() or 0
    pendientes = session.exec(select(func.count(Venta.id)).where(Venta.fecha >= ini, Venta.fecha < fin, Venta.estado == "pendiente", Venta.anulada == False)).first() or 0

    # 2. Catálogo (Para cruzar datos rápidos en memoria)
    catalogo = {p.id: p for p in session.exec(select(Producto)).all()}
    rapido_id = next((p.id for p in catalogo.values() if p.codigo == CODIGO_RAPIDO), None)

    # 3. Productos y Categorías
    # Agrupamos por producto en SQL, a Python solo le llegan ~100 filas
    prod_stats = session.exec(
        select(
            ItemVenta.producto_id,
            func.lower(func.trim(ItemVenta.nombre)),
            ItemVenta.nombre,
            func.sum(ItemVenta.cantidad),
            func.sum(ItemVenta.subtotal),
            func.count(func.distinct(ItemVenta.venta_id))
        ).join(Venta).where(*wh_cobradas).group_by(ItemVenta.producto_id, func.lower(func.trim(ItemVenta.nombre)))
    ).all()

    prods = {}
    for pid, norm_nom, nom, cant, sub, tks in prod_stats:
        rapido = (pid == rapido_id)
        clave = f"r:{norm_nom}" if rapido else f"p:{pid}"
        cat = CATEGORIA_RAPIDO if rapido else (catalogo[pid].categoria if pid in catalogo else CATEGORIA_DEFAULT)
        prods[clave] = {"nombre": nom, "categoria": cat, "unidades": cant, "monto": sub, "tickets": tks, "pid": pid}

    prod_stats_prev = session.exec(
        select(
            ItemVenta.producto_id,
            func.lower(func.trim(ItemVenta.nombre)),
            func.sum(ItemVenta.cantidad)
        ).join(Venta).where(*wh_prev).group_by(ItemVenta.producto_id, func.lower(func.trim(ItemVenta.nombre)))
    ).all()

    cats = defaultdict(lambda: {"unidades": 0, "monto": 0, "productos": 0, "unidades_prev": 0})
    vendidas_pid = defaultdict(int)

    prods_prev = {}
    for pid, norm_nom, cant in prod_stats_prev:
        rapido = (pid == rapido_id)
        clave = f"r:{norm_nom}" if rapido else f"p:{pid}"
        cat = CATEGORIA_RAPIDO if rapido else (catalogo[pid].categoria if pid in catalogo else CATEGORIA_DEFAULT)
        prods_prev[clave] = cant
        cats[cat]["unidades_prev"] += cant  # Sumamos la previa de una

    productos = sorted(
        (
            {"nombre": p["nombre"], "categoria": p["categoria"], "unidades": p["unidades"], "monto": p["monto"], "tickets": p["tickets"], "unidades_prev": prods_prev.get(k, 0)}
            for k, p in prods.items()
        ),
        key=lambda p: (-p["unidades"], -p["monto"])
    )[:MAX_PRODUCTOS]

    for p in prods.values():
        c = cats[p["categoria"]]
        c["unidades"] += p["unidades"]
        c["monto"] += p["monto"]
        c["productos"] += 1
        if p["pid"] != rapido_id:
            vendidas_pid[p["pid"]] += p["unidades"]

    categorias = sorted(({"categoria": k, **v} for k, v in cats.items() if v["unidades"] > 0), key=lambda c: -c["unidades"])

    # 4. Agrupaciones temporales (SQLite resuelve el Date y la Hora ajustando a UTC-3)
    loc_dt = func.datetime(Venta.fecha_cobro, '-3 hours')
    
    v_tiempo = session.exec(
        select(
            func.date(loc_dt),
            func.strftime('%H', loc_dt),
            func.strftime('%w', loc_dt),
            func.count(Venta.id),
            func.sum(Venta.total)
        ).where(*wh_cobradas).group_by(func.date(loc_dt), func.strftime('%H', loc_dt), func.strftime('%w', loc_dt))
    ).all()

    u_tiempo = session.exec(
        select(
            func.date(loc_dt),
            func.strftime('%H', loc_dt),
            func.strftime('%w', loc_dt),
            func.sum(ItemVenta.cantidad)
        ).join(Venta).where(*wh_cobradas).group_by(func.date(loc_dt), func.strftime('%H', loc_dt), func.strftime('%w', loc_dt))
    ).all()

    serie_map = {desde + timedelta(days=i): {"unidades": 0, "tickets": 0, "total": 0} for i in range(dias)}
    horas = [{"unidades": 0, "tickets": 0, "total": 0} for _ in range(24)]
    mapa = [[0] * 24 for _ in range(7)]

    for d_str, h_str, w_str, count, tot in v_tiempo:
        if not d_str: continue
        dt_date = datetime.strptime(d_str, "%Y-%m-%d").date()
        if dt_date in serie_map:
            serie_map[dt_date]["tickets"] += count
            serie_map[dt_date]["total"] += tot
        horas[int(h_str)]["tickets"] += count
        horas[int(h_str)]["total"] += tot

    for d_str, h_str, w_str, cant in u_tiempo:
        if not d_str: continue
        dt_date = datetime.strptime(d_str, "%Y-%m-%d").date()
        if dt_date in serie_map:
            serie_map[dt_date]["unidades"] += cant
        horas[int(h_str)]["unidades"] += cant
        mapa[(int(w_str) + 6) % 7][int(h_str)] += cant

    serie = [{"fecha": d.isoformat(), **v} for d, v in serie_map.items()]

    # 5. Meses Anteriores
    mes_ini = _primero_de_mes(hasta, 11)
    mes_ini_dt = datetime.combine(mes_ini, time.min, tzinfo=TZ)
    wh_meses = (Venta.fecha_cobro >= mes_ini_dt, Venta.fecha_cobro < fin, Venta.estado == "cobrada", Venta.anulada == False)

    v_meses = session.exec(
        select(func.strftime('%Y-%m', loc_dt), func.count(Venta.id), func.sum(Venta.total))
        .where(*wh_meses).group_by(func.strftime('%Y-%m', loc_dt))
    ).all()

    u_meses = session.exec(
        select(func.strftime('%Y-%m', loc_dt), func.sum(ItemVenta.cantidad))
        .join(Venta).where(*wh_meses).group_by(func.strftime('%Y-%m', loc_dt))
    ).all()

    meses_map = {_primero_de_mes(hasta, 11 - i).strftime('%Y-%m'): {"unidades": 0, "total": 0, "tickets": 0} for i in range(12)}
    
    for m_str, count, tot in v_meses:
        if m_str in meses_map:
            meses_map[m_str]["tickets"] += count
            meses_map[m_str]["total"] += tot

    for m_str, cant in u_meses:
        if m_str in meses_map:
            meses_map[m_str]["unidades"] += cant

    meses = [{"mes": k, **v} for k, v in meses_map.items()]

    # 6. Estadísticas Matemáticas (El único listado "grande", pero son solo números)
    tamanos = session.exec(select(func.sum(ItemVenta.cantidad)).join(Venta).where(*wh_cobradas).group_by(ItemVenta.venta_id)).all()
    tamanos = [t for t in tamanos if t is not None]
    grupos_ped = [0] * (len(RANGOS_PEDIDO) + 1)
    for t in tamanos: _bucket(t, RANGOS_PEDIDO, grupos_ped, estricto=False)
    pedido = {
        "cantidad": len(tamanos),
        "promedio": round(mean(tamanos), 1) if tamanos else None,
        "mediana": round(median(tamanos), 1) if tamanos else None,
        "maximo": max(tamanos) if tamanos else None,
        "rangos": [{"label": l, "cantidad": c} for (_, l), c in zip(RANGOS_PEDIDO + [(0, ETIQUETA_PEDIDO_MAX)], grupos_ped)],
    }

    segundos = session.exec(select((func.julianday(Venta.fecha_cobro) - func.julianday(Venta.fecha)) * 86400).where(*wh_cobradas)).all()
    segundos = [s for s in segundos if s is not None and s >= 0]
    grupos_t = [0] * (len(RANGOS_TIEMPO) + 1)
    for s in segundos: _bucket(s, RANGOS_TIEMPO, grupos_t, estricto=True)
    tiempo_cobro = {
        "cantidad": len(segundos),
        "promedio": round(mean(segundos)) if segundos else None,
        "mediana": round(median(segundos)) if segundos else None,
        "minimo": round(min(segundos)) if segundos else None,
        "maximo": round(max(segundos)) if segundos else None,
        "rangos": [{"label": l, "cantidad": c} for (_, l), c in zip(RANGOS_TIEMPO + [(0, ETIQUETA_TIEMPO_MAX)], grupos_t)],
    }

    # 7. Stock y Métodos
    riesgo, parados = [], []
    for p in catalogo.values():
        if p.codigo == CODIGO_RAPIDO or not p.activo: continue
        vendido = vendidas_pid.get(p.id, 0)
        if vendido > 0:
            ritmo = vendido / dias
            cobertura = p.stock / ritmo if p.stock > 0 else 0
            if cobertura <= DIAS_RIESGO:
                riesgo.append({"nombre": p.nombre, "categoria": p.categoria, "stock": p.stock, "ritmo": round(ritmo, 1), "dias": round(cobertura, 1)})
        elif p.stock > 0:
            parados.append({"nombre": p.nombre, "categoria": p.categoria, "stock": p.stock})

    riesgo.sort(key=lambda r: (r["dias"], r["nombre"]))
    parados.sort(key=lambda r: -r["stock"])

    pagos_agrupados = session.exec(select(Pago.metodo, func.sum(Pago.monto)).join(Venta, Venta.id == Pago.venta_id).where(*wh_cobradas).group_by(Pago.metodo)).all()
    metodos = sorted(({"metodo": k, "monto": v} for k, v in pagos_agrupados), key=lambda m: -m["monto"])

    return {
        "desde": desde, "hasta": hasta, "dias": dias,
        "kpis": {
            "unidades": unidades, "unidades_anterior": unidades_prev, "ventas": ventas, "ventas_anterior": ventas_prev,
            "total": total, "total_anterior": total_prev, "unidades_por_ticket": round(unidades / ventas, 1) if ventas else 0,
            "productos_distintos": len(prods), "anuladas": anuladas, "pendientes": pendientes
        },
        "serie": serie, "horas": horas, "mapa": mapa, "meses": meses, "categorias": categorias, "productos": productos,
        "pedido": pedido, "stock": {"riesgo": riesgo[:TOP_LISTAS], "riesgo_total": len(riesgo), "parados": parados[:TOP_LISTAS], "parados_total": len(parados), "dias_riesgo": DIAS_RIESGO},
        "metodos": metodos, "tiempo_cobro": tiempo_cobro
    }