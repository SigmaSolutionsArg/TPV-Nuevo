"""Simulacro masivo para pruebas de rendimiento (Stress Test).
Genera cientos de miles de tickets y millones de renglones.

Uso (desde la carpeta raíz del proyecto, con el servidor APAGADO y el .venv activo):

    python seed_demo.py --limpiar --escala 50

Opciones:
    --dias 60          cantidad de días a simular (termina hoy)
    --limpiar          borra productos y ventas actuales (antes hace un respaldo de la base)
    --pendientes 3     tickets recién generados que quedan esperando en la caja
    --semilla 7        misma semilla = mismo simulacro
    --escala 10        multiplicador de volumen (10 = 10 veces más tickets diarios)

Cuentas corrientes: el simulacro crea 8 clientes con cuenta (algunos con deuda inicial),
les carga ventas "a cuenta" (total o parcial) y les simula pagos generales y dirigidos a una
deuda puntual (aplicado_a). Una cuenta queda inactiva y otra queda como "mala pagadora".

Para unos ~1000 tickets:   python seed_demo.py --limpiar --dias 28
"""

import argparse
import math
import random
import sqlite3
from datetime import date, datetime, timedelta
from pathlib import Path
from zoneinfo import ZoneInfo

from sqlalchemy import delete, func
from sqlmodel import Session, select

from app.database import crear_tablas, engine
from app.models.models import (
    CODIGO_RAPIDO,
    METODO_CUENTA,
    CuentaCorriente,
    ItemVenta,
    MovimientoCuenta,
    Pago,
    Producto,
    Venta,
    RemitoFoto,
    RemitoItem,
    Remito,
    Proveedor,
)

TZ = ZoneInfo("America/Argentina/Buenos_Aires")
FERIADOS = {
    date(2026, 8, 17),
    date(2026, 10, 12),
    date(2026, 11, 23),
    date(2026, 12, 8),
    date(2026, 12, 25),
}

# ----------------------------------------------------------------------------
# CATÁLOGO: (nombre, precio en pesos por bulto/unidad de venta)
# ----------------------------------------------------------------------------
CATALOGO = {
    "Bebidas": [
        ("Gaseosa Cola 2,25 L x6", 14800),
        ("Gaseosa Lima-Limón 2,25 L x6", 13900),
        ("Gaseosa Naranja 2,25 L x6", 13900),
        ("Agua Mineral 2 L x6", 7200),
        ("Agua con Gas 2 L x6", 7800),
        ("Jugo en Polvo Naranja x20", 9600),
        ("Cerveza Rubia Lata 473 ml x24", 38500),
        ("Cerveza Rubia Botella 1 L x12", 28900),
        ("Vino Tinto Malbec 750 ml x6", 21500),
        ("Energizante Lata 473 ml x24", 52000),
    ],
    "Almacén": [
        ("Arroz Largo Fino 1 kg x10", 17800),
        ("Fideos Tirabuzón 500 g x12", 13200),
        ("Fideos Spaghetti 500 g x12", 13200),
        ("Harina de Trigo 000 1 kg x10", 11500),
        ("Aceite de Girasol 900 ml x12", 36800),
        ("Azúcar Común 1 kg x10", 12900),
        ("Yerba Mate 1 kg x10", 52400),
        ("Sal Fina 500 g x20", 9800),
        ("Polenta 500 g x12", 7900),
        ("Lentejas Secas 400 g x12", 14400),
    ],
    "Lácteos y Fiambres": [
        ("Leche Entera Larga Vida 1 L x12", 19800),
        ("Leche en Polvo Entera 800 g x6", 41500),
        ("Yogur Bebible Vainilla 1 L x6", 11700),
        ("Manteca 200 g x20", 38900),
        ("Crema de Leche 350 g x12", 22400),
        ("Dulce de Leche Clásico 400 g x12", 27600),
        ("Queso Cremoso Pieza 4 kg", 31500),
        ("Queso Rallado 40 g x50", 28800),
        ("Jamón Cocido Natural Pieza 4 kg", 36000),
        ("Salchichas Tipo Viena x6 paq.", 14700),
    ],
    "Limpieza": [
        ("Lavandina 1 L x12", 9800),
        ("Detergente 750 ml x12", 17500),
        ("Jabón en Polvo 3 kg x4", 33200),
        ("Suavizante 900 ml x12", 21400),
        ("Limpiador de Pisos 900 ml x12", 13900),
        ("Desengrasante Cocina 500 ml x12", 15800),
        ("Bolsas de Residuos 50x70 x10 paq.", 12600),
        ("Esponja Multiuso x10 paq.", 8900),
        ("Trapo de Piso x12", 14400),
        ("Papel Higiénico 4 rollos x12 paq.", 36900),
    ],
    "Perfumería e Higiene": [
        ("Shampoo 400 ml x12", 31800),
        ("Acondicionador 400 ml x12", 31800),
        ("Jabón de Tocador x3 x24", 28500),
        ("Pasta Dental 90 g x12", 19200),
        ("Cepillo Dental x12", 10800),
        ("Desodorante Aerosol 150 ml x12", 27400),
        ("Toallitas Femeninas x16 paq.", 24600),
        ("Máquina de Afeitar Descartable x24", 13200),
        ("Algodón 100 g x12", 9600),
        ("Jabón Líquido Manos 500 ml x12", 23800),
    ],
    "Golosinas": [
        ("Caramelos Masticables 800 g x10", 26800),
        ("Chocolate en Tableta 100 g x20", 31600),
        ("Alfajor Triple Chocolate x12", 14900),
        ("Chupetines x50", 8700),
        ("Chicles Menta x20", 9900),
        ("Gomitas Ácidas 500 g x10", 24500),
        ("Bombones Surtidos 250 g x12", 21700),
        ("Turrón x50", 11900),
        ("Pastillas Mentoladas x30", 10800),
        ("Barras de Cereal x24", 15600),
    ],
    "Snacks y Kiosco": [
        ("Papas Fritas Clásicas 150 g x12", 24800),
        ("Palitos Salados 100 g x20", 14200),
        ("Maní Salado 200 g x20", 18900),
        ("Snack de Queso 80 g x24", 19600),
        ("Nachos 150 g x12", 21300),
        ("Garrapiñada x30", 9400),
        ("Pochoclo para Microondas x20", 17600),
        ("Chizitos 90 g x30", 12400),
        ("Mix de Frutos Secos 200 g x12", 33500),
        ("Semillas de Girasol 200 g x20", 16200),
    ],
    "Galletitas y Panificados": [
        ("Galletitas Crackers 300 g x12", 16400),
        ("Galletitas Dulces Rellenas 118 g x30", 23900),
        ("Vainillas 250 g x12", 13800),
        ("Obleas 100 g x24", 15300),
        ("Tostadas Light 200 g x12", 14100),
        ("Pan Rallado 500 g x12", 11200),
        ("Pan Lactal 550 g x10", 21800),
        ("Prepizza x10", 19900),
        ("Budín Marmolado x12", 17400),
        ("Bizcochuelo Premezcla 500 g x12", 13200),
    ],
    "Conservas y Salsas": [
        ("Atún en Aceite 170 g x12", 31200),
        ("Caballa al Natural 300 g x12", 28900),
        ("Arvejas 300 g x12", 11800),
        ("Choclo Cremoso 300 g x12", 13400),
        ("Durazno en Almíbar 820 g x12", 38700),
        ("Puré de Tomate 520 g x12", 10900),
        ("Tomate Perita 400 g x12", 12100),
        ("Mayonesa 475 g x12", 23600),
        ("Ketchup 250 g x12", 13700),
        ("Mostaza 250 g x12", 11300),
    ],
    "Descartables y Bazar": [
        ("Vasos Descartables 180 cc x100", 4200),
        ("Platos Descartables 22 cm x50", 3900),
        ("Servilletas de Papel x100", 2800),
        ("Film Transparente 30 cm x 100 m", 6900),
        ("Papel Aluminio 30 cm x 40 m", 5400),
        ("Bolsas Camiseta 40x50 x1 kg", 8800),
        ("Pilas AA x4 paq.", 3600),
        ("Velas Blancas Pack x12", 2900),
        ("Fósforos x10 cajitas", 3800),
        ("Encendedor x50", 31400),
    ],
}

# Cantidad "típica" de bultos por renglón según categoría
CANT_TIPICA = {
    "Bebidas": 4,
    "Almacén": 4,
    "Lácteos y Fiambres": 3,
    "Limpieza": 3,
    "Perfumería e Higiene": 3,
    "Golosinas": 3,
    "Snacks y Kiosco": 3,
    "Galletitas y Panificados": 3,
    "Conservas y Salsas": 3,
    "Descartables y Bazar": 6,
}

# Tipos de cliente: qué tan seguido vienen, cuánto compran y qué categorías prefieren
CLIENTES = {
    "consumidor": dict(
        peso=14,
        lineas=(1, 3),
        cant=0.35,
        afinidad={"Snacks y Kiosco": 1.5, "Golosinas": 1.5, "Bebidas": 1.4},
    ),
    "kiosco": dict(
        peso=34,
        lineas=(3, 8),
        cant=0.8,
        afinidad={
            "Golosinas": 3,
            "Snacks y Kiosco": 3,
            "Bebidas": 2,
            "Galletitas y Panificados": 1.5,
            "Descartables y Bazar": 1.2,
        },
    ),
    "almacen": dict(
        peso=30,
        lineas=(5, 12),
        cant=1.2,
        afinidad={
            "Almacén": 2.5,
            "Conservas y Salsas": 2,
            "Lácteos y Fiambres": 1.8,
            "Limpieza": 1.8,
            "Bebidas": 1.3,
            "Perfumería e Higiene": 1.2,
        },
    ),
    "mayorista": dict(
        peso=12, lineas=(8, 18), cant=2.4, afinidad={"Bebidas": 1.8, "Almacén": 1.6}
    ),
    "gastro": dict(
        peso=10,
        lineas=(6, 14),
        cant=1.6,
        afinidad={
            "Almacén": 2.5,
            "Lácteos y Fiambres": 2.5,
            "Conservas y Salsas": 2.5,
            "Descartables y Bazar": 3,
            "Bebidas": 1.5,
            "Limpieza": 1.5,
        },
    ),
}

PAGO_POR_CLIENTE = {
    "consumidor": {
        "efectivo": 0.50,
        "debito": 0.20,
        "mercado_pago": 0.20,
        "credito": 0.05,
        "transferencia": 0.05,
    },
    "kiosco": {
        "efectivo": 0.60,
        "transferencia": 0.15,
        "mercado_pago": 0.12,
        "debito": 0.10,
        "credito": 0.03,
    },
    "almacen": {
        "efectivo": 0.42,
        "transferencia": 0.28,
        "debito": 0.12,
        "mercado_pago": 0.10,
        "credito": 0.08,
    },
    "mayorista": {
        "transferencia": 0.50,
        "efectivo": 0.20,
        "credito": 0.15,
        "debito": 0.08,
        "mercado_pago": 0.07,
    },
    "gastro": {
        "transferencia": 0.45,
        "efectivo": 0.20,
        "credito": 0.15,
        "debito": 0.12,
        "mercado_pago": 0.08,
    },
}

# ----------------------------------------------------------------------------
# CUENTAS CORRIENTES: (nombre, tipo de cliente, deuda inicial en pesos, cada cuántos días
# paga en promedio (0 = no paga nunca), nota)
# ----------------------------------------------------------------------------
CUENTAS_DEMO = [
    ("Kiosco Don Pepe", "kiosco", 85_000, 5, "Paga los viernes"),
    ("Almacén La Esquina", "almacen", 240_000, 7, ""),
    ("Almacén Los Pinos", "almacen", 0, 10, "Cuenta nueva"),
    ("Rotisería Don Carlos", "gastro", 0, 4, ""),
    ("Restaurante La Posta", "gastro", 520_000, 8, "Paga por transferencia"),
    ("Mayorista Hnos. Pérez", "mayorista", 1_200_000, 10, "Compra por pallet"),
    ("Kiosco El Sol", "kiosco", 35_000, 30, "Mala pagadora: se atrasa siempre"),
    ("Kiosco Rivas (cerrado)", "kiosco", 60_000, 0, "Cerró el local, no vuelve a comprar"),
]
CUENTA_INACTIVA = "Kiosco Rivas (cerrado)"

# Probabilidad de que un ticket de cada tipo de cliente se cargue a cuenta
P_CUENTA = {"kiosco": 0.10, "almacen": 0.15, "mayorista": 0.10, "gastro": 0.12}

# Con qué paga el cliente la deuda de su cuenta
PAGO_DEUDA = {
    "efectivo": 0.50,
    "transferencia": 0.35,
    "mercado_pago": 0.10,
    "debito": 0.05,
}

RAPIDOS = [
    ("Flete a domicilio", 8000, 25000),
    ("Bolsa de hielo 5 kg", 2500, 4000),
    ("Cargador USB", 6000, 12000),
    ("Escoba", 4500, 9000),
    ("Pan fresco x kg", 2500, 3500),
    ("Fiambre feteado 1/4 kg", 3000, 6000),
    ("Alquiler de heladera", 15000, 30000),
    ("Bolsa reutilizable", 1200, 2500),
]

# Franja horaria -> peso (más tickets en la mañana y a la tarde)
HORAS_SEMANA = {
    7: 3,
    8: 7,
    9: 10,
    10: 10,
    11: 8,
    12: 5,
    13: 4,
    14: 6,
    15: 8,
    16: 6,
    17: 3,
}
HORAS_SABADO = {8: 6, 9: 9, 10: 10, 11: 8, 12: 5, 13: 2}


# ----------------------------------------------------------------------------
# Utilidades
# ----------------------------------------------------------------------------
def ean13(n: int) -> str:
    base = f"779{n:09d}"
    suma = sum(int(c) * (3 if i % 2 else 1) for i, c in enumerate(base))
    return base + str((10 - suma % 10) % 10)


def pesos_a_centavos(p: float) -> int:
    return int(round(p / 10) * 10) * 100  # precios siempre múltiplos de $10


def elegir(rng, pesos: dict):
    return rng.choices(list(pesos), list(pesos.values()))[0]


def respaldo() -> Path:
    ruta = Path(f"tpv_respaldo_{datetime.now():%Y%m%d_%H%M%S}.db")
    origen, destino = sqlite3.connect(engine.url.database), sqlite3.connect(ruta)
    origen.backup(destino)
    origen.close()
    destino.close()
    return ruta


# ----------------------------------------------------------------------------
# Catálogo
# ----------------------------------------------------------------------------
def crear_catalogo(s: Session, rng, inicio: datetime, escala: int) -> list[dict]:
    lista = [(cat, n, p) for cat, items in CATALOGO.items() for n, p in items]
    assert (
        len(lista) == 100
    ), f"El catálogo tiene {len(lista)} productos, tienen que ser 100"

    orden = list(range(100))
    rng.shuffle(orden)  # el ranking de popularidad no sigue el orden de las categorías
    pop = {i: 1 / (rank**0.5) for rank, i in enumerate(orden, start=1)}
    total_pop = sum(pop.values())

    ranking = {i: rank for rank, i in enumerate(orden, start=1)}
    parados = set(
        rng.sample([i for i in range(100) if ranking[i] > 45], 6)
    )  # cola larga: no se venden
    sin_repo = set(
        rng.sample([i for i in range(100) if 3 <= ranking[i] <= 25], 5)
    )  # populares que no se reponen
    con_tendencia = set(rng.sample(range(100), 15))

    infos = []
    for i, (cat, nombre, precio) in enumerate(lista):
        share = pop[i] / total_pop
        # Ajustamos la estimación de ventas diarias según la ESCALA
        est = max(2.0, share * 1200) * escala

        if i in sin_repo:
            stock = round(est * rng.uniform(52, 58))
        else:
            stock = round(est * rng.uniform(10, 20)) + 20
        prod = Producto(
            codigo=ean13(i * 7919 + 1013),
            nombre=nombre,
            precio=pesos_a_centavos(precio),
            stock=stock,
            categoria=cat,
            activo=True,
            updated_at=inicio,
        )
        s.add(prod)
        infos.append(
            dict(
                prod=prod,
                cat=cat,
                est=est,
                peso=0.0 if i in parados else pop[i],
                parado=i in parados,
                sin_repo=i in sin_repo,
                tend=rng.uniform(-0.6, 0.8) if i in con_tendencia else 0.0,
            )
        )
    s.flush()
    return infos


# ----------------------------------------------------------------------------
# Mostrador: arma un ticket
# ----------------------------------------------------------------------------
def crear_ticket(s: Session, rng, infos, rapido: Producto, t: datetime, avance: float):
    tipo = elegir(rng, {k: v["peso"] for k, v in CLIENTES.items()})
    cfg = CLIENTES[tipo]

    pesos = []
    for p in infos:
        w = p["peso"]
        if w <= 0 or p["prod"].stock <= 0:
            pesos.append(0.0)
            continue
        w *= cfg["afinidad"].get(p["cat"], 1)
        w *= max(0.15, 1 + p["tend"] * (avance - 0.5) * 2)
        pesos.append(w)

    venta = Venta(fecha=t, estado="pendiente", synced_at=None)
    s.add(venta)
    s.flush()

    total = 0
    renglones = []
    for _ in range(rng.randint(*cfg["lineas"])):
        if sum(pesos) <= 0:
            break
        k = rng.choices(range(len(infos)), pesos)[0]
        pesos[k] = 0.0
        prod = infos[k]["prod"]
        cant = max(
            1,
            round(
                rng.lognormvariate(
                    math.log(CANT_TIPICA[infos[k]["cat"]] * cfg["cant"]), 0.55
                )
            ),
        )
        cant = min(cant, 48, prod.stock)
        sub = prod.precio * cant
        s.add(
            ItemVenta(
                venta_id=venta.id,
                producto_id=prod.id,
                nombre=prod.nombre,
                precio_unitario=prod.precio,
                cantidad=cant,
                subtotal=sub,
            )
        )
        prod.stock -= cant
        prod.updated_at = t
        s.add(prod)
        renglones.append((prod, cant))
        total += sub

    if rng.random() < 0.04 or not renglones:  # producto rápido (fuera del catálogo)
        nombre, pmin, pmax = rng.choice(RAPIDOS)
        precio = pesos_a_centavos(rng.uniform(pmin, pmax))
        cant = rng.randint(1, 3)
        s.add(
            ItemVenta(
                venta_id=venta.id,
                producto_id=rapido.id,
                nombre=nombre,
                precio_unitario=precio,
                cantidad=cant,
                subtotal=precio * cant,
            )
        )
        total += precio * cant

    venta.total = total
    s.add(venta)
    return venta, tipo, renglones


# ----------------------------------------------------------------------------
# Caja: cobra o anula (misma lógica que /caja/cobrar y /ventas/{id}/anular)
# ----------------------------------------------------------------------------
def armar_pagos(rng, tipo: str, total: int) -> list[tuple[str, int]]:
    def con_billetes(monto: int) -> int:
        if rng.random() < 0.30:
            return monto  # paga justo
        paso = rng.choices([1000, 5000, 10000], [0.5, 0.3, 0.2])[0] * 100
        return math.ceil(monto / paso) * paso

    metodo = elegir(rng, PAGO_POR_CLIENTE[tipo])
    if total >= 2_000_000 and rng.random() < 0.12:  # pago mixto
        otro = rng.choice(
            [m for m in ("transferencia", "debito", "mercado_pago", "credito")]
        )
        parte = int(round(total * rng.uniform(0.3, 0.7) / 100_000) * 100_000)
        parte = max(100_000, min(parte, total - 100_000))
        return [(otro, parte), ("efectivo", con_billetes(total - parte))]
    return [(metodo, con_billetes(total) if metodo == "efectivo" else total)]


def cobrar(s: Session, rng, venta: Venta, tipo: str, t_cobro: datetime):
    pagos = armar_pagos(rng, tipo, venta.total)
    vuelto = sum(m for _, m in pagos) - venta.total
    for metodo, monto in pagos:
        real = monto
        if metodo == "efectivo" and vuelto > 0:
            descuento = min(real, vuelto)
            real -= descuento
            vuelto -= descuento
        if real > 0:
            s.add(Pago(venta_id=venta.id, metodo=metodo, monto=real))
    venta.estado = "cobrada"
    venta.fecha_cobro = t_cobro
    venta.synced_at = None
    s.add(venta)


def crear_cuentas(s: Session, inicio: datetime):
    """Crea las cuentas de la demo. Devuelve (estado por cuenta, ids por tipo de cliente)."""
    estados: dict[int, dict] = {}
    por_tipo: dict[str, list[int]] = {}
    ids: dict[str, int] = {}
    for nombre, tipo, deuda, freq, nota in CUENTAS_DEMO:
        c = CuentaCorriente(
            nombre=nombre,
            deuda_inicial=deuda * 100,
            nota=nota,
            activo=True,  # la inactiva se marca recién al final de la simulación
            created_at=inicio,
        )
        s.add(c)
        s.flush()
        ids[nombre] = c.id
        por_tipo.setdefault(tipo, []).append(c.id)
        estados[c.id] = {
            "freq": freq,
            "saldo": deuda * 100,
            # deudas abiertas (ref 0 = deuda inicial, otro = N° de ticket) con lo que falta pagar
            "deudas": [{"ref": 0, "pend": deuda * 100}] if deuda > 0 else [],
        }
    return estados, por_tipo, ids


def elegir_cuenta(rng, tipo: str, por_tipo: dict[str, list[int]]):
    """Devuelve el id de la cuenta a la que se carga el ticket, o None si se cobra normal."""
    if tipo in P_CUENTA and por_tipo.get(tipo) and rng.random() < P_CUENTA[tipo]:
        return rng.choice(por_tipo[tipo])
    return None


def cobrar_a_cuenta(s: Session, rng, venta: Venta, cuenta_id: int, estados, t_cobro: datetime):
    """Misma lógica que /caja/cobrar con un pago "cuenta_corriente" (total o parcial)."""
    total = venta.total
    parte = total
    if total >= 200_000 and rng.random() < 0.15:  # parte a cuenta, el resto en efectivo
        parte = int(round(total * rng.uniform(0.4, 0.8) / 10_000) * 10_000)
        parte = max(10_000, min(parte, total - 10_000))

    s.add(Pago(venta_id=venta.id, metodo=METODO_CUENTA, monto=parte))
    if parte < total:
        s.add(Pago(venta_id=venta.id, metodo="efectivo", monto=total - parte))
    s.add(
        MovimientoCuenta(
            cuenta_id=cuenta_id, fecha=t_cobro, tipo="venta", monto=parte, venta_id=venta.id
        )
    )
    venta.estado = "cobrada"
    venta.fecha_cobro = t_cobro
    venta.synced_at = None
    s.add(venta)

    e = estados[cuenta_id]
    e["saldo"] += parte
    e["deudas"].append({"ref": venta.id, "pend": parte})


def pagos_de_cuentas(s: Session, rng, estados, dia: date, ahora: datetime) -> int:
    """El día `dia`, algunas cuentas le pagan a la deuda (general o dirigido a una deuda)."""
    cantidad = 0
    horas = HORAS_SABADO if dia.weekday() == 5 else HORAS_SEMANA
    for cuenta_id, e in estados.items():
        if e["freq"] <= 0 or e["saldo"] <= 0 or rng.random() > 1 / e["freq"]:
            continue

        saldo = e["saldo"]
        if rng.random() < 0.45:
            monto = saldo  # salda todo
        else:  # pago a cuenta, en múltiplos de $500
            monto = int(round(saldo * rng.uniform(0.2, 0.7) / 50_000) * 50_000)
        monto = min(saldo, max(50_000, monto))

        aplicado_a = None  # pago general: cubre primero lo más viejo
        if rng.random() < 0.40 and e["deudas"]:  # pago dirigido a una deuda puntual
            d = rng.choice(e["deudas"])
            aplicado_a = d["ref"]
            monto = min(monto, d["pend"])

        momento = datetime(
            dia.year, dia.month, dia.day,
            elegir(rng, horas), rng.randint(0, 59), rng.randint(0, 59),
            tzinfo=TZ,
        )
        if momento > ahora:
            continue

        s.add(
            MovimientoCuenta(
                cuenta_id=cuenta_id,
                fecha=momento,
                tipo="pago",
                monto=monto,
                metodo=elegir(rng, PAGO_DEUDA),
                aplicado_a=aplicado_a,
            )
        )
        cantidad += 1
        e["saldo"] -= monto

        if aplicado_a is not None:
            d["pend"] -= monto
        else:
            libre = monto
            for d in e["deudas"]:
                puesto = min(libre, d["pend"])
                d["pend"] -= puesto
                libre -= puesto
                if libre <= 0:
                    break
        e["deudas"] = [d for d in e["deudas"] if d["pend"] > 0]
    return cantidad


def anular(s: Session, venta: Venta, renglones):
    for prod, cant in renglones:
        prod.stock += cant
        s.add(prod)
    venta.anulada = True
    venta.estado = "anulada"
    venta.synced_at = None
    s.add(venta)


# ----------------------------------------------------------------------------
# Simulación
# ----------------------------------------------------------------------------
def tickets_del_dia(rng, dia: date, avance: float, escala: int) -> int:
    base = 22 if dia.weekday() == 5 else 38
    mult = 1 + 0.22 * avance  # el negocio crece de a poco
    if dia.day <= 5 or dia.day >= 28:
        mult *= 1.25  # cobro de sueldos / fin de mes
    elif dia.day in (15, 16):
        mult *= 1.10
    if dia.weekday() in (0, 4):
        mult *= 1.10
    # Multiplicamos la cantidad de tickets por la ESCALA
    return max(5, round(base * mult * rng.lognormvariate(0, 0.14))) * escala


def main():
    ap = argparse.ArgumentParser(
        description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter
    )
    ap.add_argument("--dias", type=int, default=60)
    ap.add_argument("--limpiar", action="store_true")
    ap.add_argument("--pendientes", type=int, default=3)
    ap.add_argument("--semilla", type=int, default=7)
    ap.add_argument(
        "--escala",
        type=int,
        default=1,
        help="Multiplicador de volumen (ej: 50 genera 50 veces más tickets)",
    )
    args = ap.parse_args()

    rng = random.Random(args.semilla)
    crear_tablas()
    ahora = datetime.now(TZ)
    hoy = ahora.date()
    inicio_dia = hoy - timedelta(days=args.dias - 1)
    inicio = datetime.combine(inicio_dia, datetime.min.time(), tzinfo=TZ)

    with Session(engine, expire_on_commit=False) as s:
        hay_ventas = s.exec(select(func.count()).select_from(Venta)).one()
        hay_prods = s.exec(
            select(func.count())
            .select_from(Producto)
            .where(Producto.codigo != CODIGO_RAPIDO)
        ).one()
        hay_cuentas = s.exec(select(func.count()).select_from(CuentaCorriente)).one()
        if (hay_ventas or hay_prods or hay_cuentas) and not args.limpiar:
            print(
                f"La base ya tiene {hay_prods} productos, {hay_ventas} ventas "
                f"y {hay_cuentas} cuentas corrientes."
            )
            print(
                "Si querés reemplazarlos por el simulacro masivo, corré:  python seed_demo.py --limpiar --escala 50"
            )
            return
        if args.limpiar:
            if hay_ventas or hay_prods:
                print("Respaldo de la base:", respaldo())

            # 1. Limpiar módulo de Compras (Hijos primero)
            s.exec(delete(RemitoFoto))
            s.exec(delete(RemitoItem))
            s.exec(delete(Remito))
            s.exec(delete(Proveedor))

            # 2. Limpiar módulo de Ventas
            # Cuentas corrientes: se borra todo (movimientos primero, después las cuentas)
            # porque los pagos dirigidos (aplicado_a) apuntan a tickets que ya no van a existir.
            s.exec(delete(MovimientoCuenta))
            s.exec(delete(CuentaCorriente))
            s.exec(delete(Pago))
            s.exec(delete(ItemVenta))
            s.exec(delete(Venta))

            # 3. Finalmente borrar los Productos (excepto el rápido)
            s.exec(delete(Producto).where(Producto.codigo != CODIGO_RAPIDO))
            s.commit()

        rapido = s.exec(select(Producto).where(Producto.codigo == CODIGO_RAPIDO)).one()
        infos = crear_catalogo(s, rng, inicio, args.escala)
        estados, cuentas_por_tipo, cuenta_ids = crear_cuentas(s, inicio)
        s.commit()
        print(f"Catálogo creado: {len(infos)} productos en {len(CATALOGO)} categorías.")
        print(f"Cuentas corrientes creadas: {len(estados)}.")
        print(
            f"Iniciando simulación de {args.dias} días con multiplicador x{args.escala}... esto puede tardar."
        )

        tot_t = tot_anul = tot_pend = 0
        tot_cargos = tot_pagos_cta = 0
        for d_idx in range(args.dias):
            dia = inicio_dia + timedelta(days=d_idx)
            avance = d_idx / max(1, args.dias - 1)

            if d_idx == args.dias // 2:  # inflación: todos los precios suben ~7%
                for p in infos:
                    p["prod"].precio = pesos_a_centavos(p["prod"].precio / 100 * 1.07)
                    p["prod"].updated_at = datetime.combine(
                        dia, datetime.min.time(), tzinfo=TZ
                    )
                    s.add(p["prod"])

            if dia.weekday() == 6 or dia in FERIADOS:
                continue  # cerrado

            for p in infos:  # reposición de mercadería
                if not p["sin_repo"] and p["prod"].stock < p["est"] * 4:
                    p["prod"].stock += round(p["est"] * rng.uniform(10, 16)) + 10
                    p["prod"].updated_at = datetime.combine(
                        dia, datetime.min.time(), tzinfo=TZ
                    )
                    s.add(p["prod"])

            horas = HORAS_SABADO if dia.weekday() == 5 else HORAS_SEMANA
            momentos = sorted(
                datetime(
                    dia.year,
                    dia.month,
                    dia.day,
                    elegir(rng, horas),
                    rng.randint(0, 59),
                    rng.randint(0, 59),
                    tzinfo=TZ,
                )
                for _ in range(tickets_del_dia(rng, dia, avance, args.escala))
            )
            if dia == hoy:
                momentos = [m for m in momentos if m <= ahora]

            for t in momentos:
                venta, tipo, renglones = crear_ticket(s, rng, infos, rapido, t, avance)
                tot_t += 1
                if rng.random() < 0.022:  # el cajero anula el ticket
                    anular(s, venta, renglones)
                    tot_anul += 1
                    continue
                espera = min(
                    1800,
                    rng.lognormvariate(math.log(100), 0.65)
                    + (rng.uniform(300, 1200) if rng.random() < 0.04 else 0),
                )
                t_cobro = t + timedelta(seconds=espera)
                if t_cobro > ahora:
                    tot_pend += 1  # todavía no se cobró
                else:
                    cuenta_id = elegir_cuenta(rng, tipo, cuentas_por_tipo)
                    if cuenta_id is not None:
                        cobrar_a_cuenta(s, rng, venta, cuenta_id, estados, t_cobro)
                        tot_cargos += 1
                    else:
                        cobrar(s, rng, venta, tipo, t_cobro)

            tot_pagos_cta += pagos_de_cuentas(s, rng, estados, dia, ahora)
            s.commit()

            # Limpieza de memoria (clave para pruebas de estrés gigantes)
            s.expunge_all()

            if dia.weekday() == 5 or d_idx == args.dias - 1:
                print(f"  ... hasta {dia:%d/%m}: {tot_t} tickets generados")

        # Tickets recién salidos del mostrador, esperando en la caja
        for _ in range(args.pendientes):
            t = ahora - timedelta(minutes=rng.randint(1, 8), seconds=rng.randint(0, 59))
            crear_ticket(s, rng, infos, rapido, t, 1.0)
            tot_t += 1
            tot_pend += 1

        # Una cuenta queda inactiva (conserva su historial, no aparece en la caja)
        inactiva = s.get(CuentaCorriente, cuenta_ids[CUENTA_INACTIVA])
        inactiva.activo = False
        s.add(inactiva)
        s.commit()

        # ---- Resumen ----
        cobradas = s.exec(
            select(func.count()).select_from(Venta).where(Venta.estado == "cobrada")
        ).one()
        facturado = s.exec(
            select(func.coalesce(func.sum(Venta.total), 0)).where(
                Venta.estado == "cobrada"
            )
        ).one()
        unidades = s.exec(
            select(func.coalesce(func.sum(ItemVenta.cantidad), 0))
            .join(Venta, Venta.id == ItemVenta.venta_id)
            .where(Venta.estado == "cobrada")
        ).one()

        # Volvemos a traer los productos para calcular el stock en riesgo tras los expunge_all
        productos_finales = {p.id: p for p in s.exec(select(Producto)).all()}
        sin_stock = sum(1 for p in infos if productos_finales[p["prod"].id].stock <= 0)
        riesgo = sum(
            1
            for p in infos
            if p["sin_repo"] and productos_finales[p["prod"].id].stock < p["est"] * 14
        )

        print("\n==== STRESS TEST FINALIZADO ====")
        print(f"Tickets generados : {tot_t:,}".replace(",", "."))
        print(f"  cobrados        : {cobradas:,}".replace(",", "."))
        print(f"  anulados        : {tot_anul:,}".replace(",", "."))
        print(f"  pendientes      : {tot_pend:,}".replace(",", "."))
        print(f"Unidades vendidas : {unidades:,}".replace(",", "."))
        print(f"Facturación       : ${facturado / 100:,.0f}".replace(",", "."))
        print(f"Cuentas corrientes: {len(estados)} cuentas, 1 inactiva")
        print(f"  ventas a cuenta : {tot_cargos:,}".replace(",", "."))
        print(f"  pagos de deuda  : {tot_pagos_cta:,}".replace(",", "."))
        deuda_total = sum(e["saldo"] for e in estados.values())
        print(f"  deuda total     : ${deuda_total / 100:,.0f}".replace(",", "."))
        print(
            f"Sin movimiento    : {sum(1 for p in infos if p['parado'])} productos (para 'Sin movimiento')"
        )
        print(
            f"Stock en riesgo   : {riesgo} productos populares sin reposición; {sin_stock} agotados"
        )
        print("\nLevantá el servidor y testeá el rendimiento del Dashboard.")


if __name__ == "__main__":
    main()