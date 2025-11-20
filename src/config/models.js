import fs from 'fs';
import path from 'path';
import os from 'os';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Central configuration loader for model settings.
// Precedence: environment variables override settings.json entries.
// settings.json path adapts based on Electron vs CLI mode.

// Access resource resolver from global (set by main process in Electron)
const getResourceResolver = () => global.resourceResolver;

// Lazy path resolution - determines correct settings.json location
let SETTINGS_PATH = null;
let _cachedConfig = null;
let _lastMTime = 0;

function _getSettingsPath() {
  if (SETTINGS_PATH) return SETTINGS_PATH;
  
  const resolver = getResourceResolver();
  
  if (resolver) {
    // Electron mode - use ~/.deepclause/config/settings.json
    SETTINGS_PATH = path.join(os.homedir(), '.deepclause', 'config', 'settings.json');
    console.log(`[Models] Using Electron settings path: ${SETTINGS_PATH}`);
  } else {
    // CLI mode - use project config
    // First check if settings.json exists in the same directory as this file (deployed mode)
    const localSettings = path.join(__dirname, 'settings.json');
    if (fs.existsSync(localSettings)) {
      SETTINGS_PATH = localSettings;
      console.log(`[Models] Using local settings path: ${SETTINGS_PATH}`);
    } else {
      SETTINGS_PATH = path.resolve(process.cwd(), 'config', 'settings.json');
      console.log(`[Models] Using CLI settings path: ${SETTINGS_PATH}`);
    }
  }
  
  return SETTINGS_PATH;
}

function _readSettings() {
  try {
    // Initialize config
    let config = {};
    let settingsLoaded = false;

    // 1. Try to load settings.json (Base configuration)
    // In deployed app: server/runtime/config/settings.json (same dir as this file)
    // In CLI: config/settings.json
    try {
        const settingsPath = _getSettingsPath(); // Get path lazily
        if (fs.existsSync(settingsPath)) {
            const stat = fs.statSync(settingsPath);
            // Only reload if changed or not cached (but we need to merge with deployment config every time if we don't cache the merge)
            // For simplicity, we'll read it if we don't have a cached config or if we want to be sure
            const raw = fs.readFileSync(settingsPath, 'utf-8');
            config = JSON.parse(raw);
            settingsLoaded = true;
            // console.log(`[Models] Loaded base settings from: ${settingsPath}`);
        }
    } catch (e) {
        // console.warn('[Models] Failed to load settings.json:', e.message);
    }

    _cachedConfig = config;

    // 3. Inject environment variables from settings into process.env
    let totalInjected = 0;
    const injectedVars = [];
    
    // Inject API keys
    if (_cachedConfig.apiKeys) {
        Object.entries(_cachedConfig.apiKeys).forEach(([key, value]) => {
          if (value && !process.env[key]) {
            process.env[key] = value;
            totalInjected++;
            injectedVars.push(key);
          }
        });
    }
    
    // Inject environment variables from array structure (primary format)
    if (_cachedConfig.environmentVariables && Array.isArray(_cachedConfig.environmentVariables)) {
        _cachedConfig.environmentVariables.forEach(({ key, value }) => {
          if (key && value !== undefined && value !== null && !process.env[key]) {
            process.env[key] = String(value);
            totalInjected++;
            injectedVars.push(key);
          }
        });
    }
    
    // Inject environment variables from object structure (legacy support)
    if (_cachedConfig.environment && typeof _cachedConfig.environment === 'object') {
        Object.entries(_cachedConfig.environment).forEach(([key, value]) => {
          if (value !== undefined && value !== null && !process.env[key]) {
            process.env[key] = String(value);
            totalInjected++;
            injectedVars.push(key);
          }
        });
    }
    
    if (totalInjected > 0) {
        console.log(`[Models] Injected ${totalInjected} environment variables from settings: ${injectedVars.join(', ')}`);
    }
    
  } catch (e) {
    console.error('[Models] Error in _readSettings:', e);
    if (!_cachedConfig) {
      _cachedConfig = {};
    }
  }
  return _cachedConfig || {};
}

function _modelSection() {
  const cfg = _readSettings();
  return cfg.models || {};
}

function _getEnvOverride(prefix) {
  return {
    name: process.env[`${prefix}_MODEL`],
    temperature: process.env[`${prefix}_MODEL_TEMP`]
      ? parseFloat(process.env[`${prefix}_MODEL_TEMP`])
      : undefined
  };
}

function _resolveModel(key, envPrefix, defaults) {
  const section = _modelSection()[key] || {};
  const env = _getEnvOverride(envPrefix);
  // Allow model-specific baseURL configured either via settings.json or env vars
  const baseURL = process.env.OPENAI_BASE_URL || process.env.OPENAI_BASE || process.env.OPENAI_API_BASE || section.baseURL || undefined;
  return {
    name: env.name || section.name || defaults.name,
    temperature: (env.temperature !== undefined ? env.temperature : (section.temperature !== undefined ? section.temperature : defaults.temperature)),
    provider: section.provider || defaults.provider || inferProviderFromName(env.name || section.name || defaults.name),
    baseURL: baseURL
  };
}

export function getGoalModelConfig() {
  return _resolveModel('goal', 'GOAL', { name: 'gemini-2.5-flash', temperature: 0.0, provider: 'google' });
}
export function getConverterModelConfig() {
  return _resolveModel('converter', 'CONVERTER', { name: 'gemini-2.5-pro', temperature: 0.1, provider: 'google' });
}
export function getAgentModelConfig() {
  return _resolveModel('agent', 'AGENT', { name: 'openrouter/anthropic/claude-3-7-sonnet-20250219', temperature: 0.0, provider: guessAgentDefaultProvider() });
}

function inferProviderFromName(name) {
  if (!name) return 'google';
  if (name.startsWith('google/')) return 'google';
  if (name.startsWith('openrouter/')) return 'openrouter';
  if (name.startsWith('anthropic') || name.includes('claude')) return 'anthropic';
  if (name.startsWith('openai') || name.includes('gpt-')) return 'openai';
  return 'google';
}

function guessAgentDefaultProvider() {
  // If an AGENT_MODEL env var is present, infer from it
  const envName = process.env.AGENT_MODEL;
  if (envName) return inferProviderFromName(envName);
  return 'google';
}

// Runtime provider factory mapping (lazy loaded in callers)
export function resolveProvider(modelConfig, providersRegistry) {
  // providersRegistry is an object with keys matching provider names that return a model constructor.
  if (!modelConfig) throw new Error('modelConfig is required');
  const providerKey = modelConfig.provider || inferProviderFromName(modelConfig.name);
  if (!providersRegistry || !providersRegistry[providerKey]) {
    throw new Error(`Unknown provider: ${providerKey}`);
  }
  // The OpenAI SDKs expect a model identifier string (e.g. "gpt-4o").
  // Previously we attempted to pass an options object which caused
  // `modelId.startsWith is not a function` in downstream code.
  //
  // Instead, if the caller has provided a custom OpenAI base URL via
  // environment variables, set commonly-used env keys so the OpenAI
  // adapter used by the AI SDK can pick them up (many wrappers read
  // OPENAI_API_BASE / OPENAI_BASE_URL). We do **not** pass an object
  // to the provider factory — we continue to pass the model name string.
  if (providerKey === 'openai') {
    const openaiBase = modelConfig.baseURL || process.env.OPENAI_BASE_URL || process.env.OPENAI_BASE || process.env.OPENAI_API_BASE;
    if (openaiBase) {
      console.log(`[Models] Setting OpenAI base URL to: ${openaiBase}`);
      // Do not overwrite existing explicit settings
      if (!process.env.OPENAI_API_BASE) process.env.OPENAI_API_BASE = openaiBase;
      if (!process.env.OPENAI_BASE_URL) process.env.OPENAI_BASE_URL = openaiBase;
    }
  }

  // Pass the full modelConfig to the provider factory so provider wrappers
  // can inspect modelConfig.baseURL if they want to (bridge/providerMap
  // will extract model string and set env vars as needed).
  return providersRegistry[providerKey](modelConfig);
}

// Generic accessor (future-proof)
export function getModelConfigs() {
  return {
    goal: getGoalModelConfig(),
    converter: getConverterModelConfig(),
    agent: getAgentModelConfig()
  };
}

export default {
  getGoalModelConfig,
  getConverterModelConfig,
  getAgentModelConfig,
  getModelConfigs,
  resolveProvider
};
