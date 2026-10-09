"""Home-Assistant-Benutzer hinter dem Ingress: Admin oder nicht? (nur im Add-on, SUPERVISOR_TOKEN + homeassistant_api)

Das Panel ist für alle Benutzer freigegeben (panel_admin: false); Benutzer ohne Admin-Rechte sehen nur den
3D-Fortschritt (Entscheidung 2026-10-09). Der Supervisor reicht die Benutzer-ID als X-Remote-User-Id durch, die
Gruppen kommen über die Websocket-API von Home Assistant (config/auth/list – der Supervisor-Benutzer ist Admin).
Ohne Antwort gilt ein Benutzer als „nur ansehen“ (nächster Versuch nach ERROR_RETRY_S).
"""
import base64
import socket
import json
import os
import secrets
import struct
import threading
import time

CACHE_S = 300
ERROR_RETRY_S = 30
TIMEOUT_S = 8
SUPERVISOR = ("supervisor", 80)
WS_PATH = "/core/websocket"
_lock = threading.Lock()
_cache = {"at": 0, "ok": False, "admins": set(), "users": set()}


def available():
    return bool(os.environ.get("SUPERVISOR_TOKEN"))


def _recv_exact(sock, n):
    buf = b""
    while len(buf) < n:
        chunk = sock.recv(n - len(buf))
        if not chunk:
            raise OSError("Verbindung geschlossen")
        buf += chunk
    return buf


def _send(sock, obj):
    data = json.dumps(obj).encode()
    mask = secrets.token_bytes(4)
    n = len(data)
    head = b"\x81" + (struct.pack("!B", 0x80 | n) if n < 126 else struct.pack("!BH", 0x80 | 126, n) if n < 65536 else struct.pack("!BQ", 0x80 | 127, n))
    sock.sendall(head + mask + bytes(b ^ mask[i % 4] for i, b in enumerate(data)))


def _recv(sock):
    msg = b""
    while True:
        b0, b1 = _recv_exact(sock, 2)
        n = b1 & 0x7F
        if n == 126:
            n = struct.unpack("!H", _recv_exact(sock, 2))[0]
        elif n == 127:
            n = struct.unpack("!Q", _recv_exact(sock, 8))[0]
        mask = _recv_exact(sock, 4) if b1 & 0x80 else None
        data = _recv_exact(sock, n)
        if mask:
            data = bytes(b ^ mask[i % 4] for i, b in enumerate(data))
        if b0 & 0x0F == 0x8:
            raise OSError("Verbindung von Home Assistant beendet")
        if b0 & 0x0F in (0x9, 0xA):   # ping/pong
            continue
        msg += data
        if b0 & 0x80:
            return json.loads(msg)


def _fetch_users():
    """{Benutzer-ID: Admin?} über ws://supervisor/core/websocket."""
    # Handshake von Hand: http.client puffert sonst die erste Nachricht (auth_required) hinter der 101-Antwort weg
    sock = socket.create_connection(SUPERVISOR, timeout=TIMEOUT_S)
    try:
        sock.sendall(("GET %s HTTP/1.1\r\nHost: %s\r\nUpgrade: websocket\r\nConnection: Upgrade\r\n"
                      "Sec-WebSocket-Version: 13\r\nSec-WebSocket-Key: %s\r\nAuthorization: Bearer %s\r\n\r\n"
                      % (WS_PATH, SUPERVISOR[0], base64.b64encode(secrets.token_bytes(16)).decode(), os.environ["SUPERVISOR_TOKEN"])).encode())
        head = b""
        while not head.endswith(b"\r\n\r\n"):
            head += _recv_exact(sock, 1)
            if len(head) > 16384:
                raise OSError("Antwort von Home Assistant zu lang")
        status = head.split(b" ", 2)[1:2]
        if status != [b"101"]:
            raise OSError("Home Assistant antwortet mit HTTP %s (homeassistant_api im Add-on an?)" % (status[0].decode() if status else "?"))
        if _recv(sock).get("type") == "auth_required":
            _send(sock, {"type": "auth", "access_token": os.environ["SUPERVISOR_TOKEN"]})
            if _recv(sock).get("type") != "auth_ok":
                raise OSError("Anmeldung bei Home Assistant abgelehnt")
        _send(sock, {"id": 1, "type": "config/auth/list"})
        while True:
            m = _recv(sock)
            if m.get("id") == 1:
                break
        if not m.get("success"):
            raise OSError("Benutzerliste nicht lesbar: " + str((m.get("error") or {}).get("message")))
        return {u["id"]: ("system-admin" in (u.get("group_ids") or []) or bool(u.get("is_owner"))) for u in m.get("result") or [] if u.get("id")}
    finally:
        sock.close()


def is_admin(user_id):
    """True/False für die Benutzer-ID aus X-Remote-User-Id; ohne ID oder ohne Antwort von Home Assistant False."""
    if not user_id:
        return False
    with _lock:
        c = dict(_cache)
    now = time.time()
    stale = now - c["at"] > (CACHE_S if c["ok"] else ERROR_RETRY_S)
    if stale or (c["ok"] and user_id not in c["users"] and now - c["at"] > ERROR_RETRY_S):   # neuer Benutzer
        try:
            users = _fetch_users()
            c = {"at": now, "ok": True, "admins": {u for u, a in users.items() if a}, "users": set(users)}
        except (OSError, ValueError, KeyError, IndexError) as e:
            print("Benutzerrechte aus Home Assistant nicht lesbar: %s – Panel nur zum Ansehen" % e, flush=True)
            c = {"at": now, "ok": False, "admins": set(), "users": set()}
        with _lock:
            _cache.update(c)
    return user_id in c["admins"]
