#!/usr/bin/env python3
import asyncio
import json
import mimetypes
import os
import random
import re
import threading
from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer

import websockets

FLAG = os.environ.get('FLAG', 'HZU18{mori_uraldahch_saihanda_7f2d1e83}')
HTTP_PORT = int(os.environ.get('HTTP_PORT', 8080))
WS_PORT = int(os.environ.get('WS_PORT', 4448))
STATIC_DIR = os.environ.get('STATIC_DIR', '/app/static')

FACES = ['Морь', 'Тэмээ', 'Хонь', 'Ямаа']
FACE_WEIGHTS = [0.28, 0.22, 0.25, 0.25]

TRACK_LEN = 24
NPC_HORSES = ['Алтай', 'Хангай', 'Онон', 'Говь']
PLAYER_ID = 'Чи'

HELP_TEXT = (
    'Тушаалууд:\n'
    '  ROLL              Шагай г шидэх\n'
    '  NAME <нэр>        Морины нэрийг бичнэ үү!\n'
    '  CHEER <бичиг>     Засуулын унших ерөөл\n'
    '  TRACK             Уралдааны явц\n'
    '  HELP              Тусламж\n'
)

FMT_RE = re.compile(r'%(?:(\d+)\$)?(?:hh|h|ll|l)?([pxXcdui])')

BLOCKED_RE = re.compile(r'%[^%]*?[sn]')


def vuln_printf(fmt, stack, max_len=600):
    if BLOCKED_RE.search(fmt):
        return 'Засуул ерөөлөө мартчихлаа...', []

    auto = [0]
    accessed = []

    def rep(m):
        pos, conv = m.group(1), m.group(2)
        if pos is not None:
            idx = int(pos) - 1
        else:
            idx = auto[0]
            auto[0] += 1
        if idx < 0 or idx >= len(stack):
            return '(nil)'
        accessed.append(idx + 1)
        val = stack[idx]
        n = val if isinstance(val, int) else (abs(hash(val)) & 0xffffffffffff)
        if conv in ('d', 'u', 'i'):
            return str(n & 0xffffffff)
        if conv == 'x':
            return f'{n:x}'
        if conv == 'X':
            return f'{n:X}'
        if conv == 'p':
            return f'0x{n:012x}'
        if conv == 'c':
            ch = n & 0xff
            return chr(ch) if 32 <= ch < 127 else '.'
        return m.group(0)

    result = FMT_RE.sub(rep, fmt)
    if len(result) > max_len:
        result = result[:max_len] + '…'
    return result, accessed


class Race:
    def __init__(self):
        self.horse_name = 'Хурдан-Хар'
        self.positions = {PLAYER_ID: 0}
        for h in NPC_HORSES:
            self.positions[h] = 0
        self.round = 0
        self.last_roll = []
        self.winner = None
        self.log = []

    def _stack(self):
        canary = random.randrange(1, 1 << 64)
        key = canary & 0xff
        flag_bytes = [b ^ key for b in FLAG.encode()]
        saved_rbp = 0x7fffc8a60080 + self.round
        saved_rip = 0x0000000000400d72
        return [
            canary,
            saved_rbp,
            saved_rip,
            0x7fffc8a60040 + (self.round * 0x10),
            len(flag_bytes),
        ] + flag_bytes + [
            0xbaadf00d,
            0x13371337,
            0xfeedface,
        ]

    def roll(self):
        if self.winner is not None:
            return {'ok': False, 'msg': f'Уралдаан дууссан. Түрүүлсэн: {self.winner}'}
        dice = [random.choices(FACES, weights=FACE_WEIGHTS, k=1)[0] for _ in range(4)]
        steps = dice.count('Морь')
        self.positions[PLAYER_ID] += steps
        for h in NPC_HORSES:
            self.positions[h] += random.choices([0, 1, 2, 3], weights=[0.35, 0.40, 0.20, 0.05])[0]
        self.round += 1
        self.last_roll = dice
        for name, pos in self.positions.items():
            if pos >= TRACK_LEN and self.winner is None:
                self.winner = name
        return {
            'ok': True,
            'dice': dice,
            'steps': steps,
            'positions': dict(self.positions),
            'round': self.round,
            'winner': self.winner,
            'msg': f'Шагай: {" ".join(dice)} → морь {steps}',
        }

    def cheer(self, text):
        return vuln_printf(text, self._stack())

    def stack_view(self):
        flag_len = len(FLAG.encode())
        saved_rbp = 0x7fffc8a60080 + self.round
        saved_rip = 0x0000000000400d72
        local_ptr = 0x7fffc8a60040 + (self.round * 0x10)
        out = [
            {'slot': 1, 'kind': 'int', 'display': '0x????????????????', 'hint': 'canary (low byte = XOR key, random /req)'},
            {'slot': 2, 'kind': 'int', 'display': f'0x{saved_rbp:012x}', 'hint': 'saved rbp'},
            {'slot': 3, 'kind': 'int', 'display': f'0x{saved_rip:012x}', 'hint': 'saved rip'},
            {'slot': 4, 'kind': 'int', 'display': f'0x{local_ptr:012x}', 'hint': 'local var ptr'},
            {'slot': 5, 'kind': 'int', 'display': '0x????????',          'hint': 'flag length (bytes)'},
        ]
        for i in range(flag_len):
            out.append({
                'slot': 6 + i,
                'kind': 'int',
                'display': '0x??',
                'hint': f'enc flag[{i}] = plain ^ key',
            })
        end = 5 + flag_len
        out += [
            {'slot': end + 1, 'kind': 'int', 'display': '0xbaadf00d', 'hint': 'magic'},
            {'slot': end + 2, 'kind': 'int', 'display': '0x13371337', 'hint': 'magic'},
            {'slot': end + 3, 'kind': 'int', 'display': '0xfeedface', 'hint': 'magic'},
        ]
        return out

    def set_name(self, name):
        name = (name or '').strip()[:24] or 'Хурдан-Хар'
        self.horse_name = name

    def snapshot(self):
        return {
            'horse_name': self.horse_name,
            'positions': dict(self.positions),
            'round': self.round,
            'last_roll': self.last_roll,
            'winner': self.winner,
            'track_len': TRACK_LEN,
            'log': self.log[-10:],
        }

    def logln(self, m):
        self.log.append(m)
        if len(self.log) > 30:
            self.log.pop(0)


FLAG_RE = re.compile(r'HZU18\{[^}]+\}')


async def ws_handler(websocket):
    race = Race()
    race.logln('Connected.')

    async def send(obj):
        await websocket.send(json.dumps(obj, ensure_ascii=False))

    try:
        await send({
            'type': 'init',
            'track_len': TRACK_LEN,
            'horses': [PLAYER_ID] + NPC_HORSES,
            'player_id': PLAYER_ID,
            'help': HELP_TEXT,
            'stack': race.stack_view(),
        })
        await send({'type': 'state', **race.snapshot()})

        async for raw in websocket:
            try:
                req = json.loads(raw)
            except Exception:
                continue
            op = (req.get('op') or '').upper()

            if op == 'ROLL':
                r = race.roll()
                race.logln(r['msg'])
                await send({'type': 'roll', **r})

            elif op == 'NAME':
                race.set_name(str(req.get('value', '')))
                race.logln(f'Морины нэр: {race.horse_name}')
                await send({'type': 'result', 'ok': True, 'msg': f'нэр = {race.horse_name}'})

            elif op == 'CHEER':
                text = str(req.get('value', ''))
                out, accessed = race.cheer(text)
                race.logln(f'CHEER -> {out}')
                payload = {
                    'type': 'cheer',
                    'out': out,
                    'accessed': accessed,
                    'stack': race.stack_view(),
                }
                m = FLAG_RE.search(out)
                if m:
                    payload['flag'] = m.group(0)
                await send(payload)

            elif op == 'TRACK':
                await send({'type': 'track', **race.snapshot()})

            elif op == 'HELP':
                await send({'type': 'help', 'text': HELP_TEXT})

            elif op == 'HELLO':
                await send({'type': 'hello', 'name': 'hi2 xD'})

            else:
                await send({'type': 'error', 'msg': f'unknown op {op}'})

            await send({'type': 'state', **race.snapshot()})
    except Exception:
        pass


class StaticHandler(SimpleHTTPRequestHandler):
    def log_message(self, *a, **kw):
        pass


def http_serve():
    mimetypes.add_type('application/javascript', '.js')
    handler = partial(StaticHandler, directory=STATIC_DIR)
    ThreadingHTTPServer(('0.0.0.0', HTTP_PORT), handler).serve_forever()


async def main():
    threading.Thread(target=http_serve, daemon=True).start()
    ws_server = await websockets.serve(ws_handler, '0.0.0.0', WS_PORT)
    async with ws_server:
        await asyncio.Event().wait()


if __name__ == '__main__':
    asyncio.run(main())
