#!/usr/bin/env python3

import asyncio
import struct
import os
import random
import mimetypes
from aiohttp import web, WSMsgType
from Crypto.Cipher import AES
from Crypto.Util.Padding import pad

PORT       = int(os.environ.get('PORT', 8080))
TICK_SEC   = 3
FLAG       = os.environ.get('FLAG', 'HZU18{havarch_salhi_ihtei_getsun_bainado_haha_e4c2d24a}')
STATIC_DIR = os.environ.get('STATIC_DIR', '/app/static')

NAR   = 1
BOROO = 2
SALHI = 3
TSAS  = 4

NAMES = {NAR: "НАР  ☀", BOROO: "БОРОО 🌧", SALHI: "САЛХИ 💨", TSAS: "ЦАС  ❄"}

MAGIC         = 0xAA55
MSG_HELLO     = 0x01
MSG_WEATHER   = 0x02
MSG_FLAG      = 0x03
MSG_BROADCAST = 0x04


def pack_msg(msg_type, payload=b''):
    return struct.pack('>HBH', MAGIC, msg_type, len(payload)) + payload


def parse_msgs(data):
    msgs = []
    i = 0
    while i + 5 <= len(data):
        if struct.unpack('>H', data[i:i+2])[0] != MAGIC:
            i += 1
            continue
        mtype = data[i+2]
        length = struct.unpack('>H', data[i+3:i+5])[0]
        if i + 5 + length > len(data):
            break
        msgs.append((mtype, data[i+5:i+5+length]))
        i += 5 + length
    return msgs, data[i:]


class LFSR:
    POLY = 0xB400

    def __init__(self, seed=None):
        self.state = (seed if seed else int.from_bytes(os.urandom(2), 'big')) & 0xFFFF or 1
        self.initial = self.state

    def clock(self):
        bit = self.state & 1
        self.state >>= 1
        if bit:
            self.state ^= self.POLY
        return bit

    def weather(self):
        return ((self.clock() | (self.clock() << 1)) & 3) + 1


class Challenge:
    def __init__(self):
        self.lfsr    = LFSR()
        self.key     = os.urandom(16)
        self.weather = NAR
        self.tick    = 0
        self.salhi_n = 0
        self.sched   = self._make_schedule()

    def _make_schedule(self):
        rng = random.Random(self.lfsr.initial)
        out = []
        for _ in range(2):
            pos = list(range(16))
            rng.shuffle(pos)
            for i in range(0, 16, 3):
                out.append(pos[i:i+3])
        return out

    def do_tick(self):
        self.weather = self.lfsr.weather()
        self.tick += 1
        if self.weather == SALHI:
            self.salhi_n += 1

    def weather_payload(self):
        s    = self.weather
        temp = {NAR: 15, BOROO: 5, SALHI: -3, TSAS: -15}[s]
        wind = {NAR: 5,  BOROO: 20, SALHI: 60, TSAS: 10}[s]
        extra = b''
        if s == BOROO:
            extra = os.urandom(4)
        elif s == SALHI:
            idx  = (self.salhi_n - 1) % len(self.sched)
            positions = self.sched[idx]
            extra = bytes([len(positions)])
            for p in positions:
                extra += bytes([p, self.key[p]])
        elif s == TSAS:
            mask = 0x0F0F
            extra = struct.pack('>HH', self.lfsr.state & mask, mask)
        return struct.pack('>BhH', s, temp, wind) + extra

    def encrypted_flag(self):
        iv = os.urandom(16)
        ct = AES.new(self.key, AES.MODE_CBC, iv).encrypt(pad(FLAG.encode(), 16))
        return iv + ct


ws_clients = set()


async def ws_handler(request):
    state = request.app['state']
    ws = web.WebSocketResponse(max_msg_size=4096, heartbeat=20)
    await ws.prepare(request)
    ws_clients.add(ws)
    try:
        async for msg in ws:
            if msg.type == WSMsgType.BINARY:
                data = msg.data
            elif msg.type == WSMsgType.TEXT:
                data = msg.data.encode()
            else:
                continue
            msgs, _ = parse_msgs(data)
            for mtype, _payload in msgs:
                if mtype == MSG_HELLO:
                    await ws.send_bytes(pack_msg(MSG_HELLO, b'ARANSHIN-V1.0 AES-128-CBC'))
                elif mtype == MSG_WEATHER:
                    await ws.send_bytes(pack_msg(MSG_WEATHER, state.weather_payload()))
                elif mtype == MSG_FLAG:
                    await ws.send_bytes(pack_msg(MSG_FLAG, state.encrypted_flag()))
    finally:
        ws_clients.discard(ws)
    return ws


async def ticker(app):
    state = app['state']
    while True:
        await asyncio.sleep(TICK_SEC)
        state.do_tick()
        msg = pack_msg(MSG_BROADCAST, state.weather_payload())
        for ws in list(ws_clients):
            try:
                await ws.send_bytes(msg)
            except (ConnectionResetError, RuntimeError):
                ws_clients.discard(ws)


async def index(_request):
    return web.FileResponse(os.path.join(STATIC_DIR, 'index.html'))


async def on_startup(app):
    app['ticker_task'] = asyncio.create_task(ticker(app))


async def on_cleanup(app):
    app['ticker_task'].cancel()
    try:
        await app['ticker_task']
    except asyncio.CancelledError:
        pass


def make_app():
    mimetypes.add_type('audio/mp4', '.m4a')
    mimetypes.add_type('application/javascript', '.js')

    app = web.Application()
    app['state'] = Challenge()
    app.router.add_get('/ws', ws_handler)
    app.router.add_get('/', index)
    app.router.add_static('/', STATIC_DIR, show_index=False)
    app.on_startup.append(on_startup)
    app.on_cleanup.append(on_cleanup)
    return app


if __name__ == '__main__':
    print("=" * 50)
    print(f"  PORT : :{PORT}")
    print(f"  FLAG : {FLAG}")
    print("=" * 50, flush=True)
    web.run_app(make_app(), host='0.0.0.0', port=PORT, access_log=None, print=None)
