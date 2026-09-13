/* ============================================================
   NutriAI — app.js
   AI-powered Nutrition Tracker
   Uses OpenRouter API (vision model) to extract nutrition data
   Stores all logs in localStorage
   ============================================================ */

// ─── CONSTANTS ───────────────────────────────────────────────
const STORAGE_KEYS = {
  LOGS: 'nutriai_logs',
  SETTINGS: 'nutriai_settings',
};

const DEFAULT_SETTINGS = {
  apiKey: '',
  endpoint: 'https://openrouter.ai/api/v1/chat/completions',
  model: 'google/gemini-2.0-flash-exp:free',
  goals: { calories: 2000, protein: 50, carbs: 250, fat: 65 },
};

// Preset endpoints for quick selection
const ENDPOINT_PRESETS = [
  { label: 'OpenRouter',        url: 'https://openrouter.ai/api/v1/chat/completions' },
  { label: 'OpenAI',            url: 'https://api.openai.com/v1/chat/completions' },
  { label: 'Groq',              url: 'https://api.groq.com/openai/v1/chat/completions' },
  { label: 'Together AI',       url: 'https://api.together.xyz/v1/chat/completions' },
  { label: 'Ollama (local)',     url: 'http://localhost:11434/v1/chat/completions' },
  { label: 'LM Studio (local)', url: 'http://localhost:1234/v1/chat/completions' },
  { label: 'Custom…',           url: '' },
];

const AI_PROMPT = `You are a professional nutrition analyst. Analyze the food label or meal image provided and extract all nutritional information.

Respond ONLY with a valid JSON object using this exact schema:
{
  "foodName": "Name of the food product or meal",
  "servingSize": "e.g. 1 serving (240g) or 100g",
  "nutrients": {
    "calories": <number or null>,
    "protein": <number or null>,
    "carbs": <number or null>,
    "fat": <number or null>,
    "fiber": <number or null>,
    "sugar": <number or null>,
    "sodium": <number or null>,
    "saturatedFat": <number or null>,
    "cholesterol": <number or null>
  },
  "notes": "Any important notes about this food, health tips, or warnings (max 2 sentences). Leave empty string if none.",
  "confidence": "high | medium | low"
}

Rules:
- All numeric values are per SERVING (not per 100g unless that is the serving).
- Use null for nutrients you cannot determine.
- If the image is NOT a food label or meal, set foodName to "Unknown" and confidence to "low".
- Do NOT wrap in markdown code blocks — raw JSON only.`;

// ─── STATE ───────────────────────────────────────────────────
let settings = loadSettings();
let currentImageBase64 = null;
let currentResult = null;

// ─── STORAGE HELPERS ─────────────────────────────────────────
function loadSettings() {
  try {
    const raw = localStorage.getItem(STORAGE_KEYS.SETTINGS);
    if (!raw) return { ...DEFAULT_SETTINGS };
    return { ...DEFAULT_SETTINGS, ...JSON.parse(raw) };
  } catch { return { ...DEFAULT_SETTINGS }; }
}

function saveSettings() {
  localStorage.setItem(STORAGE_KEYS.SETTINGS, JSON.stringify(settings));
}

function loadLogs() {
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEYS.LOGS)) || [];
  } catch { return []; }
}

function saveLogs(logs) {
  localStorage.setItem(STORAGE_KEYS.LOGS, JSON.stringify(logs));
}

function getTodayKey() {
  return new Date().toISOString().slice(0, 10); // YYYY-MM-DD
}

function getTodayLogs() {
  const key = getTodayKey();
  return loadLogs().filter(l => l.date === key);
}

function addLog(entry) {
  const logs = loadLogs();
  logs.push(entry);
  saveLogs(logs);
}

function deleteLog(id) {
  const logs = loadLogs().filter(l => l.id !== id);
  saveLogs(logs);
}

// ─── DOM HELPERS ─────────────────────────────────────────────
const $ = id => document.getElementById(id);

function showToast(msg, type = 'info', duration = 2800) {
  const t = $('toast');
  if (!t) return;
  t.textContent = msg;
  t.className = `toast show ${type}`;
  clearTimeout(t._timer);
  t._timer = setTimeout(() => { t.classList.remove('show'); }, duration);
}

function formatTime(isoString) {
  return new Date(isoString).toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' });
}

function formatDate(dateKey) {
  const d = new Date(dateKey + 'T00:00:00');
  return d.toLocaleDateString('id-ID', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
}

// ─── IMAGE HELPERS ───────────────────────────────────────────
function fileToBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = e => {
      // strip data URL prefix, keep only base64 string
      const base64 = e.target.result.split(',')[1];
      resolve({ base64, mimeType: file.type || 'image/jpeg' });
    };
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

// ─── AI ANALYSIS ─────────────────────────────────────────────
async function analyzeImage(base64, mimeType) {
  const { apiKey, endpoint, model } = settings;
  if (!apiKey) throw new Error('API Key belum diatur. Buka ⚙️ Pengaturan untuk memasukkan API key.');
  if (!endpoint) throw new Error('Endpoint belum diatur. Buka ⚙️ Pengaturan.');

  const payload = {
    model,
    messages: [
      {
        role: 'user',
        content: [
          { type: 'text', text: AI_PROMPT },
          { type: 'image_url', image_url: { url: `data:${mimeType};base64,${base64}` } },
        ],
      },
    ],
    temperature: 0.1,
  };

  const response = await fetch(endpoint, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    const err = await response.json().catch(() => ({}));
    const msg = err?.error?.message || `HTTP ${response.status}`;
    throw new Error(`API Error: ${msg}`);
  }

  const data = await response.json();
  const raw = data.choices?.[0]?.message?.content?.trim();
  if (!raw) throw new Error('AI tidak menghasilkan respons.');

  // Strip potential markdown code fences if model wraps anyway
  const cleaned = raw.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '');

  try {
    return JSON.parse(cleaned);
  } catch {
    throw new Error('AI menghasilkan format yang tidak valid. Coba foto label yang lebih jelas.');
  }
}

// ─── RENDER RESULT ───────────────────────────────────────────
function renderResult(result) {
  currentResult = result;
  const { foodName, servingSize, nutrients, notes, confidence } = result;
  const n = nutrients || {};

  $('resultFoodName').textContent = foodName || 'Makanan Tidak Dikenal';
  $('resultServing').textContent = servingSize
    ? `Porsi: ${servingSize}  •  Kepercayaan AI: ${confidence || '?'}`
    : `Kepercayaan AI: ${confidence || '?'}`;

  const chips = [
    { key: 'calories',     label: 'Kalori',       unit: 'kcal', cls: 'cal' },
    { key: 'protein',      label: 'Protein',       unit: 'g',    cls: 'protein' },
    { key: 'carbs',        label: 'Karbo',         unit: 'g',    cls: 'carbs' },
    { key: 'fat',          label: 'Lemak',         unit: 'g',    cls: 'fat' },
    { key: 'fiber',        label: 'Serat',         unit: 'g',    cls: 'fiber' },
    { key: 'sugar',        label: 'Gula',          unit: 'g',    cls: 'sugar' },
    { key: 'sodium',       label: 'Sodium',        unit: 'mg',   cls: 'sodium' },
    { key: 'saturatedFat', label: 'L.Jenuh',       unit: 'g',    cls: 'fat' },
    { key: 'cholesterol',  label: 'Kolesterol',    unit: 'mg',   cls: 'fat' },
  ];

  const nutrEl = $('resultNutrients');
  nutrEl.innerHTML = chips
    .filter(c => n[c.key] !== null && n[c.key] !== undefined)
    .map(c => `
      <div class="nutrient-chip ${c.cls}">
        <span class="nutrient-chip-label">${c.label}</span>
        <span class="nutrient-chip-value">${n[c.key]}<small style="font-size:0.65em;opacity:0.7"> ${c.unit}</small></span>
      </div>`)
    .join('');

  const notesEl = $('resultNotes');
  if (notes) {
    notesEl.textContent = '💡 ' + notes;
    notesEl.classList.add('visible');
  } else {
    notesEl.classList.remove('visible');
  }

  $('resultCard').style.display = 'block';
}

// ─── RENDER TODAY LOG ────────────────────────────────────────
function renderTodayLog() {
  const logs = getTodayLogs();
  const listEl = $('logList');
  const emptyEl = $('logEmpty');

  // Compute totals
  let totals = { calories: 0, protein: 0, carbs: 0, fat: 0 };
  logs.forEach(l => {
    const n = l.nutrients || {};
    totals.calories += n.calories || 0;
    totals.protein  += n.protein  || 0;
    totals.carbs    += n.carbs    || 0;
    totals.fat      += n.fat      || 0;
  });

  // Update summary cards
  $('totalCalories').textContent = Math.round(totals.calories);
  $('totalProtein').textContent  = Math.round(totals.protein);
  $('totalCarbs').textContent    = Math.round(totals.carbs);
  $('totalFat').textContent      = Math.round(totals.fat);

  const g = settings.goals || DEFAULT_SETTINGS.goals;
  const pct = (val, goal) => Math.min(100, Math.round((val / goal) * 100)) + '%';
  $('barCalories').style.width = pct(totals.calories, g.calories);
  $('barProtein').style.width  = pct(totals.protein,  g.protein);
  $('barCarbs').style.width    = pct(totals.carbs,    g.carbs);
  $('barFat').style.width      = pct(totals.fat,      g.fat);

  // Update goal displays
  $('goalCalories').textContent = g.calories;
  $('goalProtein').textContent  = g.protein;
  $('goalCarbs').textContent    = g.carbs;
  $('goalFat').textContent      = g.fat;

  // Render log list
  if (logs.length === 0) {
    listEl.innerHTML = '';
    if (emptyEl) emptyEl.style.display = '';
    listEl.appendChild(emptyEl || createEmptyEl());
    return;
  }

  if (emptyEl) emptyEl.style.display = 'none';

  // Rebuild list items (keep existing ones by id to avoid flicker)
  const existingIds = new Set([...listEl.querySelectorAll('.log-item')].map(el => el.dataset.id));
  const newIds = new Set(logs.map(l => l.id));

  // Remove deleted
  listEl.querySelectorAll('.log-item').forEach(el => {
    if (!newIds.has(el.dataset.id)) el.remove();
  });

  // Add new
  logs.forEach(log => {
    if (existingIds.has(log.id)) return;
    const n = log.nutrients || {};
    const el = document.createElement('div');
    el.className = 'log-item';
    el.dataset.id = log.id;
    el.innerHTML = `
      <span class="log-item-time">${formatTime(log.timestamp)}</span>
      <div style="flex:1;min-width:0">
        <div class="log-item-name">${escapeHtml(log.foodName)}</div>
        <div class="log-item-serving">${escapeHtml(log.servingSize || '')}</div>
      </div>
      <div class="log-item-nutrients">
        <div class="log-nutrient cal">
          <span class="log-nutrient-val">${Math.round(n.calories ?? 0)}</span>
          <span class="log-nutrient-lbl">kcal</span>
        </div>
        <div class="log-nutrient prot">
          <span class="log-nutrient-val">${Math.round(n.protein ?? 0)}g</span>
          <span class="log-nutrient-lbl">prot</span>
        </div>
        <div class="log-nutrient carb">
          <span class="log-nutrient-val">${Math.round(n.carbs ?? 0)}g</span>
          <span class="log-nutrient-lbl">karbo</span>
        </div>
        <div class="log-nutrient fat">
          <span class="log-nutrient-val">${Math.round(n.fat ?? 0)}g</span>
          <span class="log-nutrient-lbl">lemak</span>
        </div>
      </div>
      <button class="log-item-del" title="Hapus" data-id="${log.id}">🗑</button>
    `;
    listEl.prepend(el);
  });

  // Re-sort (most recent on top, already sorted by prepend order)
  const sorted = [...listEl.querySelectorAll('.log-item')];
  sorted.sort((a, b) => {
    const la = logs.find(l => l.id === a.dataset.id);
    const lb = logs.find(l => l.id === b.dataset.id);
    return new Date(lb?.timestamp) - new Date(la?.timestamp);
  });
  sorted.forEach(el => listEl.appendChild(el));
}

function createEmptyEl() {
  const el = document.createElement('div');
  el.className = 'log-empty';
  el.id = 'logEmpty';
  el.textContent = 'Belum ada makanan yang dicatat hari ini. Mulai scan label nutrisi! 🍽️';
  return el;
}

function escapeHtml(str) {
  return String(str).replace(/[&<>"']/g, c => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[c]));
}

// ─── SETTINGS ────────────────────────────────────────────────
function openSettings() {
  $('apiKeyInput').value    = settings.apiKey    || '';
  $('endpointInput').value  = settings.endpoint  || DEFAULT_SETTINGS.endpoint;
  $('modelInput').value     = settings.model     || DEFAULT_SETTINGS.model;

  // Sync preset selector
  const sel = $('endpointPreset');
  if (sel) {
    const match = ENDPOINT_PRESETS.find(p => p.url === (settings.endpoint || DEFAULT_SETTINGS.endpoint));
    sel.value = match ? match.url : '';
  }

  const g = settings.goals || DEFAULT_SETTINGS.goals;
  $('goalCalInput').value     = g.calories;
  $('goalProteinInput').value = g.protein;
  $('goalCarbsInput').value   = g.carbs;
  $('goalFatInput').value     = g.fat;
  $('settingsModal').style.display = 'flex';
}

function closeSettings() {
  $('settingsModal').style.display = 'none';
}

function applySettings() {
  const endpoint = $('endpointInput').value.trim();
  if (endpoint && !/^https?:\/\/.+/.test(endpoint)) {
    showToast('Endpoint harus berupa URL valid (http/https).', 'error');
    return;
  }
  settings.apiKey   = $('apiKeyInput').value.trim();
  settings.endpoint = endpoint || DEFAULT_SETTINGS.endpoint;
  settings.model    = $('modelInput').value.trim() || DEFAULT_SETTINGS.model;
  settings.goals    = {
    calories: parseInt($('goalCalInput').value)     || 2000,
    protein:  parseInt($('goalProteinInput').value) || 50,
    carbs:    parseInt($('goalCarbsInput').value)   || 250,
    fat:      parseInt($('goalFatInput').value)     || 65,
  };
  saveSettings();
  closeSettings();
  renderTodayLog();
  showToast('✅ Pengaturan disimpan!', 'success');
}

// ─── API KEY BANNER ──────────────────────────────────────────
function renderApiKeyBanner() {
  if (settings.apiKey) return;
  const existing = document.querySelector('.no-api-banner');
  if (existing) return;
  const banner = document.createElement('div');
  banner.className = 'no-api-banner';
  banner.innerHTML = `
    <span>⚠️ API Key belum diatur — fitur AI tidak aktif.</span>
    <button id="bannerApiBtn">Set API Key</button>
  `;
  const scanSection = document.querySelector('.scan-section');
  if (scanSection) scanSection.prepend(banner);
  document.getElementById('bannerApiBtn')?.addEventListener('click', openSettings);
}

// ─── IMAGE HANDLING ──────────────────────────────────────────
function handleImageFile(file) {
  if (!file || !file.type.startsWith('image/')) {
    showToast('File harus berupa gambar!', 'error');
    return;
  }
  if (file.size > 10 * 1024 * 1024) {
    showToast('Ukuran gambar maksimal 10MB.', 'error');
    return;
  }

  fileToBase64(file).then(({ base64, mimeType }) => {
    currentImageBase64 = { base64, mimeType };
    const url = URL.createObjectURL(file);
    $('previewImg').src = url;
    $('uploadArea').style.display = 'none';
    $('previewArea').style.display = 'block';
    $('btnAnalyze').disabled = false;
    $('resultCard').style.display = 'none';
    currentResult = null;
  });
}

function clearImage() {
  currentImageBase64 = null;
  currentResult = null;
  $('previewImg').src = '';
  $('previewArea').style.display = 'none';
  $('uploadArea').style.display = '';
  $('btnAnalyze').disabled = true;
  $('resultCard').style.display = 'none';
}

// ─── ANALYZE HANDLER ─────────────────────────────────────────
async function handleAnalyze() {
  if (!currentImageBase64) return;
  if (!settings.apiKey) { openSettings(); return; }

  $('loadingState').style.display = 'flex';
  $('resultCard').style.display = 'none';
  $('btnAnalyze').disabled = true;
  $('analyzeText').textContent = 'Menganalisis...';
  $('analyzeIcon').textContent = '⏳';

  try {
    const result = await analyzeImage(currentImageBase64.base64, currentImageBase64.mimeType);
    $('loadingState').style.display = 'none';
    renderResult(result);
    showToast('🎉 Analisis selesai!', 'success');
  } catch (err) {
    $('loadingState').style.display = 'none';
    showToast(err.message || 'Terjadi kesalahan.', 'error', 4000);
  } finally {
    $('btnAnalyze').disabled = false;
    $('analyzeText').textContent = 'Analisis dengan AI';
    $('analyzeIcon').textContent = '🔍';
  }
}

// ─── SAVE LOG ─────────────────────────────────────────────────
function handleSaveLog() {
  if (!currentResult) return;
  const entry = {
    id: Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
    date: getTodayKey(),
    timestamp: new Date().toISOString(),
    foodName: currentResult.foodName || 'Makanan',
    servingSize: currentResult.servingSize || '',
    nutrients: currentResult.nutrients || {},
    confidence: currentResult.confidence || 'medium',
    notes: currentResult.notes || '',
  };
  addLog(entry);
  renderTodayLog();
  showToast('✅ Berhasil disimpan ke log!', 'success');
  clearImage();
}

// ─── EVENT LISTENERS ─────────────────────────────────────────
function initPage() {
  // Set today's date label
  const logDate = $('logDate');
  if (logDate) logDate.textContent = formatDate(getTodayKey());

  // Initial render
  renderTodayLog();
  renderApiKeyBanner();

  // Upload area click
  const uploadArea = $('uploadArea');
  const imageInput = $('imageInput');
  if (uploadArea) {
    uploadArea.addEventListener('click', () => imageInput.click());
    uploadArea.addEventListener('dragover', e => { e.preventDefault(); uploadArea.classList.add('drag-over'); });
    uploadArea.addEventListener('dragleave', () => uploadArea.classList.remove('drag-over'));
    uploadArea.addEventListener('drop', e => {
      e.preventDefault();
      uploadArea.classList.remove('drag-over');
      const f = e.dataTransfer.files[0];
      if (f) handleImageFile(f);
    });
  }

  if (imageInput) {
    imageInput.addEventListener('change', e => {
      const f = e.target.files[0];
      if (f) handleImageFile(f);
      e.target.value = ''; // reset so same file can be picked again
    });
  }

  // Camera button
  const btnCamera = $('btnCamera');
  if (btnCamera) {
    btnCamera.addEventListener('click', () => {
      const inp = document.createElement('input');
      inp.type = 'file';
      inp.accept = 'image/*';
      inp.capture = 'environment';
      inp.addEventListener('change', e => { const f = e.target.files[0]; if (f) handleImageFile(f); });
      inp.click();
    });
  }

  // Clear image
  $('btnClear')?.addEventListener('click', clearImage);

  // Analyze
  $('btnAnalyze')?.addEventListener('click', handleAnalyze);

  // Save log
  $('btnSave')?.addEventListener('click', handleSaveLog);

  // Discard result
  $('btnDiscard')?.addEventListener('click', () => {
    $('resultCard').style.display = 'none';
    currentResult = null;
  });

  // Settings
  $('btnSettings')?.addEventListener('click', openSettings);
  $('modalClose')?.addEventListener('click', closeSettings);
  $('btnSaveSettings')?.addEventListener('click', applySettings);
  $('settingsModal')?.addEventListener('click', e => { if (e.target === $('settingsModal')) closeSettings(); });

  // Delete log item (event delegation)
  $('logList')?.addEventListener('click', e => {
    const btn = e.target.closest('.log-item-del');
    if (!btn) return;
    const id = btn.dataset.id;
    deleteLog(id);
    renderTodayLog();
    showToast('🗑 Log dihapus.', 'info');
  });
}

// Run on DOMContentLoaded
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initPage);
} else {
  initPage();
}
