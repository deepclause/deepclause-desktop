import fs from 'fs';
import path from 'path';
import os from 'os';

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
    SETTINGS_PATH = path.resolve(process.cwd(), 'config', 'settings.json');
    console.log(`[Models] Using CLI settings path: ${SETTINGS_PATH}`);
  }
  
  return SETTINGS_PATH;
}

function _readSettings() {
  try {
    const settingsPath = _getSettingsPath(); // Get path lazily
    const stat = fs.statSync(settingsPath);
    if (!_cachedConfig || stat.mtimeMs !== _lastMTime) {
      const raw = fs.readFileSync(settingsPath, 'utf-8');
      _cachedConfig = JSON.parse(raw);
      _lastMTime = stat.mtimeMs;
      
      // Load API keys from settings into process.env if not already set
      if (_cachedConfig.apiKeys) {
        Object.entries(_cachedConfig.apiKeys).forEach(([key, value]) => {
          if (value && !process.env[key]) {
            process.env[key] = value;
          }
        });
      }
    }
  } catch (e) {
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
  return {
    name: env.name || section.name || defaults.name,
    temperature: (env.temperature !== undefined ? env.temperature : (section.temperature !== undefined ? section.temperature : defaults.temperature)),
    provider: section.provider || defaults.provider || inferProviderFromName(env.name || section.name || defaults.name)
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
  return providersRegistry[providerKey](modelConfig.name);
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
