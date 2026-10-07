from sqlmodel import Session, text

from app.database import engine

with Session(engine) as session:
    # Los cargos a cuenta corriente apuntan a tickets: se van con ellos (pagos y cuentas se conservan)
    session.exec(text("DELETE FROM movimientocuenta WHERE tipo = 'venta'"))
    session.exec(text("DELETE FROM pago"))
    session.exec(text("DELETE FROM itemventa"))
    session.exec(text("DELETE FROM venta"))
    session.commit()

print("Listo: ventas, items y pagos borrados. Los tickets arrancan desde #1.")