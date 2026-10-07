"""Genera cert.pem y key.pem para servir el TPV por HTTPS en la red local.

Uso:   python gen_cert.py             (detecta sola la IP de la PC)
       python gen_cert.py 192.168.1.50  (o le indicás la IP a mano)
       python gen_cert.py --forzar      (regenera aunque ya existan)
Requiere: pip install cryptography   (con el venv activado)
"""
import datetime
import ipaddress
import os
import socket
import sys

from cryptography import x509
from cryptography.hazmat.primitives import hashes, serialization
from cryptography.hazmat.primitives.asymmetric import rsa
from cryptography.x509.oid import NameOID


def ip_local() -> str:
    """IP de la PC en la red local (no necesita internet, no envía nada)."""
    s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
    try:
        s.connect(("10.255.255.255", 1))
        return s.getsockname()[0]
    finally:
        s.close()


args = [a for a in sys.argv[1:] if not a.startswith("--")]
forzar = "--forzar" in sys.argv

if os.path.exists("cert.pem") and os.path.exists("key.pem") and not forzar:
    print("cert.pem y key.pem ya existen. Usá --forzar si cambió la IP de la PC.")
    sys.exit(0)

ip = args[0] if args else ip_local()
ipaddress.ip_address(ip)  # valida el formato

key = rsa.generate_private_key(public_exponent=65537, key_size=2048)
nombre = x509.Name([x509.NameAttribute(NameOID.COMMON_NAME, "TPV local")])
ahora = datetime.datetime.now(datetime.timezone.utc)

cert = (
    x509.CertificateBuilder()
    .subject_name(nombre)
    .issuer_name(nombre)
    .public_key(key.public_key())
    .serial_number(x509.random_serial_number())
    .not_valid_before(ahora - datetime.timedelta(days=1))
    .not_valid_after(ahora + datetime.timedelta(days=3650))
    .add_extension(
        x509.SubjectAlternativeName(
            [
                x509.IPAddress(ipaddress.ip_address(ip)),
                x509.IPAddress(ipaddress.ip_address("127.0.0.1")),
                x509.DNSName("localhost"),
            ]
        ),
        critical=False,
    )
    .sign(key, hashes.SHA256())
)

with open("key.pem", "wb") as f:
    f.write(key.private_bytes(
        serialization.Encoding.PEM,
        serialization.PrivateFormat.TraditionalOpenSSL,
        serialization.NoEncryption(),
    ))
with open("cert.pem", "wb") as f:
    f.write(cert.public_bytes(serialization.Encoding.PEM))

print(f"Listo: certificado generado para {ip} (valido 10 anios)")
print(f"En la tablet o el celu abri:  https://{ip}:8443/precio")