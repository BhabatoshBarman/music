const $ = (selector) => document.querySelector(selector);
const $$ = (selector) => [...document.querySelectorAll(selector)];

const audio = $("#audio");
const canvas = $("#visualizer");
const ctx = canvas.getContext("2d");
const els = {
  splash: $("#splash"),
  screenTitle: $("#screenTitle"),
  fileInput: $("#fileInput"),
  lyricsInput: $("#lyricsInput"),
  trackList: $("#trackList"),
  queueList: $("#queueList"),
  playlistList: $("#playlistList"),
  playlistName: $("#playlistName"),
  createPlaylistBtn: $("#createPlaylistBtn"),
  title: $("#trackTitle"),
  meta: $("#trackMeta"),
  nowBadge: $("#nowBadge"),
  orbLetters: $("#orbLetters"),
  play: $("#playBtn"),
  miniPlay: $("#miniPlay"),
  prev: $("#prevBtn"),
  next: $("#nextBtn"),
  shuffle: $("#shuffleBtn"),
  repeat: $("#repeatBtn"),
  seek: $("#seek"),
  currentTime: $("#currentTime"),
  duration: $("#duration"),
  search: $("#search"),
  trackCount: $("#trackCount"),
  likedCount: $("#likedCount"),
  presetName: $("#presetName"),
  volume: $("#volume"),
  speed: $("#speed"),
  balance: $("#balance"),
  crossfade: $("#crossfade"),
  bassBoost: $("#bassBoost"),
  trebleBoost: $("#trebleBoost"),
  presetSelect: $("#presetSelect"),
  eqBands: $("#eqBands"),
  themeSelect: $("#themeSelect"),
  accentPicker: $("#accentPicker"),
  blurRange: $("#blurRange"),
  cornerRange: $("#cornerRange"),
  sleepTimer: $("#sleepTimer"),
  mute: $("#muteBtn"),
  exportBtn: $("#exportBtn"),
  importPlaylistInput: $("#importPlaylistInput"),
  install: $("#installBtn"),
  fullscreen: $("#fullscreenBtn"),
  mini: $("#miniPlayer"),
  miniOpen: $("#miniOpen"),
  miniTitle: $("#miniTitle"),
  miniMeta: $("#miniMeta"),
  lyricsDisplay: $("#lyricsDisplay"),
  karaokeScore: $("#karaokeScore"),
  vocalReduce: $("#vocalReduce"),
  echo: $("#echo"),
  pitch: $("#pitch"),
};

const DB_NAME = "pulsedeck-db";
const DB_VERSION = 1;
const bands = [31, 62, 125, 250, 500, 1000, 2000, 4000, 8000, 16000];
const presets = {
  Normal: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
  Rock: [4, 3, 2, -1, -2, 1, 3, 5, 5, 4],
  Pop: [-1, 2, 4, 4, 2, 0, -1, 1, 3, 4],
  Jazz: [3, 2, 1, 2, -1, -1, 0, 2, 3, 2],
  Classical: [4, 3, 2, 0, 0, 0, -1, 1, 3, 4],
  Dance: [6, 5, 2, 0, -2, -1, 1, 3, 5, 6],
  "Bass Boost": [8, 7, 6, 3, 1, 0, 0, 0, 1, 2],
  "Vocal Boost": [-2, -1, 0, 2, 4, 5, 4, 2, 0, -1],
  Acoustic: [3, 4, 3, 1, 0, 1, 2, 3, 4, 3],
};

let db;
let tracks = [];
let playlists = [];
let lyrics = [];
let current = -1;
let activeFilter = "all";
let shuffle = false;
let repeatMode = "off";
let deferredInstall;
let sleepTimeout;
let audioContext;
let analyser;
let source;
let panner;
let eqNodes = [];
let bassNode;
let trebleNode;
let echoNode;
let echoGain;

const settings = {
  theme: "dark",
  accent: "#ff3d81",
  blur: 18,
  corners: 22,
  volume: 0.8,
  speed: 1,
  balance: 0,
  crossfade: 0,
  preset: "Normal",
  eq: [...presets.Normal],
  bassBoost: 0,
  trebleBoost: 0,
};

const formatTime = (seconds) => {
  if (!Number.isFinite(seconds)) return "0:00";
  const mins = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60).toString().padStart(2, "0");
  return `${mins}:${secs}`;
};

const cleanName = (name) => name.replace(/\.[^/.]+$/, "").replace(/[_-]+/g, " ").trim();
const uid = () => `${Date.now()}-${Math.random().toString(16).slice(2)}`;
const escapeHtml = (value) => String(value).replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;" }[char]));

const openDb = () => new Promise((resolve, reject) => {
  const request = indexedDB.open(DB_NAME, DB_VERSION);
  request.onupgradeneeded = () => {
    const nextDb = request.result;
    if (!nextDb.objectStoreNames.contains("tracks")) nextDb.createObjectStore("tracks", { keyPath: "id" });
    if (!nextDb.objectStoreNames.contains("playlists")) nextDb.createObjectStore("playlists", { keyPath: "id" });
    if (!nextDb.objectStoreNames.contains("settings")) nextDb.createObjectStore("settings", { keyPath: "key" });
  };
  request.onsuccess = () => resolve(request.result);
  request.onerror = () => reject(request.error);
});

const txStore = (name, mode = "readonly") => db.transaction(name, mode).objectStore(name);
const dbAll = (name) => new Promise((resolve) => {
  const request = txStore(name).getAll();
  request.onsuccess = () => resolve(request.result || []);
  request.onerror = () => resolve([]);
});
const dbPut = (name, value) => new Promise((resolve, reject) => {
  const request = txStore(name, "readwrite").put(value);
  request.onsuccess = () => resolve();
  request.onerror = () => reject(request.error);
});
const dbDelete = (name, key) => new Promise((resolve) => {
  const request = txStore(name, "readwrite").delete(key);
  request.onsuccess = () => resolve();
  request.onerror = () => resolve();
});

const readDuration = (blob) => new Promise((resolve) => {
  const probe = new Audio();
  const url = URL.createObjectURL(blob);
  probe.preload = "metadata";
  probe.onloadedmetadata = () => {
    URL.revokeObjectURL(url);
    resolve(probe.duration || 0);
  };
  probe.onerror = () => {
    URL.revokeObjectURL(url);
    resolve(0);
  };
  probe.src = url;
});

const saveSettings = () => dbPut("settings", { key: "main", value: settings });

const applyTheme = () => {
  document.body.dataset.theme = settings.theme;
  document.documentElement.style.setProperty("--accent", settings.accent);
  document.documentElement.style.setProperty("--blur", `${settings.blur}px`);
  document.documentElement.style.setProperty("--radius", `${settings.corners}px`);
  els.themeSelect.value = settings.theme;
  els.accentPicker.value = settings.accent;
  els.blurRange.value = settings.blur;
  els.cornerRange.value = settings.corners;
};

const setupAudioGraph = () => {
  if (audioContext) return;
  audioContext = new AudioContext();
  analyser = audioContext.createAnalyser();
  analyser.fftSize = 256;
  source = audioContext.createMediaElementSource(audio);
  eqNodes = bands.map((frequency) => new BiquadFilterNode(audioContext, { type: "peaking", frequency, Q: 1.1, gain: 0 }));
  bassNode = new BiquadFilterNode(audioContext, { type: "lowshelf", frequency: 120, gain: 0 });
  trebleNode = new BiquadFilterNode(audioContext, { type: "highshelf", frequency: 8000, gain: 0 });
  echoNode = new DelayNode(audioContext, { delayTime: 0.18 });
  echoGain = new GainNode(audioContext, { gain: 0 });
  panner = new StereoPannerNode(audioContext, { pan: settings.balance });
  source.connect(eqNodes[0]);
  eqNodes.reduce((prev, node) => prev.connect(node));
  eqNodes.at(-1).connect(bassNode).connect(trebleNode).connect(panner).connect(analyser).connect(audioContext.destination);
  trebleNode.connect(echoNode).connect(echoGain).connect(trebleNode);
  applyAudioSettings();
};

const applyAudioSettings = () => {
  audio.volume = settings.volume;
  audio.playbackRate = settings.speed;
  if (panner) panner.pan.value = settings.balance;
  if (bassNode) bassNode.gain.value = Number(settings.bassBoost);
  if (trebleNode) trebleNode.gain.value = Number(settings.trebleBoost);
  if (echoGain) echoGain.gain.value = Number(els.echo.value || 0) * 0.35;
  eqNodes.forEach((node, index) => {
    node.gain.value = settings.eq[index] || 0;
  });
};

const updateMediaSession = () => {
  if (!("mediaSession" in navigator) || current < 0) return;
  const track = tracks[current];
  navigator.mediaSession.metadata = new MediaMetadata({
    title: track.title,
    artist: track.artist || "Local library",
    album: track.album || "PulseDeck",
  });
  navigator.mediaSession.setActionHandler("play", play);
  navigator.mediaSession.setActionHandler("pause", pause);
  navigator.mediaSession.setActionHandler("previoustrack", previous);
  navigator.mediaSession.setActionHandler("nexttrack", next);
  navigator.mediaSession.setActionHandler("seekto", (details) => {
    if (details.seekTime != null) audio.currentTime = details.seekTime;
  });
};

const sortedTracks = () => {
  const term = els.search.value.toLowerCase();
  let list = tracks.filter((track) => `${track.title} ${track.artist} ${track.album}`.toLowerCase().includes(term));
  if (activeFilter === "recent") list = list.sort((a, b) => (b.addedAt || 0) - (a.addedAt || 0));
  if (activeFilter === "played") list = list.sort((a, b) => (b.playCount || 0) - (a.playCount || 0));
  if (activeFilter === "liked") list = list.filter((track) => track.liked);
  return list;
};

const render = () => {
  const visible = sortedTracks();
  els.trackList.innerHTML = visible.map((track) => trackMarkup(track)).join("") || empty("Import local songs to build your offline music library.");
  els.queueList.innerHTML = tracks.map((track) => trackMarkup(track, true)).join("") || empty("Queue is empty.");
  els.playlistList.innerHTML = playlists.map(playlistMarkup).join("") || empty("Create playlists for moods, artists, or albums.");
  els.trackCount.textContent = tracks.length;
  els.likedCount.textContent = tracks.filter((track) => track.liked).length;
  els.presetName.textContent = settings.preset;
  updateNow();
};

const trackMarkup = (track, compact = false) => {
  const index = tracks.findIndex((item) => item.id === track.id);
  return `
    <article class="track-item ${index === current ? "active" : ""}" data-id="${track.id}" draggable="true">
      <span class="cover">${escapeHtml((track.title || "PD").slice(0, 2).toUpperCase())}</span>
      <div>
        <strong>${escapeHtml(track.title)}</strong>
        <span>${escapeHtml(track.artist || "Unknown artist")} - ${formatTime(track.duration)} - played ${track.playCount || 0}</span>
      </div>
      ${compact ? "" : `<div class="row-actions">
        <button class="tiny-btn" type="button" data-like="${track.id}">${track.liked ? "Liked" : "Like"}</button>
        <button class="tiny-btn" type="button" data-play="${track.id}">Play</button>
      </div>`}
    </article>`;
};

const playlistMarkup = (playlist) => `
  <article class="playlist-item" data-playlist="${playlist.id}">
    <span class="cover">${escapeHtml(playlist.name.slice(0, 2).toUpperCase())}</span>
    <div>
      <strong>${escapeHtml(playlist.name)}</strong>
      <span>${playlist.trackIds.length} songs</span>
    </div>
    <div class="row-actions">
      <button class="tiny-btn" type="button" data-rename="${playlist.id}">Rename</button>
      <button class="tiny-btn" type="button" data-delete-list="${playlist.id}">Delete</button>
    </div>
  </article>`;

const empty = (text) => `<p class="empty">${text}</p>`;

const updateNow = () => {
  const track = tracks[current];
  if (!track) return;
  els.title.textContent = track.title;
  els.meta.textContent = `${track.artist || "Unknown artist"} - ${track.type || "AUDIO"}`;
  els.miniTitle.textContent = track.title;
  els.miniMeta.textContent = `${formatTime(audio.currentTime)} / ${formatTime(track.duration)}`;
  els.orbLetters.textContent = track.title.slice(0, 2).toUpperCase();
  els.nowBadge.textContent = audio.paused ? "Paused" : "Playing";
  els.mini.hidden = false;
};

const loadTrack = async (index, autoPlay = true) => {
  if (!tracks[index]) return;
  current = index;
  const track = tracks[current];
  if (audio.src?.startsWith("blob:")) URL.revokeObjectURL(audio.src);
  audio.src = URL.createObjectURL(track.blob);
  audio.playbackRate = settings.speed;
  track.lastPlayed = Date.now();
  track.playCount = (track.playCount || 0) + 1;
  await dbPut("tracks", track);
  updateMediaSession();
  render();
  if (autoPlay) play();
};

const play = async () => {
  if (current < 0 && tracks.length) await loadTrack(0, false);
  if (current < 0) return;
  setupAudioGraph();
  await audioContext.resume();
  await audio.play();
  document.body.classList.add("playing");
  els.play.textContent = "Pause";
  els.miniPlay.textContent = "Pause";
  updateNow();
};

const pause = () => {
  audio.pause();
  document.body.classList.remove("playing");
  els.play.textContent = "Play";
  els.miniPlay.textContent = "Play";
  updateNow();
};

const next = () => {
  if (!tracks.length) return;
  if (repeatMode === "one") return loadTrack(current);
  const index = shuffle ? Math.floor(Math.random() * tracks.length) : (current + 1) % tracks.length;
  loadTrack(index);
};

const previous = () => {
  if (!tracks.length) return;
  loadTrack((current - 1 + tracks.length) % tracks.length);
};

const setScreen = (id) => {
  $$(".screen").forEach((screen) => screen.classList.toggle("active", screen.id === id));
  $$(".nav-btn").forEach((button) => button.classList.toggle("active", button.dataset.screen === id));
  els.screenTitle.textContent = $(`#${id}`).dataset.title;
  window.scrollTo({ top: 0, behavior: "smooth" });
};

const renderEq = () => {
  els.eqBands.innerHTML = bands.map((band, index) => `
    <label class="eq-band">
      <input class="eq-slider" type="range" min="-12" max="12" value="${settings.eq[index]}" data-index="${index}">
      <span>${band >= 1000 ? `${band / 1000}k` : band}Hz</span>
    </label>`).join("");
};

const applyPreset = (name) => {
  settings.preset = name;
  settings.eq = [...presets[name]];
  renderEq();
  applyAudioSettings();
  saveSettings();
  render();
};

const parseLyrics = (text) => {
  const lines = text.split(/\r?\n/).map((line) => {
    const match = line.match(/\[(\d{1,2}):(\d{2})(?:\.(\d{1,3}))?\](.*)/);
    if (!match) return { time: null, text: line.trim() };
    return {
      time: Number(match[1]) * 60 + Number(match[2]) + Number(`0.${match[3] || 0}`),
      text: match[4].trim(),
    };
  }).filter((line) => line.text);
  lyrics = lines;
  renderLyrics();
};

const renderLyrics = () => {
  if (!lyrics.length) {
    els.lyricsDisplay.textContent = "Upload a .lrc or .txt lyrics file.";
    return;
  }
  const timed = lyrics.some((line) => line.time !== null);
  if (!timed) {
    els.lyricsDisplay.innerHTML = lyrics.map((line) => `<div class="lyric-line">${escapeHtml(line.text)}</div>`).join("");
    return;
  }
  const active = lyrics.findLastIndex((line) => line.time !== null && line.time <= audio.currentTime);
  els.lyricsDisplay.innerHTML = lyrics.slice(Math.max(0, active - 2), active + 4).map((line, index) => {
    const realIndex = Math.max(0, active - 2) + index;
    return `<div class="lyric-line ${realIndex === active ? "active" : ""}">${escapeHtml(line.text)}</div>`;
  }).join("");
};

const setSleepTimer = (minutes) => {
  clearTimeout(sleepTimeout);
  if (!minutes) return;
  sleepTimeout = setTimeout(pause, minutes * 60 * 1000);
};

const exportPlaylists = () => {
  const blob = new Blob([JSON.stringify(playlists, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = "pulsedeck-playlists.json";
  link.click();
  URL.revokeObjectURL(url);
};

const init = async () => {
  db = await openDb();
  tracks = await dbAll("tracks");
  playlists = await dbAll("playlists");
  const storedSettings = (await dbAll("settings")).find((item) => item.key === "main");
  if (storedSettings?.value) Object.assign(settings, storedSettings.value);
  tracks.forEach((track) => { track.url = ""; });
  renderEq();
  applyTheme();
  applyAudioSettings();
  els.volume.value = settings.volume;
  els.speed.value = settings.speed;
  els.balance.value = settings.balance;
  els.crossfade.value = settings.crossfade;
  els.bassBoost.value = settings.bassBoost;
  els.trebleBoost.value = settings.trebleBoost;
  els.presetSelect.value = settings.preset;
  render();
  setTimeout(() => els.splash.classList.add("hide"), 700);
};

els.fileInput.addEventListener("change", async (event) => {
  const files = [...event.target.files].filter((file) => file.type.startsWith("audio/") || /\.(mp3|wav|flac|ogg|aac|m4a)$/i.test(file.name));
  const imported = [];
  for (const file of files) {
    const title = cleanName(file.name);
    const [artistMaybe, songMaybe] = title.includes(" - ") ? title.split(" - ", 2) : ["Unknown artist", title];
    const track = {
      id: uid(),
      title: songMaybe || title,
      artist: artistMaybe || "Unknown artist",
      album: "Local files",
      genre: "Unknown",
      type: file.type.split("/")[1]?.toUpperCase() || file.name.split(".").pop().toUpperCase(),
      duration: await readDuration(file),
      addedAt: Date.now(),
      lastPlayed: 0,
      playCount: 0,
      liked: false,
      blob: file,
    };
    imported.push(track);
    await dbPut("tracks", track);
  }
  tracks = [...tracks, ...imported];
  render();
  if (current < 0 && tracks.length) loadTrack(0, false);
});

els.trackList.addEventListener("click", async (event) => {
  const id = event.target.closest("[data-id]")?.dataset.id;
  if (!id) return;
  const index = tracks.findIndex((track) => track.id === id);
  if (event.target.closest("[data-like]")) {
    tracks[index].liked = !tracks[index].liked;
    await dbPut("tracks", tracks[index]);
    render();
    return;
  }
  loadTrack(index);
});

els.queueList.addEventListener("click", (event) => {
  const id = event.target.closest("[data-id]")?.dataset.id;
  const index = tracks.findIndex((track) => track.id === id);
  if (index >= 0) loadTrack(index);
});

els.trackList.addEventListener("dragstart", (event) => {
  const id = event.target.closest("[data-id]")?.dataset.id;
  event.dataTransfer.setData("text/plain", id);
});
els.trackList.addEventListener("dragover", (event) => event.preventDefault());
els.trackList.addEventListener("drop", (event) => {
  event.preventDefault();
  const fromId = event.dataTransfer.getData("text/plain");
  const toId = event.target.closest("[data-id]")?.dataset.id;
  const from = tracks.findIndex((track) => track.id === fromId);
  const to = tracks.findIndex((track) => track.id === toId);
  if (from < 0 || to < 0) return;
  const [moved] = tracks.splice(from, 1);
  tracks.splice(to, 0, moved);
  render();
});

els.createPlaylistBtn.addEventListener("click", async () => {
  const name = els.playlistName.value.trim();
  if (!name) return;
  const playlist = { id: uid(), name, trackIds: tracks[current] ? [tracks[current].id] : [] };
  playlists.push(playlist);
  els.playlistName.value = "";
  await dbPut("playlists", playlist);
  render();
});

els.playlistList.addEventListener("click", async (event) => {
  const renameId = event.target.closest("[data-rename]")?.dataset.rename;
  const deleteId = event.target.closest("[data-delete-list]")?.dataset.deleteList;
  if (renameId) {
    const playlist = playlists.find((item) => item.id === renameId);
    const name = prompt("Playlist name", playlist.name);
    if (name?.trim()) {
      playlist.name = name.trim();
      await dbPut("playlists", playlist);
      render();
    }
  }
  if (deleteId) {
    playlists = playlists.filter((item) => item.id !== deleteId);
    await dbDelete("playlists", deleteId);
    render();
  }
});

els.play.addEventListener("click", () => audio.paused ? play() : pause());
els.miniPlay.addEventListener("click", () => audio.paused ? play() : pause());
els.miniOpen.addEventListener("click", () => setScreen("home"));
els.next.addEventListener("click", next);
els.prev.addEventListener("click", previous);
els.shuffle.addEventListener("click", () => {
  shuffle = !shuffle;
  els.shuffle.classList.toggle("active", shuffle);
});
els.repeat.addEventListener("click", () => {
  repeatMode = repeatMode === "off" ? "all" : repeatMode === "all" ? "one" : "off";
  els.repeat.textContent = `Repeat ${repeatMode === "one" ? "One" : repeatMode === "all" ? "All" : "Off"}`;
  els.repeat.classList.toggle("active", repeatMode !== "off");
});

audio.addEventListener("timeupdate", () => {
  els.seek.value = audio.duration ? Math.round((audio.currentTime / audio.duration) * 1000) : 0;
  els.currentTime.textContent = formatTime(audio.currentTime);
  els.duration.textContent = formatTime(audio.duration);
  updateNow();
  renderLyrics();
  const crossfade = Number(settings.crossfade);
  if (crossfade && audio.duration - audio.currentTime <= crossfade && repeatMode !== "one") next();
});
audio.addEventListener("loadedmetadata", () => {
  els.duration.textContent = formatTime(audio.duration);
});
audio.addEventListener("ended", () => {
  if (repeatMode === "off" && current === tracks.length - 1) return pause();
  next();
});
els.seek.addEventListener("input", () => {
  if (audio.duration) audio.currentTime = (Number(els.seek.value) / 1000) * audio.duration;
});

["volume", "speed", "balance", "crossfade", "bassBoost", "trebleBoost"].forEach((key) => {
  els[key].addEventListener("input", () => {
    settings[key] = Number(els[key].value);
    applyAudioSettings();
    saveSettings();
  });
});

els.eqBands.addEventListener("input", (event) => {
  if (!event.target.classList.contains("eq-slider")) return;
  settings.eq[Number(event.target.dataset.index)] = Number(event.target.value);
  settings.preset = "Custom";
  applyAudioSettings();
  saveSettings();
  render();
});

els.presetSelect.addEventListener("change", () => applyPreset(els.presetSelect.value));
els.search.addEventListener("input", render);
$$(".chip").forEach((button) => button.addEventListener("click", () => {
  activeFilter = button.dataset.filter;
  $$(".chip").forEach((item) => item.classList.toggle("active", item === button));
  render();
}));
$$(".nav-btn").forEach((button) => button.addEventListener("click", () => setScreen(button.dataset.screen)));
$$("[data-go]").forEach((button) => button.addEventListener("click", () => setScreen(button.dataset.go)));

["theme", "accent", "blur", "corners"].forEach((name) => {
  const input = { theme: els.themeSelect, accent: els.accentPicker, blur: els.blurRange, corners: els.cornerRange }[name];
  input.addEventListener("input", () => {
    settings[name] = name === "blur" || name === "corners" ? Number(input.value) : input.value;
    applyTheme();
    saveSettings();
  });
});

els.sleepTimer.addEventListener("change", () => setSleepTimer(Number(els.sleepTimer.value)));
els.mute.addEventListener("click", () => {
  audio.muted = !audio.muted;
  els.mute.textContent = audio.muted ? "Unmute" : "Mute";
});
els.fullscreen.addEventListener("click", () => {
  if (!document.fullscreenElement) document.documentElement.requestFullscreen?.();
  else document.exitFullscreen?.();
});
els.lyricsInput.addEventListener("change", async (event) => {
  const file = event.target.files[0];
  if (file) parseLyrics(await file.text());
});
els.exportBtn.addEventListener("click", exportPlaylists);
els.importPlaylistInput.addEventListener("change", async (event) => {
  const file = event.target.files[0];
  if (!file) return;
  const imported = JSON.parse(await file.text());
  if (Array.isArray(imported)) {
    playlists = imported.map((item) => ({ id: item.id || uid(), name: item.name || "Imported", trackIds: item.trackIds || [] }));
    for (const playlist of playlists) await dbPut("playlists", playlist);
    render();
  }
});

window.addEventListener("beforeinstallprompt", (event) => {
  event.preventDefault();
  deferredInstall = event;
  els.install.hidden = false;
});
els.install.addEventListener("click", async () => {
  if (!deferredInstall) return;
  deferredInstall.prompt();
  await deferredInstall.userChoice;
  deferredInstall = null;
  els.install.hidden = true;
});

if ("serviceWorker" in navigator && location.protocol !== "file:") {
  navigator.serviceWorker.register("sw.js");
}

const draw = () => {
  requestAnimationFrame(draw);
  const width = canvas.width;
  const height = canvas.height;
  ctx.clearRect(0, 0, width, height);
  ctx.fillStyle = "#07070a";
  ctx.fillRect(0, 0, width, height);
  const data = new Uint8Array(analyser?.frequencyBinCount || 96);
  if (analyser) analyser.getByteFrequencyData(data);
  const center = width / 2;
  for (let i = 0; i < data.length; i += 1) {
    const value = analyser ? data[i] / 255 : (Math.sin(Date.now() / 600 + i) + 1) / 2;
    const angle = (i / data.length) * Math.PI * 2;
    const inner = width * 0.2;
    const outer = inner + 80 + value * 180;
    ctx.strokeStyle = i % 2 ? getComputedStyle(document.documentElement).getPropertyValue("--accent") : getComputedStyle(document.documentElement).getPropertyValue("--accent-2");
    ctx.lineWidth = 5;
    ctx.beginPath();
    ctx.moveTo(center + Math.cos(angle) * inner, center + Math.sin(angle) * inner);
    ctx.lineTo(center + Math.cos(angle) * outer, center + Math.sin(angle) * outer);
    ctx.stroke();
  }
};

init();
draw();
