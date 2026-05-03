'use strict';

// ── Storage ───────────────────────────────────────────
const DB = {
  KEY: 'beatref-songs',

  getAll() {
    try { return JSON.parse(localStorage.getItem(this.KEY) || '[]'); }
    catch { return []; }
  },

  save(song) {
    const songs = this.getAll();
    const idx = songs.findIndex(s => s.id === song.id);
    if (idx >= 0) songs[idx] = song;
    else songs.push(song);
    localStorage.setItem(this.KEY, JSON.stringify(songs));
  },

  delete(id) {
    const songs = this.getAll().filter(s => s.id !== id);
    localStorage.setItem(this.KEY, JSON.stringify(songs));
  }
};

// ── YouTube helpers ───────────────────────────────────
function parseYTUrl(url) {
  if (!url) return { id: null, start: 0 };
  const idMatch = url.match(
    /(?:youtu\.be\/|youtube\.com\/(?:watch\?(?:.*&)?v=|(?:embed|v|shorts)\/))([A-Za-z0-9_-]{11})/
  );
  if (!idMatch) return { id: null, start: 0 };
  const id = idMatch[1];

  // Parse ?t= (seconds integer or h/m/s composite like 1h30m15s)
  const tMatch = url.match(/[?&]t=([^&]+)/);
  let start = 0;
  if (tMatch) {
    const t = tMatch[1];
    const hms = t.match(/^(?:(\d+)h)?(?:(\d+)m)?(\d+)s?$/);
    if (hms) {
      start = (parseInt(hms[1] || 0) * 3600)
             + (parseInt(hms[2] || 0) * 60)
             + parseInt(hms[3] || 0);
    } else {
      start = parseInt(t) || 0;
    }
  }
  return { id, start };
}

// Kept for backward-compat use in card rendering
function extractYTId(url) { return parseYTUrl(url).id; }

function ytEmbedUrl(id, start = 0) {
  const s = start > 0 ? `&start=${start}` : '';
  return `https://www.youtube.com/embed/${id}?rel=0${s}`;
}

// ── Precise Metronome (Web Audio API) ─────────────────
class Metronome {
  constructor(onBeat) {
    this.onBeat = onBeat;
    this.bpm = 120;
    this.isPlaying = false;
    this._ctx = null;
    this._nextTime = 0;
    this._timerId = null;
    this._LOOKAHEAD = 25;      // ms – how often scheduler runs
    this._SCHEDULE_AHEAD = 0.12; // s – how far ahead to schedule
  }

  setBpm(bpm) {
    this.bpm = Math.max(20, Math.min(300, bpm));
  }

  start() {
    if (this.isPlaying) return;
    this._ctx = new (window.AudioContext || window.webkitAudioContext)();
    this._nextTime = this._ctx.currentTime + 0.05;
    this.isPlaying = true;
    this._schedule();
  }

  stop() {
    this.isPlaying = false;
    clearTimeout(this._timerId);
    if (this._ctx) {
      this._ctx.close().catch(() => {});
      this._ctx = null;
    }
  }

  _schedule() {
    while (this._nextTime < this._ctx.currentTime + this._SCHEDULE_AHEAD) {
      this._click(this._nextTime);
      this._nextTime += 60 / this.bpm;
    }
    this._timerId = setTimeout(() => {
      if (this.isPlaying) this._schedule();
    }, this._LOOKAHEAD);
  }

  _click(time) {
    const ctx = this._ctx;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.frequency.value = 1047; // C6
    gain.gain.setValueAtTime(0.9, time);
    gain.gain.exponentialRampToValueAtTime(0.001, time + 0.06);
    osc.start(time);
    osc.stop(time + 0.07);

    // Notify UI at the right moment
    const delay = Math.max(0, (time - ctx.currentTime) * 1000 - 10);
    setTimeout(() => this.onBeat(), delay);
  }
}

// ── Tap Tempo ─────────────────────────────────────────
class TapTempo {
  constructor(onUpdate) {
    this.onUpdate = onUpdate;
    this._taps = [];
    this._timer = null;
  }

  tap() {
    const now = performance.now();
    clearTimeout(this._timer);
    this._timer = setTimeout(() => this.reset(), 2000);

    this._taps.push(now);
    if (this._taps.length > 8) this._taps.shift();

    if (this._taps.length < 2) return null;

    const intervals = [];
    for (let i = 1; i < this._taps.length; i++) {
      intervals.push(this._taps[i] - this._taps[i - 1]);
    }
    const avgMs = intervals.reduce((a, b) => a + b, 0) / intervals.length;
    const bpm = Math.round(60000 / avgMs);
    this.onUpdate(bpm, this._taps.length);
    return bpm;
  }

  reset() {
    this._taps = [];
    this.onUpdate(null, 0);
  }
}

// ── BPM descriptive hint ──────────────────────────────
function bpmHint(bpm) {
  if (bpm < 60)  return 'Largo – very slow';
  if (bpm < 72)  return 'Adagio – slow and stately';
  if (bpm < 84)  return 'Andante – walking pace';
  if (bpm < 96)  return 'Moderato – moderate';
  if (bpm < 108) return 'Allegretto – moderately fast';
  if (bpm < 132) return 'Allegro – fast';
  if (bpm < 156) return 'Vivace – lively and fast';
  if (bpm < 176) return 'Presto – very fast';
  return 'Prestissimo – extremely fast';
}

// ── App State ─────────────────────────────────────────
const state = {
  songs: [],
  filter: { query: '', bpmMin: null, bpmMax: null, sort: 'bpm-asc' },
  playerSongId: null,
  editSongId: null,    // null = new song
  metronome: null,
  beatRing: null,
  tapTempo: null,
  tapDetectedBpm: null,
};

// ── Seed data ─────────────────────────────────────────
const SEED_SONGS = [
  {
    id: 'seed-1',
    title: "Stayin' Alive",
    artist: 'Bee Gees',
    bpm: 100,
    youtube: 'https://www.youtube.com/watch?v=I_izvAbhExY',
    notes: 'Famous for matching the ideal CPR chest compression rate.',
    createdAt: 0,
  },
  {
    id: 'seed-2',
    title: "We're Off to See the Wizard",
    artist: 'Judy Garland',
    bpm: 138,
    youtube: 'https://youtu.be/Mm3ypbAbLJ8?si=-LAm9gqbiUIFBBP-&t=2',
    youtubeStart: 2,
    notes: '',
    createdAt: 1,
  },
  {
    id: 'seed-3',
    title: 'Eye of the Tiger',
    artist: 'Survivor',
    bpm: 109,
    youtube: 'https://www.youtube.com/watch?v=btPJPFnesV4',
    notes: '',
    createdAt: 2,
  },
  {
    id: 'seed-4',
    title: 'Billie Jean',
    artist: 'Michael Jackson',
    bpm: 117,
    youtube: 'https://www.youtube.com/watch?v=Zi_XLOBDo_Y',
    notes: '',
    createdAt: 3,
  },
  {
    id: 'seed-5',
    title: 'Mr. Brightside',
    artist: 'The Killers',
    bpm: 148,
    youtube: 'https://www.youtube.com/watch?v=gGdGFtwCNBE',
    notes: '',
    createdAt: 4,
  },
  {
    id: 'seed-6',
    title: 'Bohemian Rhapsody',
    artist: 'Queen',
    bpm: 76,
    youtube: 'https://www.youtube.com/watch?v=fJ9rUzIMcZQ',
    notes: 'BPM applies to the opening ballad section.',
    createdAt: 5,
  },
];

function loadSongs() {
  let songs = DB.getAll();
  if (songs.length === 0) {
    // Populate with seed data on first run
    SEED_SONGS.forEach(s => DB.save(s));
    songs = DB.getAll();
  }
  state.songs = songs;
}

// ── Filtering / Sorting ───────────────────────────────
function filteredSongs() {
  let songs = [...state.songs];
  const { query, bpmMin, bpmMax, sort } = state.filter;

  if (query) {
    const q = query.toLowerCase();
    songs = songs.filter(s =>
      s.title.toLowerCase().includes(q) ||
      (s.artist || '').toLowerCase().includes(q) ||
      (s.notes || '').toLowerCase().includes(q)
    );
  }

  if (bpmMin !== null) songs = songs.filter(s => s.bpm >= bpmMin);
  if (bpmMax !== null) songs = songs.filter(s => s.bpm <= bpmMax);

  songs.sort((a, b) => {
    switch (sort) {
      case 'bpm-asc':   return a.bpm - b.bpm;
      case 'bpm-desc':  return b.bpm - a.bpm;
      case 'title-asc': return a.title.localeCompare(b.title);
      case 'date-desc': return (b.createdAt || 0) - (a.createdAt || 0);
      default: return 0;
    }
  });

  return songs;
}

// ── Render Song Grid ──────────────────────────────────
function renderGrid() {
  const grid = document.getElementById('song-grid');
  const emptyState = document.getElementById('empty-state');
  const songs = filteredSongs();

  grid.innerHTML = '';

  if (songs.length === 0) {
    emptyState.hidden = false;
    return;
  }
  emptyState.hidden = true;

  songs.forEach(song => {
    const hasVideo = !!extractYTId(song.youtube);
    const card = document.createElement('div');
    card.className = 'song-card';
    card.dataset.id = song.id;
    card.innerHTML = `
      <div class="card-bpm-badge">
        <span class="card-bpm-value">${song.bpm}</span>
        <span class="card-bpm-unit">bpm</span>
      </div>
      <div class="card-info">
        <div class="card-title">${escHtml(song.title)}</div>
        ${song.artist ? `<div class="card-artist">${escHtml(song.artist)}</div>` : ''}
      </div>
      <div class="card-footer">
        <span class="card-has-video ${hasVideo ? 'linked' : ''}">
          <svg viewBox="0 0 20 20" fill="currentColor"><path fill-rule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zM9.555 7.168A1 1 0 008 8v4a1 1 0 001.555.832l3-2a1 1 0 000-1.664l-3-2z"/></svg>
          ${hasVideo ? 'Video linked' : 'No video'}
        </span>
        <span class="card-play-hint">Open ›</span>
      </div>
    `;
    card.addEventListener('click', () => openPlayer(song.id));
    grid.appendChild(card);
  });
}

function escHtml(str) {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

// ── Player Modal ──────────────────────────────────────
function openPlayer(id) {
  const song = state.songs.find(s => s.id === id);
  if (!song) return;
  state.playerSongId = id;

  document.getElementById('player-title').textContent = song.title;
  document.getElementById('player-artist').textContent = song.artist || '';

  // YouTube
  const { id: ytId } = parseYTUrl(song.youtube);
  const ytStart = song.youtubeStart || 0;
  const wrap = document.getElementById('youtube-player-wrap');
  const noVid = document.getElementById('no-video-msg');

  if (ytId) {
    wrap.innerHTML = `<iframe src="${ytEmbedUrl(ytId, ytStart)}" allowfullscreen allow="autoplay; encrypted-media"></iframe>`;
    wrap.hidden = false;
    noVid.hidden = true;
  } else {
    wrap.innerHTML = '';
    wrap.hidden = true;
    noVid.hidden = false;
  }

  // Metronome setup
  const bpm = song.bpm;
  document.getElementById('metro-bpm').textContent = bpm;
  document.getElementById('bpm-hint').textContent = bpmHint(bpm);

  if (state.metronome) state.metronome.stop();
  state.beatRing = document.getElementById('beat-ring');
  state.metronome = new Metronome(() => pulseBeat());
  state.metronome.setBpm(bpm);

  setMetroStopped();

  document.getElementById('player-backdrop').hidden = false;
  document.body.style.overflow = 'hidden';
}

function closePlayer() {
  if (state.metronome) state.metronome.stop();
  state.metronome = null;
  setMetroStopped();
  document.getElementById('player-backdrop').hidden = true;
  document.body.style.overflow = '';
  state.playerSongId = null;

  // Destroy YouTube iframe to stop playback
  document.getElementById('youtube-player-wrap').innerHTML = '';
}

function pulseBeat() {
  const ring = state.beatRing;
  if (!ring) return;
  ring.classList.add('pulse');
  setTimeout(() => ring.classList.remove('pulse'), 80);
}

function setMetroPlaying() {
  const btn = document.getElementById('metro-toggle');
  const txt = document.getElementById('metro-btn-text');
  document.getElementById('metro-play-icon').hidden = true;
  document.getElementById('metro-stop-icon').hidden = false;
  txt.textContent = 'Stop Metronome';
  btn.classList.add('playing');
}

function setMetroStopped() {
  const btn = document.getElementById('metro-toggle');
  const txt = document.getElementById('metro-btn-text');
  document.getElementById('metro-play-icon').hidden = false;
  document.getElementById('metro-stop-icon').hidden = true;
  txt.textContent = 'Start Metronome';
  btn.classList.remove('playing');
}

function adjustBpm(delta) {
  const song = state.songs.find(s => s.id === state.playerSongId);
  const currentBpm = parseInt(document.getElementById('metro-bpm').textContent, 10);
  const newBpm = Math.max(20, Math.min(300, currentBpm + delta));
  document.getElementById('metro-bpm').textContent = newBpm;
  document.getElementById('bpm-hint').textContent = bpmHint(newBpm);
  if (state.metronome) state.metronome.setBpm(newBpm);
}

// ── Edit / Add Modal ──────────────────────────────────
function openEdit(id = null) {
  state.editSongId = id;

  const song = id ? state.songs.find(s => s.id === id) : null;

  document.getElementById('edit-modal-title').textContent = song ? 'Edit Song' : 'Add Song';
  document.getElementById('edit-id').value = id || '';
  document.getElementById('edit-title').value = song?.title || '';
  document.getElementById('edit-artist').value = song?.artist || '';
  document.getElementById('edit-bpm').value = song?.bpm || '';
  document.getElementById('edit-youtube').value = song?.youtube || '';
  document.getElementById('edit-notes').value = song?.notes || '';

  document.getElementById('edit-start').value = song?.youtubeStart ?? '';
  document.getElementById('delete-btn').hidden = !song;
  document.getElementById('yt-preview').hidden = true;
  document.getElementById('yt-preview-inner').innerHTML = '';
  document.getElementById('tap-feedback').hidden = true;
  document.getElementById('tap-detected').textContent = '–';
  document.getElementById('tap-accept-btn').disabled = true;
  state.tapDetectedBpm = null;

  updateLookupLink();

  if (state.tapTempo) state.tapTempo.reset();
  state.tapTempo = new TapTempo((bpm, count) => {
    const fb = document.getElementById('tap-feedback');
    const detected = document.getElementById('tap-detected');
    const acceptBtn = document.getElementById('tap-accept-btn');
    if (bpm === null) {
      fb.hidden = true;
      detected.textContent = '–';
      acceptBtn.disabled = true;
      state.tapDetectedBpm = null;
      return;
    }
    fb.hidden = false;
    detected.textContent = bpm;
    state.tapDetectedBpm = bpm;
    acceptBtn.disabled = count < 3;
  });

  document.getElementById('edit-backdrop').hidden = false;
  document.body.style.overflow = 'hidden';
  setTimeout(() => document.getElementById('edit-title').focus(), 50);
}

function closeEdit() {
  document.getElementById('edit-backdrop').hidden = true;
  document.body.style.overflow = '';
  if (state.tapTempo) state.tapTempo.reset();
}

function updateLookupLink() {
  const title = document.getElementById('edit-title').value.trim();
  const artist = document.getElementById('edit-artist').value.trim();
  const query = [title, artist, 'BPM'].filter(Boolean).join(' ');
  const link = document.getElementById('bpm-lookup-link');
  link.href = `https://www.google.com/search?q=${encodeURIComponent(query)}`;
}

function saveSong(e) {
  e.preventDefault();

  const title = document.getElementById('edit-title').value.trim();
  const bpm   = parseInt(document.getElementById('edit-bpm').value, 10);

  if (!title) { alert('Please enter a song title.'); return; }
  if (!bpm || bpm < 20 || bpm > 300) { alert('Please enter a valid BPM (20–300).'); return; }

  const youtubeUrl = document.getElementById('edit-youtube').value.trim();
  const manualStart = parseInt(document.getElementById('edit-start').value, 10);
  const autoStart = parseYTUrl(youtubeUrl).start;
  const youtubeStart = Number.isFinite(manualStart) && manualStart >= 0 ? manualStart : autoStart;

  const song = {
    id:          state.editSongId || `song-${Date.now()}`,
    title,
    artist:      document.getElementById('edit-artist').value.trim(),
    bpm,
    youtube:     youtubeUrl,
    youtubeStart,
    notes:       document.getElementById('edit-notes').value.trim(),
    createdAt:   state.editSongId
                   ? (state.songs.find(s => s.id === state.editSongId)?.createdAt || Date.now())
                   : Date.now(),
  };

  DB.save(song);
  loadSongs();
  renderGrid();
  closeEdit();
}

function deleteSong() {
  if (!state.editSongId) return;
  const song = state.songs.find(s => s.id === state.editSongId);
  if (!song) return;
  if (!confirm(`Delete "${song.title}"?`)) return;
  DB.delete(state.editSongId);
  loadSongs();
  renderGrid();
  closeEdit();
}

// ── YouTube preview inside form ────────────────────────
function previewYT() {
  const url = document.getElementById('edit-youtube').value.trim();
  const id = extractYTId(url);
  const wrap = document.getElementById('yt-preview');
  const inner = document.getElementById('yt-preview-inner');

  if (!id) {
    alert('Could not extract a YouTube video ID from that URL.');
    return;
  }

  inner.innerHTML = `
    <div class="yt-preview-video">
      <iframe src="${ytEmbedUrl(id)}" allowfullscreen allow="autoplay; encrypted-media"></iframe>
    </div>`;
  wrap.hidden = false;
}

function clearYTPreview() {
  document.getElementById('yt-preview-inner').innerHTML = '';
  document.getElementById('yt-preview').hidden = true;
}

// ── Debounce ──────────────────────────────────────────
function debounce(fn, ms) {
  let t;
  return (...args) => { clearTimeout(t); t = setTimeout(() => fn(...args), ms); };
}

// ── Wire Up Events ────────────────────────────────────
function init() {
  loadSongs();
  renderGrid();

  // Add song buttons
  document.getElementById('add-song-btn').addEventListener('click', () => openEdit());
  document.getElementById('empty-add-btn').addEventListener('click', () => openEdit());

  // ── Toolbar filters
  const searchInput = document.getElementById('search-input');
  const bpmMin = document.getElementById('bpm-min');
  const bpmMax = document.getElementById('bpm-max');
  const sortSelect = document.getElementById('sort-select');

  const refilter = debounce(() => {
    state.filter.query  = searchInput.value.trim();
    state.filter.bpmMin = bpmMin.value ? parseInt(bpmMin.value, 10) : null;
    state.filter.bpmMax = bpmMax.value ? parseInt(bpmMax.value, 10) : null;
    state.filter.sort   = sortSelect.value;
    renderGrid();
  }, 200);

  searchInput.addEventListener('input', refilter);
  bpmMin.addEventListener('input', refilter);
  bpmMax.addEventListener('input', refilter);
  sortSelect.addEventListener('change', refilter);

  // ── Player modal
  document.getElementById('player-close').addEventListener('click', closePlayer);
  document.getElementById('player-backdrop').addEventListener('click', e => {
    if (e.target === e.currentTarget) closePlayer();
  });

  document.getElementById('player-edit-btn').addEventListener('click', () => {
    closePlayer();
    openEdit(state.playerSongId);
  });

  document.getElementById('player-delete-btn').addEventListener('click', () => {
    const song = state.songs.find(s => s.id === state.playerSongId);
    if (!song) return;
    if (!confirm(`Delete "${song.title}"?`)) return;
    DB.delete(song.id);
    loadSongs();
    renderGrid();
    closePlayer();
  });

  document.getElementById('player-add-video-btn')?.addEventListener('click', () => {
    closePlayer();
    openEdit(state.playerSongId);
    setTimeout(() => document.getElementById('edit-youtube').focus(), 100);
  });

  document.getElementById('metro-toggle').addEventListener('click', () => {
    if (!state.metronome) return;
    if (state.metronome.isPlaying) {
      state.metronome.stop();
      setMetroStopped();
    } else {
      state.metronome.start();
      setMetroPlaying();
    }
  });

  document.getElementById('bpm-down').addEventListener('click', () => adjustBpm(-1));
  document.getElementById('bpm-up').addEventListener('click', () => adjustBpm(+1));

  // Hold-to-repeat on BPM buttons
  let holdTimer;
  let holdInterval;
  function startHold(delta) {
    holdTimer = setTimeout(() => {
      holdInterval = setInterval(() => adjustBpm(delta), 80);
    }, 400);
  }
  function stopHold() {
    clearTimeout(holdTimer);
    clearInterval(holdInterval);
  }
  ['bpm-down', 'bpm-up'].forEach(id => {
    const el = document.getElementById(id);
    const delta = id === 'bpm-up' ? 1 : -1;
    el.addEventListener('mousedown', () => startHold(delta));
    el.addEventListener('touchstart', () => startHold(delta), { passive: true });
    el.addEventListener('mouseup', stopHold);
    el.addEventListener('mouseleave', stopHold);
    el.addEventListener('touchend', stopHold);
  });

  // ── Edit modal
  document.getElementById('edit-close').addEventListener('click', closeEdit);
  document.getElementById('cancel-edit-btn').addEventListener('click', closeEdit);
  document.getElementById('edit-backdrop').addEventListener('click', e => {
    if (e.target === e.currentTarget) closeEdit();
  });

  document.getElementById('song-form').addEventListener('submit', saveSong);
  document.getElementById('delete-btn').addEventListener('click', deleteSong);

  document.getElementById('tap-btn').addEventListener('click', () => {
    document.getElementById('tap-btn').classList.add('tapping');
    setTimeout(() => document.getElementById('tap-btn').classList.remove('tapping'), 120);
    state.tapTempo?.tap();
  });

  document.getElementById('tap-accept-btn').addEventListener('click', () => {
    if (state.tapDetectedBpm) {
      document.getElementById('edit-bpm').value = state.tapDetectedBpm;
      state.tapTempo.reset();
    }
  });

  document.getElementById('edit-title').addEventListener('input', updateLookupLink);
  document.getElementById('edit-artist').addEventListener('input', updateLookupLink);

  // Auto-detect timecode from pasted YouTube URL
  document.getElementById('edit-youtube').addEventListener('input', () => {
    const url = document.getElementById('edit-youtube').value.trim();
    const { start } = parseYTUrl(url);
    const startField = document.getElementById('edit-start');
    if (start > 0) startField.value = start;
  });

  document.getElementById('preview-yt-btn').addEventListener('click', previewYT);
  document.getElementById('clear-preview-btn').addEventListener('click', clearYTPreview);

  // ── Keyboard shortcuts
  document.addEventListener('keydown', e => {
    if (e.key === 'Escape') {
      if (!document.getElementById('edit-backdrop').hidden) { closeEdit(); return; }
      if (!document.getElementById('player-backdrop').hidden) { closePlayer(); return; }
    }
    // Space = toggle metronome when player is open
    if (e.key === ' ' && !document.getElementById('player-backdrop').hidden) {
      const focused = document.activeElement;
      if (focused && (focused.tagName === 'INPUT' || focused.tagName === 'BUTTON')) return;
      e.preventDefault();
      document.getElementById('metro-toggle').click();
    }
  });
}

document.addEventListener('DOMContentLoaded', init);
