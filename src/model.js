export const artists = [
  { id: 'halcyon', name: 'The Halcyon Array', genre: 'Electronic' },
  { id: 'mira', name: 'Mira Sol', genre: 'Indie Pop' },
  { id: 'northbound', name: 'Northbound', genre: 'Jazz' },
];

export const songs = [
  { id: 'afterglow', title: 'Afterglow Circuit', duration: 234, releaseYear: 2023, genre: 'Electronic', artistId: 'halcyon' },
  { id: 'glass', title: 'Glass Meridian', duration: 207, releaseYear: 2022, genre: 'Electronic', artistId: 'halcyon' },
  { id: 'orbit', title: 'Low Orbit', duration: 251, releaseYear: 2024, genre: 'Ambient', artistId: 'halcyon' },
  { id: 'paper', title: 'Paper Planets', duration: 198, releaseYear: 2022, genre: 'Indie Pop', artistId: 'mira' },
  { id: 'blue', title: 'Blue Hour Signal', duration: 222, releaseYear: 2024, genre: 'Indie Pop', artistId: 'mira' },
  { id: 'satellite', title: 'Satellite Heart', duration: 213, releaseYear: 2021, genre: 'Indie Pop', artistId: 'mira' },
  { id: 'velvet', title: 'Velvet Transit', duration: 265, releaseYear: 2020, genre: 'Jazz', artistId: 'northbound' },
  { id: 'train', title: 'Late Train Home', duration: 242, releaseYear: 2019, genre: 'Jazz', artistId: 'northbound' },
];

const initialPlaylists = [
  { id: 'night-drive', name: 'Night Drive', songIds: ['afterglow', 'glass', 'blue', 'velvet'] },
  { id: 'soft-focus', name: 'Soft Focus', songIds: ['orbit', 'paper', 'train'] },
  { id: 'fresh-finds', name: 'Fresh Finds', songIds: ['satellite', 'blue', 'afterglow'] },
];

export const artistById = new Map(artists.map((artist) => [artist.id, artist]));
export const songById = new Map(songs.map((song) => [song.id, song]));

export function createInitialState() {
  return {
    playlists: initialPlaylists.map((playlist) => ({ ...playlist, songIds: [...playlist.songIds] })),
    playingSongId: null,
  };
}

export function playlistSongCount(playlist) {
  return playlist.songIds.length;
}

export function validateState(state) {
  if (!state || !Array.isArray(state.playlists)) throw new Error('The collection is invalid.');
  for (const song of songs) {
    if (!artistById.has(song.artistId)) throw new Error(`Song ${song.title} has no artist.`);
  }
  const playlistIds = new Set();
  for (const playlist of state.playlists) {
    if (typeof playlist.id !== 'string' || playlistIds.has(playlist.id)) throw new Error('Playlist IDs must be unique.');
    if (typeof playlist.name !== 'string' || !playlist.name.trim()) throw new Error('Playlist names cannot be empty.');
    if (!Array.isArray(playlist.songIds)) throw new Error('A playlist needs a song list.');
    playlistIds.add(playlist.id);
    const seen = new Set();
    for (const songId of playlist.songIds) {
      if (!songById.has(songId)) throw new Error('A playlist references an unknown song.');
      if (seen.has(songId)) throw new Error('A song cannot appear twice in one playlist.');
      seen.add(songId);
    }
  }
  if (state.playingSongId !== null && !songById.has(state.playingSongId)) throw new Error('An unknown song is playing.');
  return true;
}

export function restoreState(value) {
  try {
    const state = {
      playlists: value.playlists.map((playlist) => ({
        id: playlist.id,
        name: playlist.name,
        songIds: [...playlist.songIds],
      })),
      playingSongId: null,
    };
    validateState(state);
    return state;
  } catch {
    return createInitialState();
  }
}

export function createPlaylist(state, name, id) {
  const trimmed = name.trim();
  if (!trimmed) throw new Error('Enter a name for the new playlist.');
  if (trimmed.length > 36) throw new Error('Playlist names must be 36 characters or fewer.');
  if (state.playlists.some((playlist) => playlist.name.toLowerCase() === trimmed.toLowerCase())) {
    throw new Error('A playlist with that name already exists.');
  }
  if (state.playlists.some((playlist) => playlist.id === id)) throw new Error('Playlist ID already exists.');
  const next = { ...state, playlists: [...state.playlists, { id, name: trimmed, songIds: [] }] };
  validateState(next);
  return next;
}

export function addSongToPlaylist(state, playlistId, songId) {
  if (!songById.has(songId)) throw new Error('Choose an existing song.');
  const playlist = state.playlists.find((item) => item.id === playlistId);
  if (!playlist) throw new Error('Choose an existing playlist.');
  if (playlist.songIds.includes(songId)) throw new Error('That song is already in this playlist.');
  const next = {
    ...state,
    playlists: state.playlists.map((item) => item.id === playlistId ? { ...item, songIds: [...item.songIds, songId] } : item),
  };
  validateState(next);
  return next;
}

export function removeSongFromPlaylist(state, playlistId, songId) {
  const playlist = state.playlists.find((item) => item.id === playlistId);
  if (!playlist) throw new Error('Choose an existing playlist.');
  if (!playlist.songIds.includes(songId)) throw new Error('Only a song already in the playlist can be removed.');
  const next = {
    ...state,
    playlists: state.playlists.map((item) => item.id === playlistId ? { ...item, songIds: item.songIds.filter((id) => id !== songId) } : item),
  };
  validateState(next);
  return next;
}

export function deletePlaylist(state, playlistId) {
  if (!state.playlists.some((item) => item.id === playlistId)) throw new Error('Choose an existing playlist.');
  const next = { ...state, playlists: state.playlists.filter((item) => item.id !== playlistId) };
  validateState(next);
  return next;
}

export function playSong(state, songId) {
  if (!songById.has(songId)) throw new Error('Choose an existing song.');
  return { ...state, playingSongId: songId };
}

export function pauseSong(state) {
  return { ...state, playingSongId: null };
}
