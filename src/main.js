import {
  artists, songs, artistById, songById,
  createInitialState, restoreState, playlistSongCount,
  createPlaylist, addSongToPlaylist, removeSongFromPlaylist,
  deletePlaylist, playSong, pauseSong,
} from './model.js';

const storageKey = 'echo-atlas-playlists-v1';
const $ = (selector) => document.querySelector(selector);
const detailContent = $('#detail-content');
const dialog = $('#action-dialog');
const dialogFields = $('#dialog-fields');
const dialogError = $('#dialog-error');
const submitButton = $('#submit-dialog');
let state = readState();
let selection = { type: 'song', id: 'afterglow' };
let activeAction = null;
let toastTimer;
let lastPlayedSongId = null;
let playbackElapsed = 0;
let playbackStartedAt = 0;
let audioContext = null;
let noteTimer = null;
let noteIndex = 0;
let activeVoices = new Set();
let previewGeneration = 0;
let graph = null;

function readState() {
  try {
    const saved = JSON.parse(localStorage.getItem(storageKey));
    return saved ? restoreState(saved) : createInitialState();
  } catch {
    return createInitialState();
  }
}

function saveState() {
  try { localStorage.setItem(storageKey, JSON.stringify({ playlists: state.playlists })); } catch { /* Private browsing can disable storage. */ }
}

function element(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function formatDuration(seconds) {
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;
}

function showToast(message) {
  const toast = $('#toast');
  toast.textContent = message;
  toast.classList.add('visible');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toast.classList.remove('visible'), 3000);
}

function selectEntity(type, id) {
  if (type === 'artist' && !artistById.has(id)) return;
  if (type === 'song' && !songById.has(id)) return;
  if (type === 'playlist' && !state.playlists.some((playlist) => playlist.id === id)) return;
  selection = { type, id };
  renderDetails();
  graph?.focusSelection();
  graph?.ensureSelectionVisible();
}

function detailLink(type, id, name) {
  const li = element('li');
  const button = element('button', 'detail-link');
  button.type = 'button';
  button.dataset.entity = type;
  button.dataset.id = id;
  button.append(element('span', 'link-bullet'), element('span', '', name), element('span', 'link-arrow', '↗'));
  li.append(button);
  return li;
}

function addAttributes(container, attributes) {
  const dl = element('dl', 'attribute-list');
  for (const [label, value] of attributes) {
    const wrapper = element('div');
    wrapper.append(element('dt', '', label), element('dd', '', String(value)));
    dl.append(wrapper);
  }
  container.append(dl);
}

function addSection(container, title, count, content) {
  const section = element('section', 'inspector-section');
  const heading = element('div', 'inspector-section-title');
  heading.append(element('span', '', title), element('span', '', count));
  section.append(heading, content);
  container.append(section);
}

function addFootnote(container, text) {
  const note = element('div', 'inspector-footnote');
  note.append(element('strong', '', '✦'), element('span', '', text));
  container.append(note);
}

function renderDetails() {
  detailContent.replaceChildren();
  const head = element('div', 'entity-head');
  const kind = element('span', `entity-type ${selection.type}`, selection.type);
  head.append(kind);
  detailContent.append(head);

  if (selection.type === 'artist') {
    const artist = artistById.get(selection.id);
    if (!artist) return;
    head.append(element('h2', 'entity-title', artist.name), element('div', 'entity-subtitle', 'An artist in the collection'));
    const attributes = element('div');
    addAttributes(attributes, [['Name', artist.name], ['Genre', artist.genre]]);
    addSection(detailContent, 'ATTRIBUTES', '02', attributes);
    const ownedSongs = songs.filter((song) => song.artistId === artist.id);
    const list = element('ul', 'relationship-list');
    ownedSongs.forEach((song) => list.append(detailLink('song', song.id, song.title)));
    addSection(detailContent, 'SONGS BY THIS ARTIST', String(ownedSongs.length).padStart(2, '0'), list);
    addFootnote(detailContent, 'Every song belongs to exactly one artist.');
  } else if (selection.type === 'song') {
    const song = songById.get(selection.id);
    if (!song) return;
    const artist = artistById.get(song.artistId);
    head.append(element('h2', 'entity-title', song.title), element('div', 'entity-subtitle', `by ${artist.name}`));
    const attributes = element('div');
    addAttributes(attributes, [
      ['Title', song.title],
      ['Duration', `${song.duration} sec · ${formatDuration(song.duration)}`],
      ['Release year', song.releaseYear],
      ['Genre', song.genre],
    ]);
    addSection(detailContent, 'ATTRIBUTES', '04', attributes);
    const artistList = element('ul', 'relationship-list');
    artistList.append(detailLink('artist', artist.id, artist.name));
    addSection(detailContent, 'ARTIST', '01', artistList);
    const memberships = state.playlists.filter((playlist) => playlist.songIds.includes(song.id));
    const list = element('ul', 'relationship-list');
    memberships.forEach((playlist) => list.append(detailLink('playlist', playlist.id, playlist.name)));
    if (!memberships.length) list.append(element('li', 'empty-relation', 'Not in a playlist yet.'));
    addSection(detailContent, 'IN PLAYLISTS', String(memberships.length).padStart(2, '0'), list);
    addFootnote(detailContent, 'A song can appear in several playlists, once in each.');
  } else {
    const playlist = state.playlists.find((item) => item.id === selection.id);
    if (!playlist) return;
    head.append(element('h2', 'entity-title', playlist.name), element('div', 'entity-subtitle', 'A curated selection of songs'));
    const attributes = element('div');
    addAttributes(attributes, [['Name', playlist.name], ['Number of songs', playlistSongCount(playlist)]]);
    addSection(detailContent, 'ATTRIBUTES', '02', attributes);
    const list = element('ul', 'relationship-list');
    playlist.songIds.forEach((songId) => list.append(detailLink('song', songId, songById.get(songId).title)));
    if (!playlist.songIds.length) list.append(element('li', 'empty-relation', 'This playlist is empty. Add a song to begin.'));
    addSection(detailContent, 'SONGS IN THIS PLAYLIST', String(playlistSongCount(playlist)).padStart(2, '0'), list);
    addFootnote(detailContent, 'Deleting a playlist leaves all its songs and artists in the collection.');
  }
}

function renderPlayback() {
  const playing = state.playingSongId ? songById.get(state.playingSongId) : null;
  const paused = !playing && lastPlayedSongId ? songById.get(lastPlayedSongId) : null;
  const current = playing || paused;
  $('#record-icon').classList.toggle('playing', !!playing);
  $('#playback-bars').classList.toggle('active', !!playing);
  $('#pause-song').disabled = !playing;
  $('#playback-status').textContent = playing ? 'PLAYING · SYNTH PREVIEW' : paused ? 'PAUSED' : 'NOT PLAYING';
  $('#playback-title').textContent = current?.title || 'Select a song to play';
  $('#playback-artist').textContent = current ? artistById.get(current.artistId).name : 'A little sound for your journey';
}

function renderCounts() {
  $('#artist-count').textContent = artists.length;
  $('#song-count').textContent = songs.length;
  $('#playlist-count').textContent = state.playlists.length;
}

function render() {
  renderCounts();
  renderDetails();
  renderPlayback();
  graph?.rebuild();
}

function makeField(id, label, kind = 'select') {
  const wrapper = element('div', 'dialog-field');
  const labelNode = element('label', '', label);
  labelNode.htmlFor = id;
  const control = element(kind);
  control.id = id;
  control.name = id;
  wrapper.append(labelNode, control);
  dialogFields.append(wrapper);
  return control;
}

function setOptions(select, options, preferred) {
  select.replaceChildren();
  for (const option of options) {
    const node = element('option', '', option.label);
    node.value = option.value;
    select.append(node);
  }
  select.disabled = !options.length;
  if (options.some((option) => option.value === preferred)) select.value = preferred;
}

function availableSongs(playlistId, mode) {
  const playlist = state.playlists.find((item) => item.id === playlistId);
  if (!playlist) return [];
  return songs.filter((song) => mode === 'add' ? !playlist.songIds.includes(song.id) : playlist.songIds.includes(song.id));
}

function openDialog(action) {
  activeAction = action;
  dialogFields.replaceChildren();
  dialogError.textContent = '';
  submitButton.classList.toggle('danger', action === 'delete');
  submitButton.disabled = false;
  const config = {
    create: ['Create a playlist', 'Give your new playlist a name. It will start empty.', 'Create playlist'],
    add: ['Add a song', 'Choose a song that is not already in this playlist.', 'Add song'],
    remove: ['Remove a song', 'Only songs currently in the selected playlist are available.', 'Remove song'],
    delete: ['Delete a playlist', 'The playlist will disappear. Its songs and artists will stay in the collection.', 'Delete playlist'],
    play: ['Play a song', 'Listen to a short generated preview while exploring its connections.', 'Play song'],
  }[action];
  $('#dialog-title').textContent = config[0];
  $('#dialog-description').textContent = config[1];
  submitButton.textContent = config[2];

  if (action === 'create') {
    const input = makeField('playlist-name', 'Playlist name', 'input');
    input.type = 'text';
    input.placeholder = 'e.g. Sunday morning';
    input.maxLength = 36;
    input.required = true;
  } else if (action === 'add' || action === 'remove') {
    const playlistSelect = makeField('playlist-select', 'Playlist');
    const preferredPlaylistId = selection.type === 'playlist'
      ? selection.id
      : state.playlists.find((item) => selection.type === 'song' && item.songIds.includes(selection.id))?.id;
    setOptions(playlistSelect, state.playlists.map((playlist) => ({ value: playlist.id, label: `${playlist.name} · ${playlistSongCount(playlist)} songs` })), preferredPlaylistId);
    const songSelect = makeField('song-select', 'Song');
    const updateSongs = () => {
      const choices = availableSongs(playlistSelect.value, action).map((song) => ({ value: song.id, label: `${song.title} — ${artistById.get(song.artistId).name}` }));
      setOptions(songSelect, choices, selection.type === 'song' ? selection.id : songSelect.value);
      submitButton.disabled = !choices.length;
      dialogError.textContent = !state.playlists.length
        ? 'Create a playlist first.'
        : !choices.length ? action === 'add' ? 'This playlist already contains every song.' : 'This playlist has no songs to remove.' : '';
    };
    playlistSelect.addEventListener('change', updateSongs);
    updateSongs();
  } else if (action === 'delete') {
    const playlistSelect = makeField('playlist-select', 'Playlist');
    setOptions(playlistSelect, state.playlists.map((playlist) => ({ value: playlist.id, label: `${playlist.name} · ${playlistSongCount(playlist)} songs` })), selection.type === 'playlist' ? selection.id : null);
    if (!state.playlists.length) {
      submitButton.disabled = true;
      dialogError.textContent = 'There are no playlists to delete.';
    }
  } else if (action === 'play') {
    const songSelect = makeField('song-select', 'Song');
    setOptions(songSelect, songs.map((song) => ({ value: song.id, label: `${song.title} — ${artistById.get(song.artistId).name}` })), selection.type === 'song' ? selection.id : null);
  }

  dialog.showModal();
  requestAnimationFrame(() => (dialog.querySelector('input, select') || submitButton).focus());
}

function newPlaylistId() {
  return `playlist-${globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random().toString(36).slice(2)}`}`;
}

function stopPreview() {
  previewGeneration += 1;
  if (noteTimer) clearInterval(noteTimer);
  noteTimer = null;
  for (const voice of activeVoices) {
    try { voice.stop(); } catch { /* A scheduled note may already have ended. */ }
  }
  activeVoices.clear();
}

function scheduleNote(songId) {
  if (!audioContext || audioContext.state !== 'running') return;
  const song = songById.get(songId);
  const songIndex = songs.findIndex((item) => item.id === songId);
  const motifs = {
    Electronic: [0, 7, 12, 7, 3, 7, 10, 7],
    Ambient: [0, 5, 7, 12, 7, 5, 3, 5],
    'Indie Pop': [0, 4, 7, 11, 7, 4, 2, 7],
    Jazz: [0, 3, 7, 10, 5, 9, 7, 3],
  };
  const semitones = motifs[song.genre][noteIndex++ % 8];
  const frequency = (164.81 + songIndex * 10) * (2 ** (semitones / 12));
  const now = audioContext.currentTime;
  const oscillator = audioContext.createOscillator();
  const gain = audioContext.createGain();
  oscillator.type = song.genre === 'Jazz' ? 'triangle' : 'sine';
  oscillator.frequency.setValueAtTime(frequency, now);
  gain.gain.setValueAtTime(.0001, now);
  gain.gain.exponentialRampToValueAtTime(.035, now + .035);
  gain.gain.exponentialRampToValueAtTime(.0001, now + .31);
  oscillator.connect(gain).connect(audioContext.destination);
  oscillator.onended = () => { activeVoices.delete(oscillator); oscillator.disconnect(); gain.disconnect(); };
  activeVoices.add(oscillator);
  oscillator.start(now);
  oscillator.stop(now + .32);
}

async function startPreview(songId) {
  stopPreview();
  const generation = previewGeneration;
  try {
    audioContext ||= new (window.AudioContext || window.webkitAudioContext)();
    await audioContext.resume();
    if (state.playingSongId !== songId || generation !== previewGeneration) return;
    noteIndex = 0;
    scheduleNote(songId);
    noteTimer = setInterval(() => scheduleNote(songId), 370);
  } catch {
    showToast('Preview audio is unavailable in this browser.');
  }
}

function startSong(songId) {
  if (lastPlayedSongId !== songId) playbackElapsed = 0;
  lastPlayedSongId = songId;
  playbackStartedAt = performance.now() - playbackElapsed * 1000;
  state = playSong(state, songId);
  selectEntity('song', songId);
  renderPlayback();
  graph?.focusSelection();
  startPreview(songId);
  showToast(`Playing ${songById.get(songId).title}`);
}

function pauseCurrent(showMessage = true) {
  if (!state.playingSongId) return;
  playbackElapsed = (performance.now() - playbackStartedAt) / 1000;
  state = pauseSong(state);
  stopPreview();
  renderPlayback();
  graph?.focusSelection();
  if (showMessage) showToast('Playback paused');
}

function handleSubmit(event) {
  event.preventDefault();
  try {
    if (activeAction === 'create') {
      const name = $('#playlist-name').value;
      const id = newPlaylistId();
      state = createPlaylist(state, name, id);
      saveState();
      selectEntity('playlist', id);
      showToast(`Created ${name.trim()}`);
    } else if (activeAction === 'add') {
      const playlistId = $('#playlist-select').value;
      const songId = $('#song-select').value;
      state = addSongToPlaylist(state, playlistId, songId);
      saveState();
      selectEntity('playlist', playlistId);
      showToast(`Added ${songById.get(songId).title}`);
    } else if (activeAction === 'remove') {
      const playlistId = $('#playlist-select').value;
      const songId = $('#song-select').value;
      state = removeSongFromPlaylist(state, playlistId, songId);
      saveState();
      selectEntity('playlist', playlistId);
      showToast(`Removed ${songById.get(songId).title}`);
    } else if (activeAction === 'delete') {
      const playlistId = $('#playlist-select').value;
      const playlistName = state.playlists.find((item) => item.id === playlistId).name;
      state = deletePlaylist(state, playlistId);
      saveState();
      if (selection.type === 'playlist' && selection.id === playlistId) selection = { type: 'song', id: 'afterglow' };
      showToast(`Deleted ${playlistName}. Its songs remain.`);
    } else if (activeAction === 'play') {
      startSong($('#song-select').value);
    }
    dialog.close();
    render();
    graph?.ensureSelectionVisible();
  } catch (error) {
    dialogError.textContent = error.message;
  }
}

$('#action-form').addEventListener('submit', handleSubmit);
$('#close-dialog').addEventListener('click', () => dialog.close());
$('#cancel-dialog').addEventListener('click', () => dialog.close());
$('#create-playlist').addEventListener('click', () => openDialog('create'));
$('#add-song').addEventListener('click', () => openDialog('add'));
$('#remove-song').addEventListener('click', () => openDialog('remove'));
$('#delete-playlist').addEventListener('click', () => openDialog('delete'));
$('#play-song').addEventListener('click', () => selection.type === 'song' ? startSong(selection.id) : openDialog('play'));
$('#pause-song').addEventListener('click', () => pauseCurrent());
$('#reset-demo').addEventListener('click', () => {
  if (!window.confirm('Restore the original sample playlists? Your playlist changes will be lost.')) return;
  pauseCurrent(false);
  state = createInitialState();
  lastPlayedSongId = null;
  playbackElapsed = 0;
  selection = { type: 'song', id: 'afterglow' };
  saveState();
  graph?.resetView();
  render();
  showToast('Demo collection restored');
});
detailContent.addEventListener('click', (event) => {
  const link = event.target.closest('button[data-entity]');
  if (link) selectEntity(link.dataset.entity, link.dataset.id);
});

render();

async function createGraph() {
  let THREE;
  try {
    THREE = await import('three');
  } catch (error) {
    console.error('Could not load Three.js:', error);
    $('#scene-fallback').hidden = false;
    return null;
  }

  const canvas = $('#scene');
  let renderer;
  try {
    renderer = new THREE.WebGLRenderer({ canvas, alpha: true, antialias: true, powerPreference: 'high-performance' });
  } catch (error) {
    console.error('Could not initialize WebGL:', error);
    $('#scene-fallback').hidden = false;
    return null;
  }
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  const scene = new THREE.Scene();
  const camera = new THREE.OrthographicCamera(-9, 9, 9, -9, .1, 100);
  camera.position.set(0, 0, 25);
  camera.lookAt(0, 0, 0);
  scene.add(new THREE.AmbientLight(0xffffff, 1.35));
  const keyLight = new THREE.PointLight(0xb8d8ff, 24, 30);
  keyLight.position.set(-4, 5, 12);
  scene.add(keyLight);
  const warmLight = new THREE.PointLight(0xffc084, 16, 20);
  warmLight.position.set(7, -3, 8);
  scene.add(warmLight);

  const graphGroup = new THREE.Group();
  scene.add(graphGroup);
  const decorationGroup = new THREE.Group();
  scene.add(decorationGroup);
  const picks = [];
  const nodeParts = [];
  const edgeParts = [];
  let glowTexture;
  let targetX = 0;
  let targetY = 0;
  let targetZoom = 1;
  let dragging = false;
  let moved = false;
  let pointerStart = null;
  let lastTime = 0;
  let verticalPanLimit = 5;

  function radialTexture() {
    const surface = document.createElement('canvas');
    surface.width = surface.height = 128;
    const context = surface.getContext('2d');
    const gradient = context.createRadialGradient(64,64,0,64,64,64);
    gradient.addColorStop(0, 'rgba(255,255,255,.6)');
    gradient.addColorStop(.24, 'rgba(255,255,255,.3)');
    gradient.addColorStop(1, 'rgba(255,255,255,0)');
    context.fillStyle = gradient;
    context.fillRect(0,0,128,128);
    return new THREE.CanvasTexture(surface);
  }
  glowTexture = radialTexture();

  function textSprite(text, color, scale) {
    const surface = document.createElement('canvas');
    surface.width = 512;
    surface.height = 96;
    const context = surface.getContext('2d');
    context.clearRect(0, 0, 512, 96);
    context.font = '600 38px Space Grotesk, sans-serif';
    context.textAlign = 'center';
    context.textBaseline = 'middle';
    context.shadowColor = '#050a13';
    context.shadowBlur = 8;
    context.fillStyle = color;
    context.fillText(text, 256, 48, 492);
    const texture = new THREE.CanvasTexture(surface);
    texture.colorSpace = THREE.SRGBColorSpace;
    const material = new THREE.SpriteMaterial({ map: texture, transparent: true, depthTest: false });
    const sprite = new THREE.Sprite(material);
    sprite.scale.set(scale, scale * 96 / 512, 1);
    sprite.renderOrder = 10;
    return sprite;
  }

  function addParticles() {
    const coordinates = [];
    let seed = 127;
    const random = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
    for (let i = 0; i < 170; i++) {
      coordinates.push((random() - .5) * 33, (random() - .5) * 19, -4 - random() * 2);
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(coordinates, 3));
    const points = new THREE.Points(geometry, new THREE.PointsMaterial({ color: 0x7a9bbd, size: .035, transparent: true, opacity: .56, depthWrite: false }));
    decorationGroup.add(points);
    for (const radius of [3.4, 6.7, 9.5]) {
      const ring = new THREE.Mesh(
        new THREE.RingGeometry(radius, radius + .008, 96),
        new THREE.MeshBasicMaterial({ color: 0x66809e, transparent: true, opacity: .035, side: THREE.DoubleSide, depthWrite: false }),
      );
      ring.position.z = -3.5;
      decorationGroup.add(ring);
    }
  }
  addParticles();

  function positions() {
    const mobile = window.innerWidth <= 700;
    const compact = window.innerWidth <= 990;
    const artistX = mobile ? -2.7 : compact ? -3.1 : -5.3;
    const playlistX = mobile ? 2.7 : compact ? 3.1 : 5.3;
    const artistYs = mobile ? [3.9, 2.4, .9] : compact ? [2.45, -.3, -3.05] : [4.35, 0, -4.35];
    const playlistYs = mobile ? [3.9, 2.4, .9] : compact ? [2.45, -.3, -3.05] : [4.35, 0, -4.35];
    const songYs = mobile ? songs.map((_, index) => 4.55 - index * .64) : compact ? songs.map((_, index) => 2.8 - index * .98) : songs.map((_, index) => 5.25 - index * 1.5);
    return { mobile, artistX, playlistX, artistYs, playlistYs, songYs };
  }

  function addEdge(start, end, side, from, to) {
    const middle = new THREE.Vector3((start.x + end.x) / 2, (start.y + end.y) / 2 + (side === 'artist' ? -.15 : .15), -.95);
    const curve = new THREE.QuadraticBezierCurve3(
      new THREE.Vector3(start.x, start.y, -.85),
      middle,
      new THREE.Vector3(end.x, end.y, -.85),
    );
    const material = new THREE.MeshBasicMaterial({ color: side === 'artist' ? 0x9b80db : 0xe0a76d, transparent: true, opacity: .2, depthWrite: false });
    const edge = new THREE.Mesh(new THREE.TubeGeometry(curve, 22, .011, 4, false), material);
    graphGroup.add(edge);
    edgeParts.push({ mesh: edge, from, to });
  }

  function addNode(type, id, name, x, y, mobile) {
    const group = new THREE.Group();
    group.position.set(x, y, 0);
    const color = type === 'artist' ? 0xc197ff : type === 'song' ? 0x8be9df : 0xffc47c;
    const radius = mobile ? type === 'song' ? .12 : .22 : type === 'song' ? .23 : .38;
    const geometry = type === 'artist'
      ? new THREE.OctahedronGeometry(radius, 0)
      : type === 'playlist' ? new THREE.IcosahedronGeometry(radius, 0) : new THREE.SphereGeometry(radius, 20, 16);
    const material = new THREE.MeshStandardMaterial({ color, emissive: color, emissiveIntensity: .48, metalness: .18, roughness: .26, transparent: true, opacity: .98 });
    const core = new THREE.Mesh(geometry, material);
    core.userData.entity = { type, id };
    group.add(core);
    const hitArea = new THREE.Mesh(
      new THREE.SphereGeometry(mobile ? .29 : .43, 10, 8),
      new THREE.MeshBasicMaterial({ transparent: true, opacity: 0, depthWrite: false }),
    );
    hitArea.userData.entity = { type, id };
    group.add(hitArea);
    picks.push(hitArea);
    const halo = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTexture, color, transparent: true, opacity: .48, blending: THREE.AdditiveBlending, depthWrite: false, depthTest: false }));
    halo.scale.set(radius * 6.2, radius * 6.2, 1);
    halo.position.z = -.3;
    group.add(halo);
    const ring = new THREE.Mesh(
      new THREE.TorusGeometry(radius * 1.55, .008, 5, 40),
      new THREE.MeshBasicMaterial({ color, transparent: true, opacity: .46, depthWrite: false }),
    );
    ring.rotation.x = type === 'artist' ? .35 : type === 'playlist' ? -.38 : 0;
    group.add(ring);
    const label = textSprite(name, type === 'song' ? '#cfebed' : '#edf0f9', mobile ? 1.35 : type === 'song' ? 2.9 : 3.1);
    label.position.set(0, -(radius + (mobile ? .19 : .35)), .2);
    group.add(label);
    group.userData.baseY = y;
    graphGroup.add(group);
    nodeParts.push({ group, core, halo, ring, label, type, id, radius });
  }

  function disposeGraph() {
    graphGroup.traverse((object) => {
      object.geometry?.dispose();
      if (object.material) {
        const materials = Array.isArray(object.material) ? object.material : [object.material];
        materials.forEach((material) => {
          if (material.map && material.map !== glowTexture) material.map.dispose();
          material.dispose();
        });
      }
    });
    graphGroup.clear();
    picks.length = 0;
    nodeParts.length = 0;
    edgeParts.length = 0;
  }

  function rebuild() {
    disposeGraph();
    const layout = positions();
    const artistLocations = new Map(artists.map((artist, index) => [artist.id, { x: layout.artistX, y: layout.artistYs[index] }]));
    const songLocations = new Map(songs.map((song, index) => [song.id, { x: 0, y: layout.songYs[index] }]));
    const playlistLocations = new Map(state.playlists.map((playlist, index) => {
      const spread = layout.mobile ? .83 : window.innerWidth <= 990 ? 1.08 : 1.65;
      const centered = (state.playlists.length - 1) / 2 - index;
      const y = state.playlists.length === 3 ? layout.playlistYs[index] : (layout.mobile ? 2.4 : window.innerWidth <= 990 ? -.3 : 0) + centered * spread;
      return [playlist.id, { x: layout.playlistX, y }];
    }));
    verticalPanLimit = Math.max(5, ...[...playlistLocations.values()].map((location) => Math.abs(location.y) + 1));

    for (const song of songs) {
      addEdge(artistLocations.get(song.artistId), songLocations.get(song.id), 'artist', `artist:${song.artistId}`, `song:${song.id}`);
    }
    for (const playlist of state.playlists) {
      for (const songId of playlist.songIds) {
        addEdge(songLocations.get(songId), playlistLocations.get(playlist.id), 'playlist', `song:${songId}`, `playlist:${playlist.id}`);
      }
    }
    artists.forEach((artist) => addNode('artist', artist.id, artist.name, artistLocations.get(artist.id).x, artistLocations.get(artist.id).y, layout.mobile));
    songs.forEach((song) => addNode('song', song.id, song.title, songLocations.get(song.id).x, songLocations.get(song.id).y, layout.mobile));
    state.playlists.forEach((playlist) => addNode('playlist', playlist.id, playlist.name, playlistLocations.get(playlist.id).x, playlistLocations.get(playlist.id).y, layout.mobile));
    focusSelection();
  }

  function focusSelection() {
    const selectedKey = `${selection.type}:${selection.id}`;
    const related = new Set([selectedKey]);
    if (selection.type === 'artist') songs.filter((song) => song.artistId === selection.id).forEach((song) => related.add(`song:${song.id}`));
    if (selection.type === 'song') {
      const song = songById.get(selection.id);
      related.add(`artist:${song.artistId}`);
      state.playlists.filter((playlist) => playlist.songIds.includes(song.id)).forEach((playlist) => related.add(`playlist:${playlist.id}`));
    }
    if (selection.type === 'playlist') {
      state.playlists.find((playlist) => playlist.id === selection.id)?.songIds.forEach((id) => related.add(`song:${id}`));
    }
    for (const node of nodeParts) {
      const key = `${node.type}:${node.id}`;
      const selected = key === selectedKey;
      const connected = related.has(key);
      node.group.scale.setScalar(selected ? 1.18 : 1);
      node.core.material.opacity = connected ? 1 : .36;
      node.core.material.emissiveIntensity = selected ? .95 : connected ? .5 : .22;
      node.halo.material.opacity = selected ? .9 : connected ? .5 : .14;
      node.ring.material.opacity = selected ? .85 : connected ? .43 : .13;
      node.label.material.opacity = connected ? 1 : .52;
    }
    for (const edge of edgeParts) {
      edge.mesh.material.opacity = edge.from === selectedKey || edge.to === selectedKey ? .75 : .12;
    }
  }

  function ensureSelectionVisible() {
    const node = nodeParts.find((part) => part.type === selection.type && part.id === selection.id);
    if (node && Math.abs(node.group.position.y - targetY) > 5 / targetZoom) {
      targetY = Math.max(-verticalPanLimit, Math.min(verticalPanLimit, node.group.position.y));
    }
  }

  function resize() {
    const width = window.innerWidth;
    const height = window.innerHeight;
    const aspect = width / height;
    camera.left = -9 * aspect;
    camera.right = 9 * aspect;
    camera.top = 9;
    camera.bottom = -9;
    camera.updateProjectionMatrix();
    renderer.setSize(width, height, false);
    rebuild();
  }

  const raycaster = new THREE.Raycaster();
  const pointer = new THREE.Vector2();
  function pick(event) {
    pointer.x = event.clientX / window.innerWidth * 2 - 1;
    pointer.y = -(event.clientY / window.innerHeight) * 2 + 1;
    raycaster.setFromCamera(pointer, camera);
    return raycaster.intersectObjects(picks, false)[0]?.object?.userData.entity;
  }

  canvas.addEventListener('pointerdown', (event) => {
    if (event.button !== 0) return;
    pointerStart = { x: event.clientX, y: event.clientY, targetX, targetY };
    dragging = true;
    moved = false;
    canvas.setPointerCapture(event.pointerId);
  });
  canvas.addEventListener('pointermove', (event) => {
    if (dragging && pointerStart) {
      const dx = event.clientX - pointerStart.x;
      const dy = event.clientY - pointerStart.y;
      if (Math.abs(dx) + Math.abs(dy) > 5) moved = true;
      if (moved) {
        const unitsPerPixel = 18 / (window.innerHeight * camera.zoom);
        targetX = Math.max(-5, Math.min(5, pointerStart.targetX - dx * unitsPerPixel));
        targetY = Math.max(-verticalPanLimit, Math.min(verticalPanLimit, pointerStart.targetY + dy * unitsPerPixel));
      }
    } else {
      canvas.style.cursor = pick(event) ? 'pointer' : 'grab';
    }
  });
  canvas.addEventListener('pointerup', (event) => {
    if (!dragging) return;
    dragging = false;
    if (!moved) {
      const hit = pick(event);
      if (hit) selectEntity(hit.type, hit.id);
    }
    pointerStart = null;
  });
  canvas.addEventListener('pointercancel', () => { dragging = false; pointerStart = null; });
  canvas.addEventListener('wheel', (event) => {
    event.preventDefault();
    targetZoom = Math.max(.7, Math.min(2.2, targetZoom * (event.deltaY > 0 ? .92 : 1.08)));
  }, { passive: false });

  function resetView() { targetX = 0; targetY = 0; targetZoom = 1; }

  function animate(time) {
    requestAnimationFrame(animate);
    const dt = Math.min((time - lastTime) / 1000 || .016, .05);
    lastTime = time;
    camera.position.x += (targetX - camera.position.x) * Math.min(dt * 9, 1);
    camera.position.y += (targetY - camera.position.y) * Math.min(dt * 9, 1);
    camera.zoom += (targetZoom - camera.zoom) * Math.min(dt * 9, 1);
    camera.updateProjectionMatrix();
    const seconds = time * .001;
    for (const node of nodeParts) {
      node.core.rotation.y += dt * (node.type === 'song' ? .4 : .7);
      node.ring.rotation.z += dt * (node.type === 'artist' ? .24 : -.16);
      node.halo.scale.setScalar(node.radius * (6.2 + .15 * Math.sin(seconds * 2 + node.group.position.x)));
    }
    if (state.playingSongId) {
      const song = songById.get(state.playingSongId);
      if ((time - playbackStartedAt) / 1000 >= song.duration) {
        pauseCurrent(false);
        playbackElapsed = 0;
        lastPlayedSongId = null;
        renderPlayback();
        showToast(`${song.title} finished`);
      }
    }
    renderer.render(scene, camera);
  }

  window.addEventListener('resize', resize);
  resize();
  requestAnimationFrame(animate);
  return { rebuild, focusSelection, resetView, ensureSelectionVisible };
}

graph = await createGraph();
