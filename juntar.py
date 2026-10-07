from pathlib import Path

# ============================================================
# Elegí el modo:
#   "todo"     -> backend + frontend (sin los CSS pesados)
#   "backend"  -> solo Python (rutas, modelos, base de datos)
#   "frontend" -> solo HTML, JS y CSS
# ============================================================
MODO = "todo"

IGNORAR = {"__pycache__", ".venv", "venv", "node_modules", ".git"}
SALTAR = {"transiciones.css", "stats.css", "productos.css", "juntar.py"}

EXTENSIONES = {
    "todo": {".py", ".js", ".css", ".html"},
    "backend": {".py"},
    "frontend": {".js", ".css", ".html"},
}

ext = EXTENSIONES[MODO]
salida = f"proyecto_{MODO}.txt"

out = []
for p in sorted(Path(".").rglob("*")):
    if (
        p.is_file()
        and p.suffix in ext
        and not (set(p.parts) & IGNORAR)
        and p.name not in SALTAR
    ):
        out.append(f"\n===== {p.as_posix()} =====\n{p.read_text(encoding='utf-8')}")

Path(salida).write_text("".join(out), encoding="utf-8")
print(f"Listo: se creó {salida} ({len(out)} archivos)")