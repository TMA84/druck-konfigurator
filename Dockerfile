# Druck-Konfigurator als Container (z. B. auf dem NAS im Heimnetz).
# Die Seite läuft im Browser; der Server liefert sie aus, spricht mit Anycubic-Druckern im LAN-Modus und
# slict für die Kostenkalkulation mit der OrcaSlicer-Kommandozeile (ohne Bildschirm).
# Ubuntu 24.04, weil Orca dafür gebaut ist; Orca-Version passend zu den Vorlagen in templates/.
FROM ubuntu:24.04

ARG TARGETARCH
ARG ORCA_VERSION=2.4.2

# Laufzeit-Bibliotheken, die Orca auch für --slice lädt (GTK/WebKit/OpenGL), und Python
RUN apt-get update && DEBIAN_FRONTEND=noninteractive apt-get install -y --no-install-recommends \
      ca-certificates curl python3 python3-venv \
      libgtk-3-0t64 libwebkit2gtk-4.1-0 libglu1-mesa libegl1 libgl1 libopengl0 libglx0 \
      libgstreamer1.0-0 libgstreamer-plugins-base1.0-0 libsecret-1-0 libmspack0t64 libsoup-3.0-0 \
      libwayland-client0 libwayland-egl1 libwayland-server0 libxkbcommon0 libdbus-1-3 libsm6 libice6 fonts-dejavu-core \
    && rm -rf /var/lib/apt/lists/*

# OrcaSlicer als entpacktes AppImage (braucht kein FUSE); x86_64 oder aarch64 je nach Zielplattform
RUN set -e; \
    case "$TARGETARCH" in arm64) f="OrcaSlicer_Linux_AppImage_Ubuntu2404_aarch64_V${ORCA_VERSION}.AppImage" ;; \
                          *)     f="OrcaSlicer_Linux_AppImage_Ubuntu2404_V${ORCA_VERSION}.AppImage" ;; esac; \
    curl -fsSL -o /tmp/orca.AppImage "https://github.com/OrcaSlicer/OrcaSlicer/releases/download/v${ORCA_VERSION}/$f"; \
    chmod +x /tmp/orca.AppImage; cd /opt; /tmp/orca.AppImage --appimage-extract >/dev/null; \
    mv squashfs-root orca; rm /tmp/orca.AppImage; chmod -R a+rX /opt/orca

WORKDIR /app
COPY requirements.txt .
RUN python3 -m venv /opt/venv && /opt/venv/bin/pip install --no-cache-dir -r requirements.txt

COPY . .

# Im Container auf allen Schnittstellen lauschen – erreichbar über die Portfreigabe (docker-compose.yml).
# HOME beschreibbar für Orcas Einstellungsordner (läuft als nobody).
ENV KONFIGURATOR_HOST=0.0.0.0 \
    KONFIGURATOR_PORT=8765 \
    ORCA_PATH=/opt/orca/AppRun \
    HOME=/tmp \
    DATA_DIR=/data \
    PYTHONUNBUFFERED=1 \
    PATH=/opt/venv/bin:$PATH
EXPOSE 8765
# Filamentverwaltung (tools/spools.py): Spulen und Verbrauch bleiben über Updates erhalten – Volume /data
RUN mkdir -p /data && chown nobody /data
VOLUME /data
USER nobody

HEALTHCHECK --interval=60s --timeout=5s \
  CMD python -c "import urllib.request; urllib.request.urlopen('http://127.0.0.1:8765/api/health', timeout=3)"
CMD ["python", "tools/serve.py"]
