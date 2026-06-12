/**
 * storage.js — Capa de Persistencia Local v4.1
 * Music Play! Suite · E.M.M. Tordesillas
 *
 * Responsabilidades:
 *   - Guardar/leer configuracion del docente (nombre, tono, asignatura)
 *   - CRUD de presets de prompts personalizados
 *   - Registro de reportes de diagnostico WebGPU
 *   - Resistencia a datos corruptos (JSON invalido en localStorage)
 */

// --- Claves localStorage ---
const KEYS = {
  SETTINGS:    'mps_settings_v4',
  PROMPTS:     'mps_prompts_v4',
  DIAGNOSTICS: 'webllm_diagnostics',
  STRESS:      'webllm_stress_probe',
};

// --- Defaults ---
const DEFAULT_SETTINGS = {
  teacherName:  'Docente',
  tone:         'empatico',
  subject:      'Lenguaje Musical',
  level:        'elemental',
  quizPrompt:   '',
  feedbackPrompt: '',
};

// --- 1. Configuracion General ---

export function loadSettings() {
  try {
    const raw = localStorage.getItem(KEYS.SETTINGS);
    if (!raw) return { ...DEFAULT_SETTINGS };
    const parsed = JSON.parse(raw);
    // Merge con defaults para campos nuevos en actualizaciones
    return { ...DEFAULT_SETTINGS, ...parsed };
  } catch (e) {
    console.warn('[storage] loadSettings: JSON corrupto, restaurando defaults.', e.message);
    return { ...DEFAULT_SETTINGS };
  }
}

export function saveSettings(settings) {
  try {
    const merged = { ...DEFAULT_SETTINGS, ...settings };
    localStorage.setItem(KEYS.SETTINGS, JSON.stringify(merged));
    return true;
  } catch (e) {
    console.error('[storage] saveSettings fallo:', e.message);
    return false;
  }
}

export function clearSettings() {
  localStorage.removeItem(KEYS.SETTINGS);
}

// --- 2. Presets de Prompts ---

export function loadPromptPresets() {
  try {
    const raw = localStorage.getItem(KEYS.PROMPTS);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch (e) {
    console.warn('[storage] loadPromptPresets: JSON corrupto.', e.message);
    return [];
  }
}

export function savePromptPreset({ id, name, prompt, type }) {
  const presets = loadPromptPresets();
  const idx = presets.findIndex(p => p.id === id);
  const entry = { id: id || `preset_${Date.now()}`, name, prompt, type, updatedAt: new Date().toISOString() };
  if (idx >= 0) presets[idx] = entry;
  else presets.push(entry);
  try {
    localStorage.setItem(KEYS.PROMPTS, JSON.stringify(presets));
    return entry;
  } catch (e) {
    console.error('[storage] savePromptPreset fallo:', e.message);
    return null;
  }
}

export function deletePromptPreset(id) {
  const presets = loadPromptPresets().filter(p => p.id !== id);
  try {
    localStorage.setItem(KEYS.PROMPTS, JSON.stringify(presets));
    return true;
  } catch (e) {
    return false;
  }
}

// --- 3. Reportes de Diagnostico ---

export function saveDeviceReport(report) {
  const reports = loadDeviceReports();
  reports.push({ ...report, savedAt: new Date().toISOString() });
  // Mantener solo los ultimos 10 reportes
  const trimmed = reports.slice(-10);
  try {
    localStorage.setItem(KEYS.DIAGNOSTICS, JSON.stringify(trimmed));
    return true;
  } catch (e) {
    return false;
  }
}

export function loadDeviceReports() {
  try {
    const raw = localStorage.getItem(KEYS.DIAGNOSTICS);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [parsed];
  } catch (e) {
    return [];
  }
}

export function getLatestReport() {
  const reports = loadDeviceReports();
  return reports.length > 0 ? reports[reports.length - 1] : null;
}

// --- 4. Utilidad: Solicitar Persistencia ---

export async function requestPersistence() {
  if (!navigator.storage?.persist) return false;
  try {
    const granted = await navigator.storage.persist();
    console.info('[storage] Persistencia de almacenamiento:', granted ? 'concedida' : 'denegada');
    return granted;
  } catch (e) {
    console.warn('[storage] requestPersistence fallo:', e.message);
    return false;
  }
}

// --- 5. Exportar diagnostico como JSON descargable ---

export function exportDiagnosticsToJSON() {
  const data = {
    settings:   loadSettings(),
    reports:    loadDeviceReports(),
    stressProbe: (() => {
      try { return JSON.parse(localStorage.getItem(KEYS.STRESS) || 'null'); } catch { return null; }
    })(),
    exportedAt: new Date().toISOString(),
  };
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
  const url  = URL.createObjectURL(blob);
  const a    = Object.assign(document.createElement('a'), {
    href: url, download: `mps_diagnostics_${Date.now()}.json`
  });
  a.click();
  URL.revokeObjectURL(url);
}
