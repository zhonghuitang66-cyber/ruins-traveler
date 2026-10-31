#!/usr/bin/env python3
"""Python 3.6+ standard-library implementation of multiplayer protocol 1.

Single asyncio loop; SQLite is parameterized and used only on that loop.
No game simulation, external dependencies, production deployment or credentials.
"""
import asyncio
import base64
import collections
import copy
import hashlib
import ipaddress
import json
import math
import os
import random
import re
import secrets
import signal
import sqlite3
import struct
import time
import unicodedata
import uuid
from urllib.parse import urlsplit

MAX_MESSAGE = 65536
MAX_SAFE = 9007199254740991
ROLES = ('swordsman', 'paladin', 'archer')
TOKEN_RE = re.compile(r'^[A-Za-z0-9_-]{43}$')
DEVICE_RE = re.compile(r'^[A-Za-z0-9_-]{16,128}$')
COMMAND_RE = re.compile(r'^[-A-Za-z0-9_.:]{1,128}$')


def literal_ip(value):
    if not isinstance(value, str) or len(value) > 45 or not re.fullmatch(r'[0-9A-Fa-f:.]+', value):
        return None
    # Older ipaddress releases accepted leading-zero IPv4 octets. Keep both
    # backends strict, including dotted tails in IPv4-mapped IPv6 literals.
    if '.' in value:
        tail = value.rsplit(':', 1)[-1]
        parts = tail.split('.')
        if len(parts) != 4 or any(not re.fullmatch(r'0|[1-9][0-9]{0,2}', p) or int(p) > 255 for p in parts):
            return None
    try:
        address = ipaddress.ip_address(value)
    except ValueError:
        return None
    if isinstance(address, ipaddress.IPv6Address) and address.ipv4_mapped is not None:
        address = address.ipv4_mapped
    return str(address)


def client_ip(transport, real_ip=None):
    actual = literal_ip(transport)
    loopback = actual == '::1' or (actual is not None and actual.startswith('127.'))
    if loopback:
        return literal_ip(real_ip) or actual
    return actual or transport or 'unknown'


def now_ms():
    return int(time.time() * 1000)


class ApiError(Exception):
    def __init__(self, status, code):
        Exception.__init__(self, code)
        self.status, self.code = status, code


def digest(value):
    return hashlib.sha256(value.encode('utf-8')).hexdigest()


def encode(value):
    # UTF-8 matches browser byte budgets; backslashreplace safely escapes lone
    # UTF-16 code units instead of emitting malformed UTF-8.
    text = json.dumps(value, ensure_ascii=False, allow_nan=False, separators=(',', ':'))
    return text.replace('<', '\\u003c').replace('>', '\\u003e').replace('&', '\\u0026') \
        .replace('\u2028', '\\u2028').replace('\u2029', '\\u2029').encode('utf-8', 'backslashreplace')


def bad_constant(value):
    raise ValueError('non-JSON numeric constant')


def parse_integer(value):
    if len(value) > 310:
        raise ValueError('JSON integer too long')
    return int(value)


def decode(value):
    return json.loads(value, object_pairs_hook=collections.OrderedDict,
                      parse_constant=bad_constant, parse_int=parse_integer)


def valid_username(value):
    if not isinstance(value, str):
        raise ApiError(400, 'INVALID_USERNAME')
    name = unicodedata.normalize('NFKC', value)
    if not 2 <= len(name) <= 16 or not all(c.isalnum() or c in '_-' for c in name):
        raise ApiError(400, 'INVALID_USERNAME')
    return name


def valid_wealth(value):
    if isinstance(value, str):
        if not re.fullmatch(r'(0|[1-9][0-9]{0,15})', value):
            raise ApiError(400, 'INVALID_WEALTH')
        value = int(value)
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        raise ApiError(400, 'INVALID_WEALTH')
    if isinstance(value, float) and (not math.isfinite(value) or not value.is_integer()):
        raise ApiError(400, 'INVALID_WEALTH')
    if value < 0 or value > MAX_SAFE:
        raise ApiError(400, 'INVALID_WEALTH')
    return int(value)


def valid_sequence(value):
    return not isinstance(value, bool) and isinstance(value, (int, float)) and \
        0 <= value <= MAX_SAFE and int(value) == value


def valid_payload(value):
    count = [0]

    def check(item, depth):
        count[0] += 1
        if count[0] > 12000 or depth > 20:
            return False
        if item is None or isinstance(item, (bool, str)):
            return True
        if isinstance(item, (int, float)):
            try:
                return math.isfinite(item)
            except OverflowError:
                return False
        if isinstance(item, list):
            return all(check(v, depth + 1) for v in item)
        if isinstance(item, dict):
            return all(k not in ('__proto__', 'constructor', 'prototype') and check(v, depth + 1)
                       for k, v in item.items())
        return False
    return check(value, 0)


class Store(object):
    def __init__(self, path=':memory:', clock=now_ms):
        self.clock, self.cached = clock, None
        if path != ':memory:':
            os.makedirs(os.path.dirname(os.path.abspath(path)), exist_ok=True)
        self.db = sqlite3.connect(path, timeout=3.0, isolation_level=None)
        self.db.row_factory = sqlite3.Row
        self.db.execute('PRAGMA journal_mode=WAL')
        self.db.execute('PRAGMA busy_timeout=3000')
        # CentOS 7 ships SQLite predating STRICT tables. The same columns,
        # uniqueness, checks and application validation work without STRICT.
        self.db.executescript('''CREATE TABLE IF NOT EXISTS users(
          id TEXT PRIMARY KEY, device_hash TEXT NOT NULL UNIQUE,
          username TEXT NOT NULL, username_key TEXT NOT NULL UNIQUE,
          token_hash TEXT NOT NULL UNIQUE,
          wealth INTEGER NOT NULL DEFAULT 0 CHECK(wealth>=0 AND wealth<=9007199254740991),
          created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL);
          CREATE INDEX IF NOT EXISTS users_wealth ON users(wealth DESC,created_at ASC,id ASC);''')

    @staticmethod
    def profile(row):
        return dict(id=row['id'], username=row['username'], wealth=row['wealth'],
                    createdAt=row['created_at'], updatedAt=row['updated_at'])

    def authenticate(self, token):
        if not isinstance(token, str) or not TOKEN_RE.fullmatch(token):
            raise ApiError(401, 'UNAUTHORIZED')
        row = self.db.execute('SELECT id,username,wealth,created_at,updated_at FROM users WHERE token_hash=?',
                              (digest(token),)).fetchone()
        if row is None:
            raise ApiError(401, 'UNAUTHORIZED')
        return self.profile(row)

    def register(self, data):
        name = valid_username(data.get('username'))
        device = data.get('deviceId')
        if not isinstance(device, str) or not DEVICE_RE.fullmatch(device):
            raise ApiError(400, 'INVALID_DEVICE_ID')
        device_hash, token, user_id, at = digest(device), secrets.token_urlsafe(32), str(uuid.uuid4()), self.clock()
        self.db.execute('BEGIN IMMEDIATE')
        try:
            if self.db.execute('SELECT id FROM users WHERE device_hash=?', (device_hash,)).fetchone():
                raise ApiError(409, 'DEVICE_ALREADY_REGISTERED')
            if self.db.execute('SELECT id FROM users WHERE username_key=?', (name.lower(),)).fetchone():
                raise ApiError(409, 'USERNAME_TAKEN')
            self.db.execute('INSERT INTO users(id,device_hash,username,username_key,token_hash,wealth,created_at,updated_at) VALUES(?,?,?,?,?,0,?,?)',
                            (user_id, device_hash, name, name.lower(), digest(token), at, at))
            self.db.execute('COMMIT')
        except Exception:
            self.db.execute('ROLLBACK')
            raise
        return dict(token=token, profile=self.authenticate(token))

    def set_wealth(self, token, value):
        user = self.authenticate(token)
        self.db.execute('UPDATE users SET wealth=?,updated_at=? WHERE id=?',
                        (valid_wealth(value), self.clock(), user['id']))
        return self.authenticate(token)

    def leaderboard(self):
        at = self.clock()
        if self.cached is None or at >= self.cached['cachedUntil']:
            rows = self.db.execute('SELECT id,username,wealth FROM users ORDER BY wealth DESC,created_at ASC,id ASC LIMIT 100').fetchall()
            self.cached = dict(rows=[dict(id=r['id'], username=r['username'], wealth=r['wealth'], rank=i + 1)
                                     for i, r in enumerate(rows)], updatedAt=at, cachedUntil=at + 600000)
        return copy.deepcopy(self.cached)

    def close(self):
        self.db.close()


class Bucket(object):
    def __init__(self, rate, burst, at):
        self.rate, self.burst, self.tokens, self.at = rate, burst, burst, at

    def take(self, at):
        self.tokens = min(self.burst, self.tokens + max(0, at - self.at) * self.rate / 1000.0)
        self.at = at
        if self.tokens < 1:
            return False
        self.tokens -= 1
        return True


def frame(payload, opcode=1):
    size = len(payload)
    if size < 126:
        head = struct.pack('!BB', 128 | opcode, size)
    elif size < 65536:
        head = struct.pack('!BBH', 128 | opcode, 126, size)
    else:
        head = struct.pack('!BBQ', 128 | opcode, 127, size)
    return head + payload


class Peer(object):
    def __init__(self, app, reader, writer):
        self.app, self.reader, self.writer = app, reader, writer
        self.closed, self.alive = False, True
        self.control, self.control_bytes, self.latest = collections.deque(), 0, None
        self.pump_task = None
        self.fragments, self.fragment_bytes, self.fragmenting = [], 0, False
        self.frame_at, self.frame_count = now_ms(), 0

    def buffered(self):
        return self.writer.transport.get_write_buffer_size()

    def raw(self, packet, state=False):
        if self.closed:
            return False
        # Fast, nonblocking write mirrors Node socket.write. In particular an
        # authentication error is written before its subsequent close frame.
        if not self.control and self.latest is None and \
                (self.pump_task is None or self.pump_task.done()) and self.buffered() < 65536:
            try:
                self.writer.write(packet)
                return True
            except (OSError, RuntimeError):
                self.close(1013, 'write failed')
                return False
        if state:
            self.latest = packet
        else:
            if len(self.control) >= 64 or self.control_bytes + len(packet) + self.buffered() > 262144:
                self.close(1013, 'control backpressure')
                return False
            self.control.append(packet)
            self.control_bytes += len(packet)
        if self.pump_task is None or self.pump_task.done():
            self.pump_task = asyncio.ensure_future(self.pump())
        return True

    def send(self, data, state=False):
        if self.closed:
            return False
        body = encode(data)
        if len(body) > MAX_MESSAGE:
            self.close(1009, 'message too large')
            return False
        return self.raw(frame(body), state=state)

    async def pump(self):
        try:
            while not self.closed:
                if self.control:
                    packet = self.control.popleft()
                    self.control_bytes -= len(packet)
                elif self.latest is not None:
                    packet, self.latest = self.latest, None
                else:
                    return
                if self.buffered() > 262144:
                    self.close(1013, 'write backpressure')
                    return
                self.writer.write(packet)
                await asyncio.wait_for(self.writer.drain(), timeout=10.0)
        except (OSError, asyncio.TimeoutError, ConnectionError):
            self.close(1013, 'write failed')
        except asyncio.CancelledError:
            pass

    def ping(self):
        if self.closed:
            return
        if not self.alive:
            self.close(1001, 'heartbeat timeout')
            return
        self.alive = False
        self.raw(frame(b'', 9))

    def close(self, code=1000, reason='closed'):
        if self.closed:
            return
        self.closed = True
        self.control.clear()
        self.control_bytes, self.latest = 0, None
        self.fragments, self.fragment_bytes = [], 0
        try:
            self.writer.write(frame(struct.pack('!H', code) + reason.encode('utf-8')[:120], 8))
        except (OSError, RuntimeError):
            pass
        self.writer.close()
        self.app.loop.call_later(0.25, self.writer.transport.abort)
        self.app.hub.remove(self)

    async def run(self):
        try:
            while not self.closed:
                head = await self.reader.readexactly(2)
                fin, opcode, masked = bool(head[0] & 128), head[0] & 15, bool(head[1] & 128)
                if head[0] & 112 or not masked or opcode not in (0, 1, 8, 9, 10):
                    self.close(1002, 'invalid frame')
                    return
                size = head[1] & 127
                if size == 126:
                    size = struct.unpack('!H', await self.reader.readexactly(2))[0]
                    if size < 126:
                        self.close(1002, 'noncanonical length')
                        return
                elif size == 127:
                    size = struct.unpack('!Q', await self.reader.readexactly(8))[0]
                    if size < 65536:
                        self.close(1002, 'noncanonical length')
                        return
                if size > MAX_MESSAGE or (opcode < 8 and self.fragment_bytes + size > MAX_MESSAGE):
                    self.close(1009, 'message too large')
                    return
                if opcode >= 8 and (not fin or size > 125):
                    self.close(1002, 'invalid control frame')
                    return
                at = now_ms()
                if at - self.frame_at >= 1000:
                    self.frame_at, self.frame_count = at, 0
                self.frame_count += 1
                if self.frame_count > 128:
                    self.close(1008, 'frame rate limit')
                    return
                mask = await self.reader.readexactly(4)
                raw = await self.reader.readexactly(size)
                body = bytes(value ^ mask[i % 4] for i, value in enumerate(raw))
                if opcode == 8:
                    if len(body) == 1:
                        self.close(1002, 'invalid close')
                        return
                    if len(body) >= 2:
                        code = struct.unpack('!H', body[:2])[0]
                        if code < 1000 or code >= 5000 or 1016 <= code < 3000 or code in (1004, 1005, 1006, 1015):
                            self.close(1002, 'invalid close code')
                            return
                        body[2:].decode('utf-8')
                    self.close()
                    return
                if opcode == 9:
                    self.raw(frame(body, 10))
                    continue
                if opcode == 10:
                    self.alive = True
                    continue
                if opcode == 1:
                    if self.fragmenting:
                        self.close(1002, 'nested fragments')
                        return
                    self.fragments, self.fragment_bytes, self.fragmenting = [body], size, not fin
                else:
                    if not self.fragmenting:
                        self.close(1002, 'orphan continuation')
                        return
                    self.fragments.append(body)
                    self.fragment_bytes += size
                    if fin:
                        self.fragmenting = False
                if len(self.fragments) > 64:
                    self.close(1009, 'fragment limit')
                    return
                if fin:
                    text = b''.join(self.fragments).decode('utf-8')
                    self.fragments, self.fragment_bytes = [], 0
                    self.app.hub.message(self, text)
        except UnicodeError:
            self.close(1007, 'invalid UTF-8')
        except (asyncio.IncompleteReadError, OSError, ConnectionError):
            self.close(1001, 'disconnected')
        except asyncio.CancelledError:
            self.close(1001, 'server shutdown')


class Hub(object):
    def __init__(self, store, clock=now_ms):
        self.store, self.clock = store, clock
        self.peers, self.sessions, self.waiting = {}, {}, []
        self.rooms = collections.OrderedDict()
        self.last_heartbeat = clock()

    def error(self, peer, code, **extra):
        data = dict(type='error', code=code, reason=code)
        if isinstance(extra.get('id'), str) and COMMAND_RE.fullmatch(extra['id']):
            data['id'] = extra['id']
        if valid_sequence(extra.get('seq')):
            data['seq'] = extra['seq']
        peer.send(data)

    def attach(self, peer):
        at = self.clock()
        self.peers[peer] = dict(peer=peer, user=None, role=None, room=None, connectedAt=at,
                                deadline=None, latest=None, lastDelta=-1, lastSent=float('-inf'),
                                total=Bucket(60, 90, at), deltaRate=Bucket(20, 40, at),
                                commandRate=Bucket(20, 40, at), ackRate=Bucket(40, 80, at))

    def unqueue(self, state):
        if state in self.waiting:
            self.waiting.remove(state)
        state['deadline'] = None

    def detach(self, state):
        self.unqueue(state)
        state['latest'] = None
        room, state['room'] = state['room'], None
        if room is None:
            return
        room['members'].pop(state['user']['id'], None)
        if not room['members']:
            self.rooms.pop(room['id'], None)
            return
        survivor = next(iter(room['members'].values()))
        room['authorityId'] = survivor['user']['id']
        survivor['peer'].send(dict(type='peer-left', roomId=room['id'], playerId=state['user']['id'],
                                   authorityId=survivor['user']['id'], takeover=True))

    def remove(self, peer):
        state = self.peers.pop(peer, None)
        if state is None:
            return
        self.detach(state)
        if state['user'] is not None and self.sessions.get(state['user']['id']) is state:
            self.sessions.pop(state['user']['id'], None)

    @staticmethod
    def player(state):
        return dict(id=state['user']['id'], username=state['user']['username'], role=state['role'])

    def join(self, state, data):
        peer = state['peer']
        if state['user'] is not None:
            self.error(peer, 'ALREADY_JOINED')
            return
        if data.get('role') not in ROLES:
            self.error(peer, 'INVALID_ROLE')
            return
        try:
            user = self.store.authenticate(data.get('token'))
        except ApiError:
            self.error(peer, 'UNAUTHORIZED')
            peer.close(1008, 'unauthorized')
            return
        if user['id'] in self.sessions:
            self.error(peer, 'ALREADY_CONNECTED')
            peer.close(1008, 'duplicate account')
            return
        at = self.clock()
        state.update(user=user, role=data['role'], lastDelta=-1, lastSent=float('-inf'), latest=None, deadline=at + 30000)
        self.sessions[user['id']] = state
        other = next((s for s in self.waiting if not s['peer'].closed and s['user']['id'] != user['id'] and s['deadline'] > at), None)
        if other is None:
            self.waiting.append(state)
            peer.send(dict(type='waiting', deadline=state['deadline']))
            return
        self.unqueue(other)
        self.unqueue(state)
        room_id = str(uuid.uuid4())
        room = dict(id=room_id, members=collections.OrderedDict(((other['user']['id'], other), (user['id'], state))),
                    authorityId=other['user']['id'], createdAt=at, commands=collections.OrderedDict())
        self.rooms[room_id] = room
        other['room'] = state['room'] = room
        message = dict(type='matched', roomId=room_id, players=[self.player(other), self.player(state)],
                       authorityId=room['authorityId'], seed=random.SystemRandom().randrange(2147483647), startAt=at + 1000)
        other['peer'].send(message)
        peer.send(message)

    def message(self, peer, text):
        state = self.peers.get(peer)
        if state is None:
            return
        try:
            data = decode(text)
        except (ValueError, TypeError):
            self.error(peer, 'INVALID_JSON')
            return
        if not isinstance(data, dict) or not isinstance(data.get('type'), str):
            self.error(peer, 'INVALID_MESSAGE')
            return
        at, kind = self.clock(), data['type']
        if not state['total'].take(at):
            self.error(peer, 'MESSAGE_RATE_LIMIT')
            peer.close(1008, 'message rate')
            return
        if kind == 'join':
            self.join(state, data)
            return
        if state['user'] is None:
            self.error(peer, 'AUTH_REQUIRED')
            return
        if kind == 'leave':
            self.detach(state)
            if self.sessions.get(state['user']['id']) is state:
                self.sessions.pop(state['user']['id'], None)
            state.update(user=None, role=None, connectedAt=at)
            peer.send(dict(type='left'))
            return
        room = state['room']
        if room is None:
            self.error(peer, 'NOT_IN_ROOM')
            return
        others = [s for s in room['members'].values() if s is not state]
        if kind == 'delta':
            if not state['deltaRate'].take(at):
                self.error(peer, 'DELTA_RATE_LIMIT')
                return
            seq, delta = data.get('seq'), data.get('delta')
            if not valid_sequence(seq) or not isinstance(delta, dict) or not valid_payload(delta):
                self.error(peer, 'INVALID_DELTA')
                return
            if seq <= state['lastDelta']:
                return
            envelope = dict(type='delta', **{'from': state['user']['id']}, seq=seq, delta=delta)
            if len(encode(envelope)) > MAX_MESSAGE:
                self.error(peer, 'PAYLOAD_TOO_LARGE')
                return
            state['lastDelta'], state['latest'] = seq, envelope
            return
        if kind not in ('command', 'command-ack'):
            self.error(peer, 'UNKNOWN_MESSAGE_TYPE')
            return
        command_id, seq = data.get('id'), data.get('seq')
        if not state['ackRate' if kind == 'command-ack' else 'commandRate'].take(at):
            self.error(peer, 'COMMAND_RATE_LIMIT', id=command_id, seq=seq)
            return
        if not isinstance(command_id, str) or not COMMAND_RE.fullmatch(command_id) or not valid_sequence(seq):
            self.error(peer, 'INVALID_COMMAND')
            return
        if not others:
            self.error(peer, 'PEER_UNAVAILABLE', id=command_id, seq=seq)
            return
        other = others[0]
        if kind == 'command-ack':
            record = room['commands'].get(other['user']['id'] + ':' + command_id)
            if record is None or record['seq'] != seq:
                self.error(peer, 'UNKNOWN_COMMAND', id=command_id, seq=seq)
                return
            record['acked'] = True
            other['peer'].send(dict(type='command-ack', **{'from': state['user']['id']}, id=command_id, seq=seq))
            return
        command = data.get('command')
        if not isinstance(command, dict) or not valid_payload(command):
            self.error(peer, 'INVALID_COMMAND', id=command_id, seq=seq)
            return
        envelope = dict(type='command', **{'from': state['user']['id']}, id=command_id, seq=seq, command=command)
        encoded = encode(envelope)
        if len(encoded) > MAX_MESSAGE:
            self.error(peer, 'PAYLOAD_TOO_LARGE', id=command_id, seq=seq)
            return
        key, checksum = state['user']['id'] + ':' + command_id, hashlib.sha256(encoded).hexdigest()
        previous = room['commands'].get(key)
        if previous is not None and (previous['seq'] != seq or previous['digest'] != checksum):
            self.error(peer, 'COMMAND_ID_CONFLICT', id=command_id, seq=seq)
            return
        if previous is not None and previous['acked']:
            peer.send(dict(type='command-ack', **{'from': other['user']['id']}, id=command_id, seq=seq))
            return
        if previous is None:
            room['commands'][key] = dict(seq=seq, digest=checksum, acked=False)
            if len(room['commands']) > 512:
                room['commands'].popitem(last=False)
        if not other['peer'].send(envelope):
            self.error(peer, 'PEER_BACKPRESSURE', id=command_id, seq=seq)
            return
        peer.send(dict(type='command-accepted', id=command_id, seq=seq))

    def tick(self):
        at = self.clock()
        for state in list(self.peers.values()):
            if state['user'] is None and at - state['connectedAt'] >= 5000:
                state['peer'].close(1008, 'authentication timeout')
                continue
            if state['deadline'] is not None and at >= state['deadline']:
                self.unqueue(state)
                state['peer'].send(dict(type='bot-fallback', reason='NO_HUMAN_WITHIN_30_SECONDS'))
                continue
            if state['latest'] is not None and state['room'] is not None and at - state['lastSent'] >= 100:
                latest, state['latest'], state['lastSent'] = state['latest'], None, at
                for other in list(state['room']['members'].values()):
                    if other is not state:
                        other['peer'].send(latest, state=True)
        for room in list(self.rooms.values()):
            if at - room['createdAt'] >= 1200000:
                for state in list(room['members'].values()):
                    state['peer'].close(1001, 'room expired')
        if at - self.last_heartbeat >= 15000:
            self.last_heartbeat = at
            for peer in list(self.peers):
                peer.ping()

    def close(self):
        for peer in list(self.peers):
            peer.close(1001, 'server shutdown')
        self.peers.clear()
        self.sessions.clear()
        self.waiting[:] = []
        self.rooms.clear()


class App(object):
    def __init__(self, db_path, origins=(), host='127.0.0.1', port=8787):
        self.loop = asyncio.get_event_loop()
        self.store, self.origins = Store(db_path), set(origins)
        self.hub = Hub(self.store)
        self.host, self.port, self.closing = host, port, False
        self.requests, self.writers, self.tasks = collections.OrderedDict(), set(), set()
        self.ws_ips = collections.Counter()
        self.stop_event = asyncio.Event()

    def allowed(self, headers):
        origin = headers.get('origin')
        return not origin or origin in self.origins or origin == 'http://' + headers.get('host', '')

    def rate(self, ip, kind):
        key, at = ip + ':' + kind, now_ms()
        entry = self.requests.get(key)
        if entry is None or at - entry[0] >= 60000:
            entry = [at, 0]
            self.requests.pop(key, None)
            self.requests[key] = entry
        if len(self.requests) > 8192:
            self.requests.popitem(last=False)
        entry[1] += 1
        return entry[1] <= (30 if kind == 'register' else 180)

    async def respond(self, writer, headers, status, data=None, extra=None):
        reasons = {200: 'OK', 201: 'Created', 204: 'No Content', 400: 'Bad Request', 401: 'Unauthorized',
                   403: 'Forbidden', 404: 'Not Found', 413: 'Payload Too Large', 415: 'Unsupported Media Type',
                   429: 'Too Many Requests', 500: 'Internal Server Error', 503: 'Service Unavailable'}
        body = b'' if status == 204 else encode(data)
        output = {'Content-Type': 'application/json; charset=utf-8', 'Content-Length': str(len(body)),
                  'Connection': 'close', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff',
                  'Content-Security-Policy': "default-src 'none'; frame-ancestors 'none'", 'Referrer-Policy': 'no-referrer',
                  'Vary': 'Origin'}
        if headers.get('origin') and self.allowed(headers):
            output['Access-Control-Allow-Origin'] = headers['origin']
        if extra:
            output.update(extra)
        response = 'HTTP/1.1 {} {}\r\n'.format(status, reasons.get(status, 'Error'))
        response += ''.join('{}: {}\r\n'.format(k, v) for k, v in output.items()) + '\r\n'
        writer.write(response.encode('ascii') + body)
        await asyncio.wait_for(writer.drain(), timeout=10.0)

    @staticmethod
    def bearer(headers):
        value = headers.get('authorization', '')
        if not value.startswith('Bearer ') or not TOKEN_RE.fullmatch(value[7:]):
            raise ApiError(401, 'UNAUTHORIZED')
        return value[7:]

    async def read_body(self, reader, headers):
        if not headers.get('content-type', '').lower().startswith('application/json'):
            raise ApiError(415, 'JSON_REQUIRED')
        if headers.get('transfer-encoding'):
            raise ApiError(400, 'BAD_REQUEST')
        length_text = headers.get('content-length', '0')
        if not re.fullmatch(r'[0-9]{1,12}', length_text):
            raise ApiError(400, 'BAD_REQUEST')
        length = int(length_text)
        if length < 0:
            raise ApiError(400, 'BAD_REQUEST')
        if length > 4096:
            raise ApiError(413, 'BODY_TOO_LARGE')
        try:
            raw = await asyncio.wait_for(reader.readexactly(length), timeout=10.0)
            data = decode(raw.decode('utf-8') or '{}')
        except (ValueError, UnicodeError):
            raise ApiError(400, 'INVALID_JSON')
        if not isinstance(data, dict):
            raise ApiError(400, 'INVALID_JSON')
        return data

    async def websocket(self, reader, writer, headers, ip, method):
        key = headers.get('sec-websocket-key', '')
        connection = [p.strip().lower() for p in headers.get('connection', '').split(',')]
        try:
            key_bytes = base64.b64decode(key.encode('ascii'), validate=True)
        except (ValueError, UnicodeError):
            key_bytes = b''
        if method != 'GET' or headers.get('upgrade', '').lower() != 'websocket' or \
                'upgrade' not in connection or headers.get('sec-websocket-version') != '13' or \
                not re.fullmatch(r'[A-Za-z0-9+/]{22}==', key) or len(key_bytes) != 16:
            raise ApiError(400, 'BAD_REQUEST')
        if self.ws_ips[ip] >= 8 or len(self.hub.peers) >= 200:
            raise ApiError(503, 'SERVER_CAPACITY')
        accept = base64.b64encode(hashlib.sha1((key + '258EAFA5-E914-47DA-95CA-C5AB0DC85B11').encode('ascii')).digest()).decode('ascii')
        peer = Peer(self, reader, writer)
        self.ws_ips[ip] += 1
        self.hub.attach(peer)
        try:
            writer.write(('HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: ' + accept + '\r\n\r\n').encode('ascii'))
            await writer.drain()
            await peer.run()
        finally:
            peer.close(1001, 'disconnected')
            self.ws_ips[ip] -= 1
            if self.ws_ips[ip] <= 0:
                self.ws_ips.pop(ip, None)

    async def handle(self, reader, writer):
        if self.closing or len(self.writers) >= 300:
            writer.close()
            return
        current_task = getattr(asyncio, 'current_task', None)
        task = current_task() if current_task else asyncio.Task.current_task(loop=self.loop)
        self.tasks.add(task)
        self.writers.add(writer)
        headers, upgraded = {}, False
        ip = (writer.get_extra_info('peername') or ('unknown',))[0]
        try:
            raw = await asyncio.wait_for(reader.readuntil(b'\r\n\r\n'), timeout=10.0)
            if len(raw) > 16384:
                raise ApiError(400, 'BAD_REQUEST')
            lines = raw.decode('iso-8859-1').split('\r\n')
            parts = lines[0].split(' ')
            if len(parts) != 3 or parts[2] not in ('HTTP/1.0', 'HTTP/1.1'):
                raise ApiError(400, 'BAD_REQUEST')
            method, target = parts[:2]
            for line in lines[1:]:
                if not line:
                    continue
                if ':' not in line or line[0] in ' \t':
                    raise ApiError(400, 'BAD_REQUEST')
                name, value = line.split(':', 1)
                name, value = name.lower(), value.strip()
                if name in headers or not re.fullmatch(r'[a-z0-9!#$%&\x27*+.^_`|~-]+', name) or \
                        any((ord(c) < 32 and c != '\t') or ord(c) == 127 for c in value):
                    raise ApiError(400, 'BAD_REQUEST')
                headers[name] = value
            ip = client_ip(ip, headers.get('x-real-ip'))
            url = urlsplit(target)
            if url.query or url.fragment:
                raise ApiError(400, 'QUERY_NOT_ALLOWED')
            if self.closing:
                raise ApiError(503, 'SHUTTING_DOWN')
            if not self.allowed(headers):
                raise ApiError(403, 'ORIGIN_NOT_ALLOWED')
            if not self.rate(ip, 'all'):
                raise ApiError(429, 'HTTP_RATE_LIMIT')
            if headers.get('upgrade'):
                if url.path != '/ws':
                    raise ApiError(403, 'ORIGIN_NOT_ALLOWED')
                upgraded = True
                try:
                    await self.websocket(reader, writer, headers, ip, method)
                except ApiError:
                    upgraded = False
                    raise
                return
            if method == 'OPTIONS':
                await self.respond(writer, headers, 204, extra={'Access-Control-Allow-Origin': headers.get('origin', 'null'),
                                   'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
                                   'Access-Control-Allow-Headers': 'Content-Type, Authorization', 'Access-Control-Max-Age': '600'})
                return
            if method == 'GET' and url.path == '/health':
                await self.respond(writer, headers, 200, dict(ok=True, service='ruins-traveler-multiplayer', protocol=1))
                return
            if method == 'GET' and url.path == '/api/leaderboard':
                result = self.store.leaderboard()
                result['ok'] = True
                await self.respond(writer, headers, 200, result)
                return
            if method != 'POST':
                raise ApiError(404, 'NOT_FOUND')
            if url.path == '/api/register':
                if not self.rate(ip, 'register'):
                    raise ApiError(429, 'REGISTRATION_RATE_LIMIT')
                result = self.store.register(await self.read_body(reader, headers))
                result['ok'] = True
                await self.respond(writer, headers, 201, result)
                return
            if url.path in ('/api/login', '/api/wealth'):
                token = self.bearer(headers)
                data = await self.read_body(reader, headers)
                profile = self.store.authenticate(token) if url.path == '/api/login' else self.store.set_wealth(token, data.get('wealth'))
                await self.respond(writer, headers, 200, dict(ok=True, profile=profile))
                return
            raise ApiError(404, 'NOT_FOUND')
        except ApiError as error:
            if not upgraded:
                try:
                    await self.respond(writer, headers, error.status, dict(ok=False, error=error.code, code=error.code))
                except (OSError, RuntimeError, asyncio.TimeoutError):
                    pass
        except (asyncio.IncompleteReadError, asyncio.LimitOverrunError, asyncio.TimeoutError, OSError, ValueError):
            pass
        except Exception:
            if not upgraded:
                try:
                    await self.respond(writer, headers, 500, dict(ok=False, error='INTERNAL_ERROR', code='INTERNAL_ERROR'))
                except (OSError, RuntimeError, asyncio.TimeoutError):
                    pass
        finally:
            writer.close()
            self.writers.discard(writer)
            self.tasks.discard(task)

    async def ticker(self):
        try:
            while not self.closing:
                self.hub.tick()
                await asyncio.sleep(0.025)
        except asyncio.CancelledError:
            pass

    async def run(self):
        server = await asyncio.start_server(self.handle, self.host, self.port, limit=16384, backlog=128)
        tick_task = asyncio.ensure_future(self.ticker())
        actual_port = server.sockets[0].getsockname()[1]
        print(encode(dict(service='ruins-traveler-multiplayer', listening=True, port=actual_port, runtime='python-stdlib')).decode('ascii'), flush=True)
        for sig in (signal.SIGINT, signal.SIGTERM):
            try:
                self.loop.add_signal_handler(sig, self.stop_event.set)
            except (NotImplementedError, RuntimeError):
                signal.signal(sig, lambda *_args: self.loop.call_soon_threadsafe(self.stop_event.set))
        try:
            await self.stop_event.wait()
        finally:
            self.closing = True
            server.close()
            await server.wait_closed()
            self.hub.close()
            for writer in list(self.writers):
                writer.close()
            tick_task.cancel()
            await tick_task
            if self.tasks:
                pending = list(self.tasks)
                done, unfinished = await asyncio.wait(pending, timeout=1.0)
                for task in unfinished:
                    task.cancel()
                if unfinished:
                    await asyncio.gather(*unfinished, return_exceptions=True)
            self.store.close()


def main():
    port = int(os.environ.get('PORT', '8787'))
    if not 0 <= port <= 65535:
        raise ValueError('Invalid PORT')
    loop = asyncio.new_event_loop()
    asyncio.set_event_loop(loop)
    path = os.environ.get('DB_PATH', os.path.join(os.path.dirname(os.path.abspath(__file__)), 'data', 'accounts.sqlite'))
    app = App(path, origins=[s for s in os.environ.get('ALLOWED_ORIGINS', '').split(',') if s],
              host=os.environ.get('HOST', '127.0.0.1'), port=port)
    try:
        loop.run_until_complete(app.run())
    finally:
        loop.close()


if __name__ == '__main__':
    main()
