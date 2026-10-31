"""Python 3.6-compatible stdlib tests; no pytest or system dependencies."""
import asyncio
import copy
import json
import os
import shutil
import struct
import sys
import tempfile
import unittest

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, ROOT)
import server


def register(store, n):
    return store.register(dict(deviceId='python-device-code-%06d' % n, username='玩家%d' % n))


class StoreTests(unittest.TestCase):
    def test_unique_device_name_and_token_privacy(self):
        store = server.Store()
        try:
            first = register(store, 1)
            self.assertEqual(len(first['token']), 43)
            with self.assertRaises(server.ApiError) as caught:
                register(store, 1)
            self.assertEqual(caught.exception.code, 'DEVICE_ALREADY_REGISTERED')
            with self.assertRaises(server.ApiError) as caught:
                store.register(dict(deviceId='different-device-code', username='玩家1'))
            self.assertEqual(caught.exception.code, 'USERNAME_TAKEN')
            store.register(dict(deviceId='different-device-code', username='新玩家'))
            for wrong in ('python-device-code-000001', first['profile']['id'], first['token'] + '\n'):
                with self.assertRaises(server.ApiError):
                    store.authenticate(wrong)
            self.assertEqual(store.authenticate(first['token'])['id'], first['profile']['id'])
            row = dict(store.db.execute('SELECT * FROM users LIMIT 1').fetchone())
            self.assertNotEqual(row['token_hash'], first['token'])
            self.assertNotIn('device_hash', first['profile'])
        finally:
            store.close()

    def test_zero_safe_wealth_and_invalid_names(self):
        for value in (0, '0', 42, 42.0, str(server.MAX_SAFE), server.MAX_SAFE):
            self.assertEqual(server.valid_wealth(value), int(value))
        for value in (-1, '-1', '01', '1\n', 1.5, float('nan'), float('inf'), None, True, '', server.MAX_SAFE + 1):
            with self.assertRaises(server.ApiError):
                server.valid_wealth(value)
        for name in ('a', '<script>', "x';DROP TABLE users;--", 'a b', 'x' * 17):
            with self.assertRaises(server.ApiError):
                server.valid_username(name)
        self.assertEqual(server.valid_username('ＡＬＩＣＥ'), 'ALICE')
        self.assertFalse(server.valid_sequence(10 ** 309))

    def test_persistent_account_and_zero_overwrites(self):
        base = os.path.join(os.path.dirname(__file__), '.tmp')
        os.makedirs(base, exist_ok=True)
        directory = tempfile.mkdtemp(prefix='python-', dir=base)
        try:
            path = os.path.join(directory, 'account.sqlite')
            store = server.Store(path)
            first = register(store, 1)
            store.set_wealth(first['token'], 55)
            store.set_wealth(first['token'], 0)
            store.close()
            store = server.Store(path)
            self.assertEqual(store.authenticate(first['token'])['wealth'], 0)
            store.close()
        finally:
            self.assertEqual(os.path.commonpath([os.path.abspath(directory), os.path.abspath(base)]), os.path.abspath(base))
            self.assertNotEqual(os.path.abspath(directory), os.path.abspath(base))
            shutil.rmtree(directory)

    def test_top100_ten_minute_snapshot(self):
        clock = [1000]
        store = server.Store(clock=lambda: clock[0])
        try:
            first = None
            for n in range(105):
                account = register(store, n)
                first = first or account
                store.set_wealth(account['token'], n)
            before = store.leaderboard()
            self.assertEqual(len(before['rows']), 100)
            self.assertEqual(before['rows'][0]['wealth'], 104)
            store.set_wealth(first['token'], 1000)
            clock[0] += 599999
            self.assertEqual(store.leaderboard(), before)
            clock[0] += 1
            self.assertEqual(store.leaderboard()['rows'][0]['wealth'], 1000)
        finally:
            store.close()


class ProxyTests(unittest.TestCase):
    def test_loopback_trust_and_nonlocal_header_spoof(self):
        for transport in ('127.0.0.1', '127.2.3.4', '::1', '0:0:0:0:0:0:0:1', '::ffff:127.0.0.1', '::ffff:7f00:1'):
            self.assertEqual(server.client_ip(transport, '198.51.100.7'), '198.51.100.7')
        self.assertEqual(server.client_ip('203.0.113.4', '198.51.100.7'), '203.0.113.4')
        self.assertEqual(server.client_ip('::ffff:203.0.113.4', '198.51.100.7'), '203.0.113.4')
        self.assertEqual(server.client_ip('127.0.0.1'), '127.0.0.1')
        self.assertEqual(server.literal_ip('2001:0DB8:0:0:0:0:0:1'), '2001:db8::1')

    def test_bad_headers_fall_back_without_splitting_rate_buckets(self):
        for value in ('', None, [], ['198.51.100.7'], '198.51.100.7,198.51.100.8', '198.51.100.7 ',
                      ' 198.51.100.7', '198.51.100.7:443', '[2001:db8::1]', 'fe80::1%lo0',
                      '127.000.0.1', '::ffff:127.000.0.1', 'localhost'):
            self.assertIsNone(server.literal_ip(value))
            self.assertEqual(server.client_ip('127.0.0.1', value), '127.0.0.1')


class FakePeer(object):
    def __init__(self, hub):
        self.hub, self.closed, self.messages = hub, False, []
        hub.attach(self)

    def send(self, data, state=False):
        if self.closed:
            return False
        self.messages.append(copy.deepcopy(data))
        return True

    def close(self, *args):
        if not self.closed:
            self.closed = True
            self.hub.remove(self)

    def ping(self):
        pass

    def input(self, value):
        self.hub.message(self, server.encode(value).decode('utf-8'))

    def take(self, kind):
        return [m for m in self.messages if m['type'] == kind]


class HubTests(unittest.TestCase):
    def setUp(self):
        self.clock = [1000]
        self.store = server.Store(clock=lambda: self.clock[0])
        self.hub = server.Hub(self.store, clock=lambda: self.clock[0])
        self.users = [register(self.store, i) for i in range(3)]

    def tearDown(self):
        self.hub.close()
        self.store.close()

    def peer(self, n):
        peer = FakePeer(self.hub)
        peer.input(dict(type='join', token=self.users[n]['token'], role='swordsman'))
        return peer

    def test_pair_fallback_and_disconnect_cleanup(self):
        first, second, waiting = self.peer(0), self.peer(1), self.peer(2)
        self.assertEqual(first.take('matched')[0]['authorityId'], self.users[0]['profile']['id'])
        self.assertEqual(len(second.take('matched')[0]['players']), 2)
        self.assertEqual(len(self.hub.rooms), 1)
        self.clock[0] += 29999
        self.hub.tick()
        self.assertEqual(len(waiting.take('bot-fallback')), 0)
        self.clock[0] += 1
        self.hub.tick()
        self.hub.tick()
        self.assertEqual(len(waiting.take('bot-fallback')), 1)
        first.close()
        self.assertEqual(second.take('peer-left')[0]['authorityId'], self.users[1]['profile']['id'])
        second.close()
        self.assertEqual(len(self.hub.rooms), 0)

    def test_latest_delta_commands_retry_ack_and_conflict(self):
        first, second = self.peer(0), self.peer(1)
        for seq in range(1, 5):
            first.input(dict(type='delta', seq=seq, delta=dict(x=seq), roomId='fake-room'))
        self.hub.tick()
        self.assertEqual(second.take('delta')[0]['delta']['x'], 4)
        command = dict(type='command', id='settlement:1', seq=1, command=dict(kind='settlement', amount=7))
        first.input(command)
        first.input(command)
        self.assertEqual(len(second.take('command')), 2)
        second.input(dict(type='command-ack', id='settlement:1', seq=1))
        first.input(command)
        self.assertEqual(len(first.take('command-ack')), 2)
        self.assertEqual(len(second.take('command')), 2)
        command['command']['amount'] = 9
        first.input(command)
        self.assertEqual(first.take('error')[-1]['code'], 'COMMAND_ID_CONFLICT')
        self.assertFalse(server.valid_payload(server.decode('{"__proto__":{"x":1}}')))
        with self.assertRaises(ValueError):
            server.decode('{"x":NaN}')


class Transport(object):
    def __init__(self):
        self.pending = 0
        self.aborted = False

    def get_write_buffer_size(self):
        return self.pending

    def abort(self):
        self.aborted = True


class Writer(object):
    def __init__(self):
        self.transport, self.packets, self.closed = Transport(), [], False

    def write(self, packet):
        self.packets.append(packet)

    async def drain(self):
        if self.transport.pending:
            await asyncio.sleep(3600)

    def close(self):
        self.closed = True


class PeerHub(object):
    def __init__(self):
        self.messages = []

    def remove(self, peer):
        pass

    def message(self, peer, text):
        self.messages.append(text)


class AppStub(object):
    def __init__(self, loop):
        self.loop, self.hub = loop, PeerHub()


def masked(value, opcode=1, fin=True):
    data = value.encode('utf-8') if isinstance(value, str) else value
    packet = server.frame(data, opcode)
    header = bytearray(packet[:len(packet) - len(data)] if data else packet)
    header[0], header[1] = (128 if fin else 0) | opcode, header[1] | 128
    mask = b'1234'
    return bytes(header) + mask + bytes(v ^ mask[i % 4] for i, v in enumerate(data))


class WireTests(unittest.TestCase):
    def setUp(self):
        self.loop = asyncio.new_event_loop()
        asyncio.set_event_loop(self.loop)

    def tearDown(self):
        all_tasks = getattr(asyncio, 'all_tasks', None)
        tasks = list(all_tasks(self.loop) if all_tasks else asyncio.Task.all_tasks(self.loop))
        for task in tasks:
            task.cancel()
        if tasks:
            self.loop.run_until_complete(asyncio.gather(*tasks, return_exceptions=True))
        self.loop.close()

    def run_wire(self, data):
        app, writer, reader = AppStub(self.loop), Writer(), asyncio.StreamReader()
        peer = server.Peer(app, reader, writer)
        reader.feed_data(data)
        reader.feed_eof()
        self.loop.run_until_complete(peer.run())
        return app, peer, writer

    def test_masking_fragment_utf8_and_oversize_wire(self):
        value = '中文'.encode('utf-8')
        app, peer, writer = self.run_wire(masked(value[:4], fin=False) + masked(b'ping', opcode=9) + masked(value[4:], opcode=0))
        self.assertEqual(app.hub.messages, ['中文'])
        self.assertEqual(writer.packets[0][0] & 15, 10)
        app, peer, writer = self.run_wire(masked(b'x' * 65536))
        self.assertEqual(len(app.hub.messages[0]), 65536)
        app, peer, writer = self.run_wire(bytes([129, 255]) + struct.pack('!Q', 65537))
        self.assertEqual(struct.unpack('!H', writer.packets[-1][2:4])[0], 1009)
        app, peer, writer = self.run_wire(server.frame(b'unmasked'))
        self.assertEqual(struct.unpack('!H', writer.packets[-1][2:4])[0], 1002)

    def test_reliable_queue_latest_state_and_fragment_count_bound(self):
        app, writer, reader = AppStub(self.loop), Writer(), asyncio.StreamReader()
        writer.transport.pending = 65536
        peer = server.Peer(app, reader, writer)
        for seq in range(3):
            peer.send(dict(type='delta', seq=seq), state=True)
        self.assertEqual(server.decode(peer.latest[2:].decode('utf-8'))['seq'], 2)
        for seq in range(64):
            self.assertTrue(peer.send(dict(type='command', id=str(seq))))
        self.assertFalse(peer.send(dict(type='command', id='overflow')))
        self.assertTrue(peer.closed)
        empty = masked(b'', fin=False) + masked(b'', opcode=0, fin=False) * 64
        app, peer, writer = self.run_wire(empty)
        self.assertEqual(struct.unpack('!H', writer.packets[-1][2:4])[0], 1009)


if __name__ == '__main__':
    unittest.main()
