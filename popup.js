'use strict';

// ================= Konstanta =================

const STORAGE_KEYS = ['gemini_api_key', 'rooms', 'currentRoomId', 'settings'];
const API_BASE = 'https://generativelanguage.googleapis.com/v1beta/models/';
const MODELS = {
  'gemini-3.8-flash': 'Gemini 3.8 Flash (disarankan)',
  'gemini-3.6-flash': 'Gemini 3.6 Flash',
  'gemini-3.5-flash-lite': 'Gemini 3.5 Flash-Lite (hemat)',
  'gemini-3.1-pro-preview': 'Gemini 3.1 Pro (preview)'
};
const EFFORTS = { low: 'Rendah', medium: 'Sedang', high: 'Tinggi' };
const DEFAULT_SETTINGS = { model: 'gemini-3.8-flash', effort: 'medium' };
const SECTION_NAMES = ['Role', 'Task', 'Context', 'Reasoning', 'Stop', 'Output'];
const HEADING_RE = new RegExp(
  '^[\\s#*>\\d.]*\\[(' + SECTION_NAMES.join('|') + ')\\][\\s*:]*(.*)$',
  'i'
);
const REQUEST_TIMEOUT_MS = 90000;
const MAX_ROOMS = 40;
const MAX_MESSAGES = 30;
const MAX_TITLE = 40;
const SVG_NS = 'http://www.w3.org/2000/svg';
const ELEMENT_IDS = [
  'app', 'roomsToggleBtn', 'settingsToggleBtn', 'currentRoomTitle', 'settingsPanel',
  'apiKey', 'toggleKeyBtn', 'clearKeyBtn', 'geminiModel', 'effortLevel', 'chatBox',
  'status', 'userPrompt', 'sendBtn', 'roomsPanel', 'closeRoomsBtn', 'roomsList', 'newRoomBtn'
];

// ================= State =================

const state = {
  rooms: [],
  currentRoomId: null,
  settings: { ...DEFAULT_SETTINGS }
};
const pending = new Map(); // roomId -> { controller, text, timedOut, cancelled }
const els = {};
let statusTimer = null;
let confirmDeleteId = null;
let autofocusRoomId = null;

class AppError extends Error {}

// ================= Helper DOM =================

function icon(name, extraClass) {
  const svg = document.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('class', 'icon' + (extraClass ? ' ' + extraClass : ''));
  svg.setAttribute('aria-hidden', 'true');
  const use = document.createElementNS(SVG_NS, 'use');
  use.setAttribute('href', '#i-' + name);
  svg.appendChild(use);
  return svg;
}

function h(tag, props = {}, ...children) {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(props)) {
    if (value === null || value === undefined || value === false) continue;
    if (key === 'class') node.className = value;
    else if (key === 'text') node.textContent = value;
    else if (key.startsWith('on')) node.addEventListener(key.slice(2).toLowerCase(), value);
    else node.setAttribute(key, value === true ? '' : value);
  }
  for (const child of children.flat()) {
    if (child === null || child === undefined || child === false) continue;
    node.append(child);
  }
  return node;
}

function appendInline(parent, text) {
  const re = /\*\*([^*\n]+?)\*\*/g;
  let last = 0;
  let match;
  while ((match = re.exec(text)) !== null) {
    if (match.index > last) parent.append(text.slice(last, match.index));
    parent.append(h('strong', { text: match[1] }));
    last = re.lastIndex;
  }
  if (last < text.length) parent.append(text.slice(last));
}

function setStatus(message, kind) {
  clearTimeout(statusTimer);
  els.status.textContent = message || '';
  els.status.dataset.kind = message ? (kind || '') : '';
  if (message && kind !== 'error') {
    statusTimer = setTimeout(() => {
      els.status.textContent = '';
      els.status.dataset.kind = '';
    }, 8000);
  }
}

function scrollChatToBottom() {
  els.chatBox.scrollTop = els.chatBox.scrollHeight;
}

// ================= Normalisasi data tersimpan =================

function normalizeSettings(raw) {
  const model = raw && Object.hasOwn(MODELS, raw.model) ? raw.model : DEFAULT_SETTINGS.model;
  const effort = raw && Object.hasOwn(EFFORTS, raw.effort) ? raw.effort : DEFAULT_SETTINGS.effort;
  return { model, effort };
}

function normalizeHistory(raw) {
  if (!Array.isArray(raw)) return [];
  const list = raw
    .filter((m) => m && (m.role === 'user' || m.role === 'model') &&
      Array.isArray(m.parts) && m.parts[0] && typeof m.parts[0].text === 'string')
    .map((m) => ({ role: m.role, parts: [{ text: m.parts[0].text }] }));
  while (list.length && list[0].role !== 'user') list.shift();
  while (list.length && list[list.length - 1].role !== 'model') list.pop();
  return list;
}

function sanitizeRooms(raw) {
  if (!Array.isArray(raw)) return [];
  const seen = new Set();
  const out = [];
  raw.forEach((room, index) => {
    if (!room || typeof room.id !== 'string' || seen.has(room.id)) return;
    seen.add(room.id);
    out.push({
      id: room.id,
      title: typeof room.title === 'string' && room.title ? room.title : 'Room',
      history: normalizeHistory(room.history),
      updatedAt: Number.isFinite(room.updatedAt) ? room.updatedAt : Date.now() - index * 1000
    });
  });
  return out;
}

// ================= Room =================

function createRoom() {
  return { id: 'room_' + crypto.randomUUID(), title: 'Room baru', history: [], updatedAt: Date.now() };
}

function currentRoom() {
  return state.rooms.find((r) => r.id === state.currentRoomId) || null;
}

function latestRoom() {
  return [...state.rooms].sort((a, b) => b.updatedAt - a.updatedAt)[0] || null;
}

function makeTitle(text) {
  const clean = text.replace(/\s+/g, ' ').trim();
  return clean.length > MAX_TITLE ? clean.slice(0, MAX_TITLE) + '...' : clean;
}

function trimHistory(room) {
  while (room.history.length > MAX_MESSAGES) room.history.splice(0, 2);
  while (room.history.length && room.history[0].role !== 'user') room.history.shift();
}

function updateTitle() {
  const room = currentRoom();
  els.currentRoomTitle.textContent = room && room.history.length ? room.title : 'Room baru';
}

async function persist() {
  const keep = state.rooms
    .filter((r) => r.history.length > 0 || r.id === state.currentRoomId || pending.has(r.id))
    .sort((a, b) => b.updatedAt - a.updatedAt)
    .slice(0, MAX_ROOMS);
  const current = currentRoom();
  if (current && !keep.includes(current)) keep.push(current);
  state.rooms = keep;
  try {
    await chrome.storage.local.set({ rooms: keep, currentRoomId: state.currentRoomId });
  } catch (err) {
    setStatus('Gagal menyimpan riwayat. Penyimpanan lokal mungkin penuh, hapus beberapa room.', 'error');
  }
}

function switchRoom(id) {
  state.currentRoomId = id;
  updateTitle();
  renderChat();
  syncComposer();
  persist();
  closeRooms(false);
  els.userPrompt.focus();
}

function startNewRoom() {
  const room = currentRoom();
  const reusable = room && room.history.length === 0 && !pending.has(room.id);
  if (!reusable) {
    const fresh = createRoom();
    state.rooms.unshift(fresh);
    state.currentRoomId = fresh.id;
  }
  updateTitle();
  renderChat();
  syncComposer();
  persist();
  closeRooms(false);
  els.userPrompt.focus();
}

function deleteRoom(id) {
  const entry = pending.get(id);
  if (entry) {
    entry.cancelled = true;
    entry.controller.abort();
    pending.delete(id);
  }
  state.rooms = state.rooms.filter((r) => r.id !== id);
  confirmDeleteId = null;
  autofocusRoomId = null;
  if (!state.rooms.length) state.rooms.push(createRoom());
  if (state.currentRoomId === id || !currentRoom()) {
    state.currentRoomId = latestRoom().id;
    updateTitle();
    renderChat();
    syncComposer();
  }
  persist();
  renderRooms();
  els.newRoomBtn.focus();
}

// ================= Panel =================

function setSettingsOpen(open, restoreFocus) {
  els.settingsPanel.hidden = !open;
  els.settingsToggleBtn.setAttribute('aria-expanded', String(open));
  if (!open && restoreFocus) els.settingsToggleBtn.focus();
}

function openRooms() {
  setSettingsOpen(false, false);
  confirmDeleteId = null;
  autofocusRoomId = null;
  renderRooms();
  els.roomsPanel.hidden = false;
  els.app.inert = true;
  els.roomsToggleBtn.setAttribute('aria-expanded', 'true');
  els.closeRoomsBtn.focus();
}

function closeRooms(restoreFocus) {
  els.roomsPanel.hidden = true;
  els.app.inert = false;
  els.roomsToggleBtn.setAttribute('aria-expanded', 'false');
  confirmDeleteId = null;
  if (restoreFocus) els.roomsToggleBtn.focus();
}

function formatDate(ts) {
  return new Date(ts).toLocaleDateString('id-ID', { day: 'numeric', month: 'short' });
}

function renderRooms() {
  const list = els.roomsList;
  list.replaceChildren();
  const rooms = [...state.rooms].sort((a, b) => b.updatedAt - a.updatedAt);

  rooms.forEach((room) => {
    const active = room.id === state.currentRoomId;
    const label = room.history.length ? room.title : 'Room baru (kosong)';
    const count = Math.floor(room.history.length / 2);
    const meta = count ? `${count} instruksi · ${formatDate(room.updatedAt)}` : 'Belum ada pesan';
    const item = h('li', { class: 'room' + (active ? ' is-active' : '') });

    if (confirmDeleteId === room.id) {
      item.append(
        h('span', { class: 'room-confirm', text: `Hapus "${label}"?` }),
        h('button', { type: 'button', class: 'btn btn-sm btn-danger', onclick: () => deleteRoom(room.id) }, 'Hapus'),
        h('button', {
          type: 'button', class: 'btn btn-sm', 'data-autofocus': true,
          onclick: () => { confirmDeleteId = null; autofocusRoomId = room.id; renderRooms(); }
        }, 'Batal')
      );
    } else {
      item.append(
        h('button', {
          type: 'button', class: 'room-select',
          'aria-current': active ? 'true' : null,
          onclick: () => switchRoom(room.id)
        },
          icon(active ? 'check' : 'message'),
          h('span', { class: 'room-text' },
            h('span', { class: 'room-title', text: label }),
            h('span', { class: 'room-meta', text: meta }))
        ),
        h('button', {
          type: 'button', class: 'icon-btn',
          'aria-label': `Hapus room ${label}`,
          'data-autofocus': autofocusRoomId === room.id ? true : null,
          onclick: () => { confirmDeleteId = room.id; autofocusRoomId = room.id; renderRooms(); }
        }, icon('trash'))
      );
    }
    list.append(item);
  });

  const target = list.querySelector('[data-autofocus]');
  if (target) target.focus();
  autofocusRoomId = null;
}

// ================= Render chat =================

function parseSections(text) {
  const sections = [{ label: null, lines: [] }];
  let current = sections[0];
  for (const line of text.split(/\r?\n/)) {
    const match = HEADING_RE.exec(line);
    if (match) {
      const name = SECTION_NAMES.find((n) => n.toLowerCase() === match[1].toLowerCase());
      current = { label: name, lines: [] };
      const rest = match[2].trim();
      if (rest) current.lines.push(rest);
      sections.push(current);
    } else {
      current.lines.push(line);
    }
  }
  const result = sections
    .map((s) => ({ label: s.label, body: s.lines.join('\n').trim() }))
    .filter((s) => s.label || s.body);
  return result.some((s) => s.label) ? result : null;
}

async function copyText(text, button) {
  try {
    await navigator.clipboard.writeText(text);
  } catch (err) {
    setStatus('Gagal menyalin ke clipboard.', 'error');
    return;
  }
  button.replaceChildren(icon('check'), h('span', { text: 'Disalin' }));
  setTimeout(() => button.replaceChildren(icon('copy'), h('span', { text: 'Salin' })), 1800);
}

function buildUserBubble(text) {
  return h('div', { class: 'bubble-user', text });
}

function buildAiCard(text) {
  const copyBtn = h('button', {
    type: 'button', class: 'btn btn-sm', 'aria-label': 'Salin seluruh Master Prompt',
    onclick: () => copyText(text, copyBtn)
  }, icon('copy'), h('span', { text: 'Salin' }));

  const body = h('div', { class: 'card-body' });
  const sections = parseSections(text);
  if (sections) {
    sections.forEach((s) => {
      const section = h('section', { class: 'section' });
      if (s.label) section.append(h('h3', { class: 'section-label', text: s.label }));
      const p = h('p', { class: 'section-body' });
      appendInline(p, s.body);
      section.append(p);
      body.append(section);
    });
  } else {
    const p = h('p', { class: 'section-body' });
    appendInline(p, text);
    body.append(h('section', { class: 'section' }, p));
  }

  return h('article', { class: 'card', 'aria-label': 'Master Prompt' },
    h('header', { class: 'card-head' },
      h('span', { class: 'card-title' }, icon('spark'), 'Master Prompt'),
      copyBtn),
    body);
}

function buildEmptyState() {
  return h('div', { class: 'empty' },
    h('span', { class: 'empty-mark' }, icon('spark')),
    h('p', { class: 'empty-title', text: 'Belum ada prompt di room ini' }),
    h('p', { text: 'Tulis ide kasar di kolom bawah. Hasilnya berupa Master Prompt enam bagian. Kirim instruksi lanjutan untuk merevisinya.' })
  );
}

function appendNotice(message) {
  els.chatBox.append(h('div', { class: 'notice', role: 'alert' }, icon('alert'), h('span', { text: message })));
  scrollChatToBottom();
}

function renderChat() {
  const box = els.chatBox;
  box.replaceChildren();
  const room = currentRoom();
  if (!room) return;
  const entry = pending.get(room.id);

  if (!room.history.length && !entry) {
    box.append(buildEmptyState());
    return;
  }
  room.history.forEach((msg) => {
    const text = msg.parts[0].text;
    box.append(msg.role === 'user' ? buildUserBubble(text) : buildAiCard(text));
  });
  if (entry) {
    box.append(
      buildUserBubble(entry.text),
      h('div', { class: 'typing' }, icon('loader', 'spin'), 'Menyusun prompt...')
    );
  }
  scrollChatToBottom();
}

function syncComposer() {
  const busy = pending.has(state.currentRoomId);
  els.sendBtn.replaceChildren(icon(busy ? 'stop' : 'send'), h('span', { text: busy ? 'Batal' : 'Kirim' }));
  els.sendBtn.classList.toggle('btn-primary', !busy);
  els.sendBtn.classList.toggle('btn-danger', busy);
  els.sendBtn.setAttribute('aria-label', busy ? 'Batalkan permintaan' : 'Kirim instruksi');
  els.userPrompt.readOnly = busy;
}

// ================= Pengaturan =================

function fillSelect(select, options, value) {
  select.replaceChildren(
    ...Object.entries(options).map(([val, label]) => h('option', { value: val, text: label }))
  );
  select.value = value;
}

function readSettingsFromUI() {
  return normalizeSettings({ model: els.geminiModel.value, effort: els.effortLevel.value });
}

async function saveSettings() {
  state.settings = readSettingsFromUI();
  try {
    await chrome.storage.local.set({ gemini_api_key: els.apiKey.value.trim(), settings: state.settings });
  } catch (err) {
    setStatus('Gagal menyimpan pengaturan.', 'error');
  }
}

function toggleKeyVisibility() {
  const show = els.apiKey.type === 'password';
  els.apiKey.type = show ? 'text' : 'password';
  els.toggleKeyBtn.setAttribute('aria-pressed', String(show));
  els.toggleKeyBtn.setAttribute('aria-label', show ? 'Sembunyikan API key' : 'Tampilkan API key');
  els.toggleKeyBtn.replaceChildren(icon(show ? 'eye-off' : 'eye'));
}

async function clearKey() {
  els.apiKey.value = '';
  try {
    await chrome.storage.local.remove('gemini_api_key');
    setStatus('API key dihapus dari perangkat ini.', 'ok');
  } catch (err) {
    setStatus('Gagal menghapus API key.', 'error');
  }
  els.apiKey.focus();
}

// ================= Gemini API =================

function buildSystemInstruction(isRevision) {
  const base = [
    'Anda adalah Master Prompt Engineer tingkat lanjut.',
    'Ubah ide pengguna menjadi Master Prompt yang komprehensif dan siap dipakai. Tulis dalam bahasa yang sama dengan ide pengguna.',
    'Keluaran HANYA berisi enam bagian berikut. Awali tiap bagian dengan satu baris judul persis seperti tertulis (kurung siku, tanpa nomor, tanpa tanda bintang), lalu isinya di baris berikutnya:',
    '[Role]',
    '[Task]',
    '[Context]',
    '[Reasoning]',
    '[Stop]',
    '[Output]',
    'Role berisi peran dan keahlian AI. Task berisi tugas utama yang dieksekusi. Context berisi latar belakang. Reasoning berisi instruksi berpikir bertahap. Stop berisi batasan ketat. Output berisi format hasil akhir.',
    'Jangan menambahkan pembuka, penutup, basa-basi, atau blok kode pembungkus.'
  ].join('\n');

  if (!isRevision) return base;
  return base + '\n\nIni lanjutan sesi. Revisi Master Prompt terakhir sesuai instruksi terbaru pengguna. Tetap keluarkan keenam bagian secara utuh, termasuk bagian yang tidak berubah, supaya hasilnya langsung bisa disalin sebagai prompt lengkap.';
}

function describeHttpError(status, apiMessage) {
  const known = {
    400: 'Permintaan tidak valid.',
    401: 'API key ditolak.',
    403: 'API key tidak punya akses ke model ini atau diblokir.',
    404: 'Model tidak ditemukan.',
    429: 'Kuota atau batas laju terlampaui. Tunggu sebentar lalu coba lagi.'
  };
  const base = known[status] || (status >= 500 ? 'Server Gemini sedang bermasalah.' : 'Permintaan gagal.');
  return apiMessage ? `${base} (${status}: ${apiMessage})` : `${base} (${status})`;
}

function extractReply(data) {
  const blockReason = data && data.promptFeedback && data.promptFeedback.blockReason;
  if (blockReason) {
    throw new AppError(`Permintaan diblokir oleh filter Gemini (${blockReason}). Ubah isi instruksi lalu coba lagi.`);
  }
  const candidate = data && Array.isArray(data.candidates) ? data.candidates[0] : null;
  if (!candidate) throw new AppError('API tidak mengembalikan kandidat jawaban.');

  const parts = candidate.content && Array.isArray(candidate.content.parts) ? candidate.content.parts : [];
  const text = parts
    .filter((p) => typeof p.text === 'string' && !p.thought)
    .map((p) => p.text)
    .join('')
    .trim();

  if (!text) {
    const reason = candidate.finishReason;
    throw new AppError(reason && reason !== 'STOP'
      ? `Jawaban kosong (finishReason: ${reason}).`
      : 'Jawaban kosong dari API.');
  }
  return { text, truncated: candidate.finishReason === 'MAX_TOKENS' };
}

async function callGemini({ apiKey, model, effort, history, text, isRevision, signal }) {
  const body = {
    systemInstruction: { parts: [{ text: buildSystemInstruction(isRevision) }] },
    contents: [...history, { role: 'user', parts: [{ text }] }],
    generationConfig: { thinkingConfig: { thinkingLevel: effort } }
  };

  let response;
  try {
    response = await fetch(`${API_BASE}${encodeURIComponent(model)}:generateContent`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-goog-api-key': apiKey },
      body: JSON.stringify(body),
      signal
    });
  } catch (err) {
    if (err && err.name === 'AbortError') throw err;
    throw new AppError('Tidak bisa terhubung ke Gemini. Periksa koneksi internet.');
  }

  const data = await response.json().catch(() => null);
  if (!response.ok) {
    throw new AppError(describeHttpError(response.status, data && data.error && data.error.message));
  }
  return extractReply(data);
}

function describeError(err, entry) {
  if (err && err.name === 'AbortError') {
    return entry.timedOut ? `Permintaan melewati batas waktu ${REQUEST_TIMEOUT_MS / 1000} detik.` : null;
  }
  if (err instanceof AppError) return err.message;
  return `Kesalahan tak terduga: ${err && err.message ? err.message : err}`;
}

// ================= Kirim =================

function cancelRequest() {
  const entry = pending.get(state.currentRoomId);
  if (!entry) return;
  entry.cancelled = true;
  entry.controller.abort();
}

async function sendMessage() {
  const room = currentRoom();
  if (!room || pending.has(room.id)) return;

  const apiKey = els.apiKey.value.trim();
  const text = els.userPrompt.value.trim();

  if (!apiKey) {
    setSettingsOpen(true, false);
    els.apiKey.focus();
    setStatus('Masukkan Gemini API key lebih dulu.', 'error');
    return;
  }
  if (!/^[\x21-\x7E]+$/.test(apiKey)) {
    setSettingsOpen(true, false);
    els.apiKey.focus();
    setStatus('API key mengandung karakter yang tidak valid.', 'error');
    return;
  }
  if (!text) return;

  await saveSettings();
  const settings = state.settings;
  const isRevision = room.history.length > 0;
  const entry = { controller: new AbortController(), text, timedOut: false, cancelled: false };
  pending.set(room.id, entry);
  els.userPrompt.value = '';
  setStatus('');
  renderChat();
  syncComposer();

  const timer = setTimeout(() => {
    entry.timedOut = true;
    entry.controller.abort();
  }, REQUEST_TIMEOUT_MS);

  try {
    const reply = await callGemini({
      apiKey,
      model: settings.model,
      effort: settings.effort,
      history: room.history,
      text,
      isRevision,
      signal: entry.controller.signal
    });

    if (!state.rooms.includes(room)) return; // room dihapus saat request berjalan

    const wasEmpty = room.history.length === 0;
    room.history.push({ role: 'user', parts: [{ text }] }, { role: 'model', parts: [{ text: reply.text }] });
    if (wasEmpty) room.title = makeTitle(text);
    room.updatedAt = Date.now();
    trimHistory(room);
    pending.delete(room.id);
    await persist();

    if (state.currentRoomId === room.id) {
      renderChat();
      updateTitle();
    } else {
      setStatus(`Jawaban untuk room "${room.title}" sudah siap.`, 'ok');
    }
    if (reply.truncated) {
      setStatus('Jawaban terpotong karena batas token. Kirim instruksi revisi untuk melengkapinya.', 'warn');
    }
  } catch (err) {
    pending.delete(room.id);
    const message = describeError(err, entry);
    if (!message && entry.cancelled) setStatus('Permintaan dibatalkan.', 'ok');
    if (state.rooms.includes(room)) {
      if (state.currentRoomId === room.id) {
        renderChat();
        if (message) appendNotice(message);
        if (!els.userPrompt.value) els.userPrompt.value = text;
      } else if (message) {
        setStatus(`Room "${room.title}": ${message}`, 'error');
      }
    }
  } finally {
    clearTimeout(timer);
    pending.delete(room.id);
    syncComposer();
    if (state.currentRoomId === room.id && els.roomsPanel.hidden) els.userPrompt.focus();
  }
}

// ================= Inisialisasi =================

async function init() {
  ELEMENT_IDS.forEach((id) => { els[id] = document.getElementById(id); });

  let stored = {};
  try {
    stored = await chrome.storage.local.get(STORAGE_KEYS);
  } catch (err) {
    setStatus('Gagal membaca penyimpanan lokal.', 'error');
  }

  els.apiKey.value = typeof stored.gemini_api_key === 'string' ? stored.gemini_api_key : '';
  state.settings = normalizeSettings(stored.settings);
  fillSelect(els.geminiModel, MODELS, state.settings.model);
  fillSelect(els.effortLevel, EFFORTS, state.settings.effort);

  state.rooms = sanitizeRooms(stored.rooms);
  let active = state.rooms.find((r) => r.id === stored.currentRoomId) || latestRoom();
  if (!active) {
    active = createRoom();
    state.rooms.push(active);
  }
  state.currentRoomId = active.id;
  state.rooms = state.rooms.filter((r) => r.history.length > 0 || r === active);

  els.roomsToggleBtn.addEventListener('click', openRooms);
  els.closeRoomsBtn.addEventListener('click', () => closeRooms(true));
  els.newRoomBtn.addEventListener('click', startNewRoom);
  els.settingsToggleBtn.addEventListener('click', () => setSettingsOpen(els.settingsPanel.hidden, false));
  els.toggleKeyBtn.addEventListener('click', toggleKeyVisibility);
  els.clearKeyBtn.addEventListener('click', clearKey);
  [els.apiKey, els.geminiModel, els.effortLevel].forEach((el) => el.addEventListener('change', saveSettings));
  els.sendBtn.addEventListener('click', () => (pending.has(state.currentRoomId) ? cancelRequest() : sendMessage()));

  els.userPrompt.addEventListener('keydown', (event) => {
    if ((event.ctrlKey || event.metaKey) && event.key === 'Enter' && !event.isComposing) {
      event.preventDefault();
      if (!pending.has(state.currentRoomId)) sendMessage();
    }
  });

  document.addEventListener('keydown', (event) => {
    if (event.key !== 'Escape') return;
    if (!els.roomsPanel.hidden) closeRooms(true);
    else if (!els.settingsPanel.hidden) setSettingsOpen(false, true);
  });

  updateTitle();
  renderChat();
  syncComposer();
  persist();
}

init();