import test from 'node:test';
import assert from 'node:assert/strict';
import {
  filterPublicRooms,
  countPublicRoomsOnServer,
  isPublicRoomDiscoverable,
} from '../src/lib/publicRoomsFilter.js';

test('in-progress public auctions stay visible when host presence is stale', () => {
  const rooms = [
    { id: 'W1', server: 'server-1', status: 'waiting', hostOnline: true },
    { id: 'W2', server: 'server-1', status: 'waiting', hostOnline: false },
    { id: 'A1', server: 'server-1', status: 'active', hostOnline: false },
    { id: 'P1', server: 'server-1', status: 'paused', hostOnline: false },
  ];

  assert.equal(isPublicRoomDiscoverable(rooms[2]), true);
  assert.equal(isPublicRoomDiscoverable(rooms[1]), false);

  const visible = filterPublicRooms(rooms, {
    searchQuery: '',
    filterMode: 'all',
    selectedServer: 'server-1',
  });
  assert.deepEqual(visible.map((r) => r.id), ['W1', 'A1', 'P1']);
  assert.equal(countPublicRoomsOnServer(rooms, 'server-1'), 3);
});

test('filterPublicRooms respects server, search, and mode', () => {
  const rooms = [
    { id: 'ABC', server: 'server-2', status: 'active', hostOnline: true, type: 'mega' },
    { id: 'XYZ', server: 'server-1', status: 'waiting', hostOnline: true, type: 'legends' },
  ];
  assert.equal(
    filterPublicRooms(rooms, { selectedServer: 'server-2', filterMode: 'all' }).length,
    1,
  );
  assert.equal(
    filterPublicRooms(rooms, { selectedServer: 'server-1', filterMode: 'legends' }).length,
    1,
  );
  assert.equal(
    filterPublicRooms(rooms, { selectedServer: 'server-2', searchQuery: 'abc' }).length,
    1,
  );
});