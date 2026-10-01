import test from 'node:test';
import assert from 'node:assert/strict';

import {
  artists,
  songs,
  artistById,
  songById,
  createInitialState,
  restoreState,
  playlistSongCount,
  validateState,
  createPlaylist,
  addSongToPlaylist,
  removeSongFromPlaylist,
  deletePlaylist,
  playSong,
  pauseSong,
} from '../src/model.js';

const playlist = (state, id) => state.playlists.find((item) => item.id === id);

test('sample data describes artists, songs, and valid relationships', () => {
  const state = createInitialState();
  assert.equal(validateState(state), true);
  assert.equal(new Set(artists.map((artist) => artist.id)).size, artists.length);
  assert.equal(new Set(songs.map((song) => song.id)).size, songs.length);
  for (const artist of artists) {
    assert.ok(artist.name && artist.genre);
    assert.ok(songs.some((song) => song.artistId === artist.id));
  }
  for (const song of songs) {
    assert.ok(song.title && song.genre);
    assert.ok(Number.isInteger(song.duration) && song.duration > 0);
    assert.ok(Number.isInteger(song.releaseYear));
    assert.equal(artistById.has(song.artistId), true);
    assert.equal(songById.get(song.id), song);
  }
  assert.ok(state.playlists.some((item) => item.songIds.length > 1));
  assert.ok(state.playlists.filter((item) => item.songIds.includes('afterglow')).length > 1);
});

test('every song must reference an existing artist', () => {
  const song = songs[0];
  const originalArtistId = song.artistId;
  try {
    song.artistId = 'missing-artist';
    assert.throws(() => validateState(createInitialState()), /has no artist/);
  } finally {
    song.artistId = originalArtistId;
  }
});

test('creating a playlist starts it empty without changing prior state', () => {
  const original = createInitialState();
  const next = createPlaylist(original, '  Sunday Morning  ', 'sunday');
  assert.equal(original.playlists.length, 3);
  assert.equal(next.playlists.length, 4);
  assert.deepEqual(playlist(next, 'sunday'), { id: 'sunday', name: 'Sunday Morning', songIds: [] });
  assert.equal(playlistSongCount(playlist(next, 'sunday')), 0);
  assert.throws(() => createPlaylist(next, '  ', 'blank'), /Enter a name/);
  assert.throws(() => createPlaylist(next, 'sunday morning', 'duplicate-name'), /already exists/);
  assert.throws(() => createPlaylist(next, 'Another', 'sunday'), /ID already exists/);
  assert.throws(() => createPlaylist(next, 'x'.repeat(37), 'long'), /36 characters/);
});

test('adding a song allows multiple playlists but never a duplicate in one', () => {
  const original = createInitialState();
  const withPlaylist = createPlaylist(original, 'Another Mix', 'another');
  const next = addSongToPlaylist(withPlaylist, 'another', 'afterglow');
  assert.deepEqual(playlist(next, 'another').songIds, ['afterglow']);
  assert.equal(playlistSongCount(playlist(next, 'another')), 1);
  assert.ok(playlist(next, 'night-drive').songIds.includes('afterglow'));
  assert.deepEqual(playlist(withPlaylist, 'another').songIds, []);
  assert.throws(() => addSongToPlaylist(next, 'another', 'afterglow'), /already in this playlist/);
  assert.throws(() => addSongToPlaylist(next, 'another', 'missing-song'), /existing song/);
  assert.throws(() => addSongToPlaylist(next, 'missing-playlist', 'afterglow'), /existing playlist/);
});

test('removing a song requires membership and preserves its other memberships', () => {
  const original = createInitialState();
  const next = removeSongFromPlaylist(original, 'night-drive', 'afterglow');
  assert.equal(playlist(next, 'night-drive').songIds.includes('afterglow'), false);
  assert.equal(playlist(next, 'fresh-finds').songIds.includes('afterglow'), true);
  assert.equal(playlist(original, 'night-drive').songIds.includes('afterglow'), true);
  assert.equal(songById.has('afterglow'), true);
  assert.throws(() => removeSongFromPlaylist(next, 'night-drive', 'afterglow'), /already in the playlist/);
  assert.throws(() => removeSongFromPlaylist(next, 'missing-playlist', 'afterglow'), /existing playlist/);
});

test('deleting a playlist leaves songs, artists, and other playlists intact', () => {
  const original = createInitialState();
  const remaining = original.playlists.filter((item) => item.id !== 'night-drive');
  const next = deletePlaylist(original, 'night-drive');
  assert.deepEqual(next.playlists, remaining);
  assert.equal(original.playlists.length, 3);
  assert.equal(songs.length, 8);
  assert.equal(artists.length, 3);
  assert.equal(songById.has('afterglow'), true);
  assert.throws(() => deletePlaylist(next, 'night-drive'), /existing playlist/);
});

test('playing another song replaces the current one; pausing clears it', () => {
  const original = createInitialState();
  const first = playSong(original, 'paper');
  const second = playSong(first, 'afterglow');
  assert.equal(original.playingSongId, null);
  assert.equal(first.playingSongId, 'paper');
  assert.equal(second.playingSongId, 'afterglow');
  assert.equal(pauseSong(second).playingSongId, null);
  assert.throws(() => playSong(second, 'missing-song'), /existing song/);
});

test('restoring saved playlists validates them and never resumes playback', () => {
  const saved = createPlaylist(createInitialState(), 'Saved Mix', 'saved');
  const restored = restoreState({ playlists: saved.playlists, playingSongId: 'paper' });
  assert.deepEqual(restored.playlists, saved.playlists);
  assert.notStrictEqual(restored.playlists, saved.playlists);
  assert.notStrictEqual(playlist(restored, 'night-drive').songIds, playlist(saved, 'night-drive').songIds);
  assert.equal(restored.playingSongId, null);

  const invalid = createInitialState();
  playlist(invalid, 'night-drive').songIds.push('afterglow');
  assert.deepEqual(restoreState(invalid), createInitialState());
  assert.deepEqual(restoreState(null), createInitialState());
});

test('validation rejects duplicate or missing playlist and song references', () => {
  const duplicatePlaylistId = createInitialState();
  duplicatePlaylistId.playlists.push({ id: 'night-drive', name: 'Duplicate', songIds: [] });
  assert.throws(() => validateState(duplicatePlaylistId), /IDs must be unique/);

  const duplicateSong = createInitialState();
  playlist(duplicateSong, 'night-drive').songIds.push('afterglow');
  assert.throws(() => validateState(duplicateSong), /cannot appear twice/);

  const unknownSong = createInitialState();
  playlist(unknownSong, 'night-drive').songIds.push('missing-song');
  assert.throws(() => validateState(unknownSong), /unknown song/);

  const blankName = createInitialState();
  playlist(blankName, 'night-drive').name = '  ';
  assert.throws(() => validateState(blankName), /names cannot be empty/);

  const unknownPlayingSong = { ...createInitialState(), playingSongId: 'missing-song' };
  assert.throws(() => validateState(unknownPlayingSong), /unknown song is playing/);
});
