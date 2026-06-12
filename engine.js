/**
 * engine.js — Motor de Inferencia Local v4.1
 * Music Play! Suite · E.M.M. Tordesillas
 *
 * CORRECCIONES v4.1:
 *   - EN-03: Purga automatica por umbral en iOS (softUnload tras 3 inferencias)
 *   - EN-03: hardUnload() expuesto para boton manual de purga en UI
 *   - EN-03: Detector de plataforma movil con flag iPadOS
 *   - Gestion de errores de inferencia que propaga para activar fallback en UI
 */

import * as webllm from 'https://esm.run/@mlc-ai/web-llm';

// --- Constantes ---
const MODEL_ID        = 'gemma-2b-it-q4f16_1-MLC';
const CONTEXT_SIZE    = 2048;
const MAX_TOKENS      = 600;
const TEMPERATURE     = 0.4;
const PURGE_THRESHOLD = 3;

const DEFAULT_SYSTEM =
  'Eres un asistente pedagogico de la E.M.M. de Tordesillas (Espana). ' +
  'Respondes SIEMPRE en espanol, con tono empatico y constructivo. ' +
  'Cuando se te pida JSON, devuelves UNICAMENTE el array JSON sin texto adicional, ' +
  'sin bloques de codigo Markdown, sin saludos, sin explicaciones previas.';

// --- Estado interno ---
let _engine      = null;
let _engineState = 'UNLOADED';
let _envProfile  = null;
let _inferCount  = 0;
let _onProgress  = null;

// --- API Publica ---
export function createLocalLLMEngine({ onProgress } = {}) {
  _onProgress = onProgress || (() => {});
  return {
    checkEnvironment,
    initModel,
    generateCompletion,
    softUnload,
    hardUnload,
    runStressProbe,
    getState:   () => _engineState,
    getProfile: () => _envProfile,
  };
}

// --- 1. Deteccion de Entorno ---
async function checkEnvironment() {
  const result = {
    webgpu: false, mobile: _isMobile(), profile: 'NO_WEBGPU',
    adapterLimits: {}, timestamp: new Date().toISOString(), userAgent: navigator.userAgent,
  };
  if (!navigator.gpu) {
    _envProfile = 'NO_WEBGPU'; _engineState = 'FALLBACK';
    _persistDiagnostics(result); return result;
  }
  try {
    const adapter = await navigator.gpu.requestAdapter();
    if (!adapter) throw new Error('No GPU adapter');
    const lim = adapter.limits;
    result.adapterLimits = {
      maxBufferSize:                  lim.maxBufferSize,
      maxStorageBufferBindingSize:    lim.maxStorageBufferBindingSize,
      maxComputeWorkgroupStorageSize: lim.maxComputeWorkgroupStorageSize,
    };
    result.webgpu = true;
    const maxBuf = lim.maxStorageBufferBindingSize;
    result.profile = maxBuf >= 536870912 ? 'HIGH_TIER' : maxBuf >= 134217728 ? 'LOW_TIER' : 'NO_WEBGPU';
    if (result.profile === 'NO_WEBGPU') result.webgpu = false;
    _envProfile  = result.profile;
    _engineState = result.webgpu ? 'UNLOADED' : 'FALLBACK';
  } catch (e) {
    result.error = e.message; _envProfile = 'NO_WEBGPU'; _engineState = 'FALLBACK';
  }
  _persistDiagnostics(result);
  return result;
}

// --- 2. Inicializacion del Modelo ---
async function initModel() {
  if (_engineState === 'READY')    return { status: 'already_loaded' };
  if (_engineState === 'FALLBACK') return { status: 'fallback_active' };
  if (_engineState === 'LOADING')  return { status: 'already_loading' };
  _engineState = 'LOADING';
  const t0 = performance.now();
  try {
    if (navigator.storage?.persist) await navigator.storage.persist();
    _engine = new webllm.MLCEngine();
    _engine.setInitProgressCallback((r) => _onProgress({ progress: r.progress, text: r.text }));
    await _engine.reload(MODEL_ID, { context_window_size: CONTEXT_SIZE });
    const elapsed = Math.round(performance.now() - t0);
    _engineState = 'READY'; _inferCount = 0;
    return { status: 'loaded', elapsed };
  } catch (e) {
    _engineState = 'FALLBACK';
    return { status: 'error', message: e.message };
  }
}

// --- 3. Generacion de Texto ---
async function generateCompletion(userPrompt, systemMsg = DEFAULT_SYSTEM) {
  if (_engineState !== 'READY') {
    const init = await initModel();
    if (_engineState !== 'READY') throw new Error('Motor no disponible: ' + init.status);
  }
  _inferCount++;
  if (_isMobile() && _inferCount >= PURGE_THRESHOLD) {
    await softUnload(); _inferCount = 0;
  }
  try {
    const reply = await _engine.chat.completions.create({
      messages: [{ role: 'system', content: systemMsg }, { role: 'user', content: userPrompt }],
      max_tokens: MAX_TOKENS, temperature: TEMPERATURE,
    });
    return reply.choices[0].message.content;
  } catch (e) {
    await hardUnload();
    throw e;
  }
}

// --- 4. Gestion de Memoria ---
export async function softUnload() {
  if (_engine) { try { await _engine.resetChat(); } catch (_) {} }
}

export async function hardUnload() {
  if (_engine) {
    try { await _engine.unload(); } catch (_) {}
    _engine = null; _engineState = 'UNLOADED';
  }
}

// --- 5. Stress Probe ---
export async function runStressProbe() {
  const report = { timestamp: new Date().toISOString(), steps: [], passed: false };
  if (!navigator.gpu) { report.error = 'WebGPU no disponible'; return report; }
  const t0 = performance.now();
  try {
    const adapter = await navigator.gpu.requestAdapter();
    report.steps.push({ step: 'requestAdapter', ms: Math.round(performance.now() - t0) });
    const device = await adapter.requestDevice();
    report.steps.push({ step: 'requestDevice',  ms: Math.round(performance.now() - t0) });
    const sizes = [64, 128, 256, 512];
    for (const mb of sizes) {
      try {
        const buf = device.createBuffer({ size: mb * 1024 * 1024, usage: GPUBufferUsage.STORAGE });
        buf.destroy();
        report.steps.push({ step: `buffer_${mb}MB`, result: 'ok' });
      } catch (e) {
        report.steps.push({ step: `buffer_${mb}MB`, result: 'fail', error: e.message }); break;
      }
    }
    report.passed = true;
  } catch (e) { report.error = e.message; }
  localStorage.setItem('webllm_stress_probe', JSON.stringify(report));
  return report;
}

// --- Utilidades privadas ---
function _isMobile() {
  return /iPhone|iPad|iPod|Android/i.test(navigator.userAgent) ||
         (navigator.maxTouchPoints > 1 && navigator.platform === 'MacIntel');
}

function _persistDiagnostics(data) {
  try { localStorage.setItem('webllm_diagnostics', JSON.stringify(data)); } catch (_) {}
}
