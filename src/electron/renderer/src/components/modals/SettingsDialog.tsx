import { useState, useEffect } from 'react';
import { X, Save, RefreshCw, Eye, EyeOff, Plus, Trash2 } from 'lucide-react';
import { Button } from '../ui/Button';
import { useSettingsStore, type Settings, type ModelConfig } from '../../stores/useSettingsStore';

const PROVIDERS = ['openai', 'google', 'anthropic', 'openrouter'] as const;
const MCP_TYPES = ['stdio', 'http', 'streamable-http', 'sse'] as const;

const MODEL_EXAMPLES = {
  openai: ['gpt-4o', 'gpt-4o-mini', 'gpt-4-turbo', 'gpt-3.5-turbo'],
  google: ['gemini-2.5-flash', 'gemini-2.5-pro', 'gemini-1.5-flash', 'gemini-1.5-pro'],
  anthropic: ['claude-3-7-sonnet-20250219', 'claude-3-5-sonnet-20241022', 'claude-3-opus-20240229'],
  openrouter: ['openrouter/anthropic/claude-3-7-sonnet-20250219', 'openrouter/google/gemini-2.5-pro', 'openrouter/openai/gpt-4o'],
};

export function SettingsDialog() {
  const { settings, isOpen, isLoading, closeDialog, saveSettings } = useSettingsStore();
  
  const [localSettings, setLocalSettings] = useState<Settings | null>(null);
  const [activeTab, setActiveTab] = useState<'models' | 'api-keys' | 'mcp-servers' | 'env-vars' | 'default-tools'>('models');
  const [showApiKeys, setShowApiKeys] = useState<Record<string, boolean>>({
    OPENAI_API_KEY: false,
    GOOGLE_GENERATIVE_AI_API_KEY: false,
    ANTHROPIC_API_KEY: false,
    OPENROUTER_API_KEY: false,
  });
  const [showEnvValues, setShowEnvValues] = useState<Record<number, boolean>>({});

  useEffect(() => {
    if (isOpen && settings) {
      const settingsCopy = JSON.parse(JSON.stringify(settings));
      // Ensure environmentVariables array exists
      if (!settingsCopy.environmentVariables) {
        settingsCopy.environmentVariables = [];
      }
      // Ensure defaultTools object exists with defaults
      if (!settingsCopy.defaultTools) {
        settingsCopy.defaultTools = {
          brave_search: false,
          you_search: true,
          google_search: false,
          google_scholar_search: true,
          visit_webpage: true,
          workspace_reader: true,
          file_downloader: true,
          visualizer: true,
          diagram_generator: true,
          data_analyzer: true,
          linux_vm: false,
        };
      }
      setLocalSettings(settingsCopy);
    }
  }, [isOpen, settings]);

  if (!isOpen || !localSettings) return null;

  const handleModelChange = (
    modelType: 'goal' | 'converter' | 'agent',
    field: keyof ModelConfig,
    value: string | number
  ) => {
    setLocalSettings({
      ...localSettings,
      models: {
        ...localSettings.models,
        [modelType]: {
          ...localSettings.models[modelType],
          [field]: value,
        },
      },
    });
  };

  const handleApiKeyChange = (key: keyof typeof localSettings.apiKeys, value: string) => {
    setLocalSettings({
      ...localSettings,
      apiKeys: {
        ...localSettings.apiKeys,
        [key]: value,
      },
    });
  };

  const handleMcpServerAdd = () => {
    setLocalSettings({
      ...localSettings,
      mcp_servers: [
        ...localSettings.mcp_servers,
        {
          name: '',
          type: 'stdio',
          command: '',
          args: [],
        },
      ],
    });
  };

  const handleMcpServerRemove = (index: number) => {
    setLocalSettings({
      ...localSettings,
      mcp_servers: localSettings.mcp_servers.filter((_, i) => i !== index),
    });
  };

  const handleMcpServerChange = (index: number, field: string, value: any) => {
    const updatedServers = [...localSettings.mcp_servers];
    updatedServers[index] = {
      ...updatedServers[index],
      [field]: value,
    };
    setLocalSettings({
      ...localSettings,
      mcp_servers: updatedServers,
    });
  };

  const handleMcpArgsChange = (index: number, argsString: string) => {
    const args = argsString.split(',').map(s => s.trim()).filter(s => s.length > 0);
    handleMcpServerChange(index, 'args', args);
  };

  const handleEnvVarAdd = () => {
    setLocalSettings({
      ...localSettings,
      environmentVariables: [
        ...(localSettings.environmentVariables || []),
        { key: '', value: '' },
      ],
    });
  };

  const handleEnvVarRemove = (index: number) => {
    setLocalSettings({
      ...localSettings,
      environmentVariables: (localSettings.environmentVariables || []).filter((_, i) => i !== index),
    });
  };

  const handleEnvVarChange = (index: number, field: 'key' | 'value', value: string) => {
    const updatedEnvVars = [...(localSettings.environmentVariables || [])];
    updatedEnvVars[index] = {
      ...updatedEnvVars[index],
      [field]: value,
    };
    setLocalSettings({
      ...localSettings,
      environmentVariables: updatedEnvVars,
    });
  };

  const toggleEnvValueVisibility = (index: number) => {
    setShowEnvValues(prev => ({ ...prev, [index]: !prev[index] }));
  };

  const handleToolToggle = (toolName: keyof NonNullable<Settings['defaultTools']>, enabled: boolean) => {
    if (!localSettings.defaultTools) return;

    const searchTools = ['brave_search', 'you_search', 'google_search'];
    const isSearchTool = searchTools.includes(toolName);

    // If enabling a search tool, disable all other search tools
    if (isSearchTool && enabled) {
      const updatedTools = { ...localSettings.defaultTools };
      searchTools.forEach(tool => {
        if (tool !== toolName) {
          updatedTools[tool as keyof typeof updatedTools] = false;
        }
      });
      updatedTools[toolName] = true;
      setLocalSettings({
        ...localSettings,
        defaultTools: updatedTools,
      });
    } else {
      // For non-search tools or disabling, just toggle
      setLocalSettings({
        ...localSettings,
        defaultTools: {
          ...localSettings.defaultTools,
          [toolName]: enabled,
        },
      });
    }
  };

  const handleSave = async () => {
    try {
      await saveSettings(localSettings);
      // Trigger MCP reload
      await window.electronAPI.reloadMcpServers();
      closeDialog();
    } catch (error) {
      console.error('Failed to save settings:', error);
      alert('Failed to save settings. Please check the console for details.');
    }
  };

  const handleCancel = () => {
    closeDialog();
  };

  const toggleApiKeyVisibility = (key: string) => {
    setShowApiKeys(prev => ({ ...prev, [key]: !prev[key] }));
  };

  return (
    <div className="fixed inset-0 bg-black bg-opacity-70 flex items-center justify-center z-50 animate-fade-in overflow-y-auto p-4">
      <div className="bg-bg-medium border border-border rounded-lg p-6 max-w-4xl w-full my-8 shadow-medium animate-fade-in-up max-h-[90vh] flex flex-col">
        {/* Header */}
        <div className="flex justify-between items-start mb-4">
          <h2 className="text-2xl font-semibold text-deepclause-primary">Settings</h2>
          <button
            onClick={handleCancel}
            className="text-text-secondary hover:text-text-primary transition-colors"
            title="Close"
          >
            <X className="w-6 h-6" />
          </button>
        </div>

        {/* Tab Navigation */}
        <div className="flex gap-2 mb-6 border-b border-border overflow-x-auto">
          <button
            onClick={() => setActiveTab('models')}
            className={`px-4 py-2 font-medium transition-colors relative whitespace-nowrap ${
              activeTab === 'models'
                ? 'text-deepclause-primary'
                : 'text-text-secondary hover:text-text-primary'
            }`}
          >
            🤖 Models
            {activeTab === 'models' && (
              <div className="absolute bottom-0 left-0 right-0 h-0.5 bg-deepclause-primary" />
            )}
          </button>
          <button
            onClick={() => setActiveTab('api-keys')}
            className={`px-4 py-2 font-medium transition-colors relative whitespace-nowrap ${
              activeTab === 'api-keys'
                ? 'text-deepclause-primary'
                : 'text-text-secondary hover:text-text-primary'
            }`}
          >
            🔑 API Keys
            {activeTab === 'api-keys' && (
              <div className="absolute bottom-0 left-0 right-0 h-0.5 bg-deepclause-primary" />
            )}
          </button>
          <button
            onClick={() => setActiveTab('default-tools')}
            className={`px-4 py-2 font-medium transition-colors relative whitespace-nowrap ${
              activeTab === 'default-tools'
                ? 'text-deepclause-primary'
                : 'text-text-secondary hover:text-text-primary'
            }`}
          >
            🔧 Default Tools
            {activeTab === 'default-tools' && (
              <div className="absolute bottom-0 left-0 right-0 h-0.5 bg-deepclause-primary" />
            )}
          </button>
          <button
            onClick={() => setActiveTab('mcp-servers')}
            className={`px-4 py-2 font-medium transition-colors relative whitespace-nowrap ${
              activeTab === 'mcp-servers'
                ? 'text-deepclause-primary'
                : 'text-text-secondary hover:text-text-primary'
            }`}
          >
            🔌 MCP Servers
            {activeTab === 'mcp-servers' && (
              <div className="absolute bottom-0 left-0 right-0 h-0.5 bg-deepclause-primary" />
            )}
          </button>
          <button
            onClick={() => setActiveTab('env-vars')}
            className={`px-4 py-2 font-medium transition-colors relative whitespace-nowrap ${
              activeTab === 'env-vars'
                ? 'text-deepclause-primary'
                : 'text-text-secondary hover:text-text-primary'
            }`}
          >
            🌍 Environment
            {activeTab === 'env-vars' && (
              <div className="absolute bottom-0 left-0 right-0 h-0.5 bg-deepclause-primary" />
            )}
          </button>
        </div>

        {/* Scrollable Content Area */}
        <div className="flex-1 overflow-y-auto pr-2 space-y-6">
          {/* API Keys Tab */}
          {activeTab === 'api-keys' && (
          <section>
            <div className="space-y-4">
              {Object.entries(localSettings.apiKeys).map(([key, value]) => {
                const displayName = key
                  .replace(/_API_KEY$/, '')
                  .replace(/_/g, ' ')
                  .split(' ')
                  .map(word => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
                  .join(' ');

                return (
                  <div key={key} className="flex flex-col gap-2">
                    <label className="text-sm font-medium text-text-secondary">
                      {displayName}
                    </label>
                    <div className="relative">
                      <input
                        type={showApiKeys[key] ? 'text' : 'password'}
                        value={value}
                        onChange={(e) => handleApiKeyChange(key as keyof typeof localSettings.apiKeys, e.target.value)}
                        placeholder={`Enter ${displayName} API Key`}
                        className="w-full bg-bg-light border border-border rounded px-3 py-2 pr-10 text-text-primary focus:outline-none focus:border-deepclause-primary focus:ring-2 focus:ring-deepclause-primary focus:ring-opacity-20 font-mono text-sm"
                      />
                      <button
                        type="button"
                        onClick={() => toggleApiKeyVisibility(key)}
                        className="absolute right-2 top-1/2 -translate-y-1/2 text-text-secondary hover:text-text-primary transition-colors"
                        title={showApiKeys[key] ? 'Hide' : 'Show'}
                      >
                        {showApiKeys[key] ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>

            {/* API Keys Help Text */}
            <div className="bg-bg-light border border-border rounded-lg p-4 text-sm text-text-secondary mt-4">
              <p className="mb-2">
                <strong className="text-text-primary">💡 API Keys:</strong>
              </p>
              <ul className="list-disc list-inside space-y-1 ml-2">
                <li>Enter your API keys for the providers you plan to use</li>
                <li>Keys are stored securely in your local settings file</li>
                <li>You only need keys for the providers you're using</li>
                <li>Changes take effect immediately after saving</li>
              </ul>
            </div>
          </section>
          )}

          {/* Models Tab */}
          {activeTab === 'models' && (
          <section>
            <div className="space-y-4">
              {(['goal', 'converter', 'agent'] as const).map((modelType) => (
                <div key={modelType} className="bg-bg-light border border-border rounded-lg p-4">
                  <h4 className="text-md font-medium text-deepclause-primary mb-3 capitalize">
                    {modelType === 'goal' && '🎯 '}
                    {modelType === 'converter' && '🔄 '}
                    {modelType === 'agent' && '🤖 '}
                    {modelType} Model
                  </h4>
                  <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                    {/* Provider */}
                    <div className="flex flex-col gap-2">
                      <label className="text-sm font-medium text-text-secondary">
                        Provider
                      </label>
                      <select
                        value={localSettings.models[modelType].provider}
                        onChange={(e) => handleModelChange(modelType, 'provider', e.target.value)}
                        className="bg-bg-medium border border-border rounded px-3 py-2 text-text-primary focus:outline-none focus:border-deepclause-primary focus:ring-2 focus:ring-deepclause-primary focus:ring-opacity-20"
                      >
                        {PROVIDERS.map((provider) => (
                          <option key={provider} value={provider}>
                            {provider.charAt(0).toUpperCase() + provider.slice(1)}
                          </option>
                        ))}
                      </select>
                    </div>

                    {/* Model Name */}
                    <div className="flex flex-col gap-2">
                      <label className="text-sm font-medium text-text-secondary">
                        Model Name
                      </label>
                      <input
                        type="text"
                        list={`${modelType}-models`}
                        value={localSettings.models[modelType].name}
                        onChange={(e) => handleModelChange(modelType, 'name', e.target.value)}
                        placeholder="e.g., gpt-4o"
                        className="bg-bg-medium border border-border rounded px-3 py-2 text-text-primary focus:outline-none focus:border-deepclause-primary focus:ring-2 focus:ring-deepclause-primary focus:ring-opacity-20 font-mono text-sm"
                      />
                      <datalist id={`${modelType}-models`}>
                        {MODEL_EXAMPLES[localSettings.models[modelType].provider].map((model) => (
                          <option key={model} value={model} />
                        ))}
                      </datalist>
                    </div>

                    {/* Temperature */}
                    <div className="flex flex-col gap-2">
                      <label className="text-sm font-medium text-text-secondary">
                        Temperature
                      </label>
                      <input
                        type="number"
                        min="0"
                        max="2"
                        step="0.1"
                        value={localSettings.models[modelType].temperature}
                        onChange={(e) => handleModelChange(modelType, 'temperature', parseFloat(e.target.value))}
                        className="bg-bg-medium border border-border rounded px-3 py-2 text-text-primary focus:outline-none focus:border-deepclause-primary focus:ring-2 focus:ring-deepclause-primary focus:ring-opacity-20"
                      />
                    </div>
                  </div>
                </div>
              ))}
            </div>

            {/* Models Help Text */}
            <div className="bg-bg-light border border-border rounded-lg p-4 text-sm text-text-secondary mt-4">
              <p className="mb-2">
                <strong className="text-text-primary">💡 Model Configuration:</strong>
              </p>
              <ul className="list-disc list-inside space-y-1 ml-2">
                <li><strong>Goal Model:</strong> Used for evaluating DML goals during execution. Fast models work well here.</li>
                <li><strong>Converter Model:</strong> Used for DML generation. Use more capable reasoning models.</li>
                <li><strong>Agent Model:</strong> Used for agent operations. Balance between speed and capability.</li>
                <li><strong>Temperature:</strong> Controls randomness (0 = deterministic, 2 = creative)</li>
              </ul>
            </div>
          </section>
          )}

          {/* Default Tools Tab */}
          {activeTab === 'default-tools' && localSettings.defaultTools && (
          <section>
            <div className="space-y-6">
              {/* Search Tools Section */}
              <div className="bg-bg-light border border-border rounded-lg p-4">
                <h4 className="text-md font-medium text-deepclause-primary mb-3">
                  🔍 Web Search Tools
                </h4>
                <p className="text-sm text-text-secondary mb-3">
                  Select one web search tool. Only one can be active at a time.
                </p>
                <div className="space-y-3">
                  <label className="flex items-center gap-3 p-3 bg-bg-medium rounded cursor-pointer hover:bg-opacity-80 transition-colors">
                    <input
                      type="checkbox"
                      checked={localSettings.defaultTools.brave_search}
                      onChange={(e) => handleToolToggle('brave_search', e.target.checked)}
                      className="w-4 h-4 text-deepclause-primary bg-bg-dark border-border rounded focus:ring-2 focus:ring-deepclause-primary focus:ring-opacity-50"
                    />
                    <div className="flex-1">
                      <span className="text-text-primary font-medium">Brave Search</span>
                      <p className="text-xs text-text-secondary mt-0.5">
                        Web, news, images, videos, and AI summarization. Requires <code className="px-1 py-0.5 bg-bg-dark rounded text-xs">BRAVE_KEY</code> or <code className="px-1 py-0.5 bg-bg-dark rounded text-xs">BRAVE_API_KEY</code>
                      </p>
                    </div>
                  </label>

                  <label className="flex items-center gap-3 p-3 bg-bg-medium rounded cursor-pointer hover:bg-opacity-80 transition-colors">
                    <input
                      type="checkbox"
                      checked={localSettings.defaultTools.you_search}
                      onChange={(e) => handleToolToggle('you_search', e.target.checked)}
                      className="w-4 h-4 text-deepclause-primary bg-bg-dark border-border rounded focus:ring-2 focus:ring-deepclause-primary focus:ring-opacity-50"
                    />
                    <div className="flex-1">
                      <span className="text-text-primary font-medium">You.com Search</span>
                      <p className="text-xs text-text-secondary mt-0.5">
                        Web search via You.com API. Requires <code className="px-1 py-0.5 bg-bg-dark rounded text-xs">YOU_COM_API_KEY</code>, <code className="px-1 py-0.5 bg-bg-dark rounded text-xs">YOUCOM_API_KEY</code>, or <code className="px-1 py-0.5 bg-bg-dark rounded text-xs">YDC_API_KEY</code>
                      </p>
                    </div>
                  </label>

                  <label className="flex items-center gap-3 p-3 bg-bg-medium rounded cursor-pointer hover:bg-opacity-80 transition-colors">
                    <input
                      type="checkbox"
                      checked={localSettings.defaultTools.google_search}
                      onChange={(e) => handleToolToggle('google_search', e.target.checked)}
                      className="w-4 h-4 text-deepclause-primary bg-bg-dark border-border rounded focus:ring-2 focus:ring-deepclause-primary focus:ring-opacity-50"
                    />
                    <div className="flex-1">
                      <span className="text-text-primary font-medium">Google Search</span>
                      <p className="text-xs text-text-secondary mt-0.5">
                        Standard Google web search via Serper API. Requires <code className="px-1 py-0.5 bg-bg-dark rounded text-xs">SERPER_API_KEY</code>
                      </p>
                    </div>
                  </label>
                </div>
              </div>

              {/* Academic Search Section */}
              <div className="bg-bg-light border border-border rounded-lg p-4">
                <h4 className="text-md font-medium text-deepclause-primary mb-3">
                  🎓 Academic Search
                </h4>
                <p className="text-sm text-text-secondary mb-3">
                  Academic search tool (can be used alongside web search).
                </p>
                <div className="space-y-3">
                  <label className="flex items-center gap-3 p-3 bg-bg-medium rounded cursor-pointer hover:bg-opacity-80 transition-colors">
                    <input
                      type="checkbox"
                      checked={localSettings.defaultTools.google_scholar_search}
                      onChange={(e) => handleToolToggle('google_scholar_search', e.target.checked)}
                      className="w-4 h-4 text-deepclause-primary bg-bg-dark border-border rounded focus:ring-2 focus:ring-deepclause-primary focus:ring-opacity-50"
                    />
                    <div className="flex-1">
                      <span className="text-text-primary font-medium">Google Scholar Search</span>
                      <p className="text-xs text-text-secondary mt-0.5">
                        Academic paper search with citations and publication info. Requires <code className="px-1 py-0.5 bg-bg-dark rounded text-xs">SERPER_API_KEY</code>
                      </p>
                    </div>
                  </label>
                </div>
              </div>

              {/* Web & File Tools Section */}
              <div className="bg-bg-light border border-border rounded-lg p-4">
                <h4 className="text-md font-medium text-deepclause-primary mb-3">
                  🌐 Web & File Tools
                </h4>
                <div className="space-y-3">
                  <label className="flex items-center gap-3 p-3 bg-bg-medium rounded cursor-pointer hover:bg-opacity-80 transition-colors">
                    <input
                      type="checkbox"
                      checked={localSettings.defaultTools.visit_webpage}
                      onChange={(e) => handleToolToggle('visit_webpage', e.target.checked)}
                      className="w-4 h-4 text-deepclause-primary bg-bg-dark border-border rounded focus:ring-2 focus:ring-deepclause-primary focus:ring-opacity-50"
                    />
                    <div className="flex-1">
                      <span className="text-text-primary font-medium">Visit Webpage</span>
                      <p className="text-xs text-text-secondary mt-0.5">
                        Scrape and read web page content as markdown. Requires <code className="px-1 py-0.5 bg-bg-dark rounded text-xs">SERPER_API_KEY</code>
                      </p>
                    </div>
                  </label>

                  <label className="flex items-center gap-3 p-3 bg-bg-medium rounded cursor-pointer hover:bg-opacity-80 transition-colors">
                    <input
                      type="checkbox"
                      checked={localSettings.defaultTools.workspace_reader}
                      onChange={(e) => handleToolToggle('workspace_reader', e.target.checked)}
                      className="w-4 h-4 text-deepclause-primary bg-bg-dark border-border rounded focus:ring-2 focus:ring-deepclause-primary focus:ring-opacity-50"
                    />
                    <div className="flex-1">
                      <span className="text-text-primary font-medium">Workspace Reader</span>
                      <p className="text-xs text-text-secondary mt-0.5">
                        Read files from workspace (HTML, PDF, XLS, PPTX). No API key needed.
                      </p>
                    </div>
                  </label>

                  <label className="flex items-center gap-3 p-3 bg-bg-medium rounded cursor-pointer hover:bg-opacity-80 transition-colors">
                    <input
                      type="checkbox"
                      checked={localSettings.defaultTools.file_downloader}
                      onChange={(e) => handleToolToggle('file_downloader', e.target.checked)}
                      className="w-4 h-4 text-deepclause-primary bg-bg-dark border-border rounded focus:ring-2 focus:ring-deepclause-primary focus:ring-opacity-50"
                    />
                    <div className="flex-1">
                      <span className="text-text-primary font-medium">File Downloader</span>
                      <p className="text-xs text-text-secondary mt-0.5">
                        Download files from URLs to workspace. No API key needed.
                      </p>
                    </div>
                  </label>
                </div>
              </div>

              {/* Analysis & Visualization Tools Section */}
              <div className="bg-bg-light border border-border rounded-lg p-4">
                <h4 className="text-md font-medium text-deepclause-primary mb-3">
                  📊 Analysis & Visualization
                </h4>
                <div className="space-y-3">
                  <label className="flex items-center gap-3 p-3 bg-bg-medium rounded cursor-pointer hover:bg-opacity-80 transition-colors">
                    <input
                      type="checkbox"
                      checked={localSettings.defaultTools.visualizer}
                      onChange={(e) => handleToolToggle('visualizer', e.target.checked)}
                      className="w-4 h-4 text-deepclause-primary bg-bg-dark border-border rounded focus:ring-2 focus:ring-deepclause-primary focus:ring-opacity-50"
                    />
                    <div className="flex-1">
                      <span className="text-text-primary font-medium">Image Visualizer</span>
                      <p className="text-xs text-text-secondary mt-0.5">
                        Answer questions about images and generate captions. Uses configured vision models.
                      </p>
                    </div>
                  </label>

                  <label className="flex items-center gap-3 p-3 bg-bg-medium rounded cursor-pointer hover:bg-opacity-80 transition-colors">
                    <input
                      type="checkbox"
                      checked={localSettings.defaultTools.diagram_generator}
                      onChange={(e) => handleToolToggle('diagram_generator', e.target.checked)}
                      className="w-4 h-4 text-deepclause-primary bg-bg-dark border-border rounded focus:ring-2 focus:ring-deepclause-primary focus:ring-opacity-50"
                    />
                    <div className="flex-1">
                      <span className="text-text-primary font-medium">Diagram Generator</span>
                      <p className="text-xs text-text-secondary mt-0.5">
                        Create flowcharts, sequence diagrams, and visualizations using Mermaid.js.
                      </p>
                    </div>
                  </label>

                  <label className="flex items-center gap-3 p-3 bg-bg-medium rounded cursor-pointer hover:bg-opacity-80 transition-colors">
                    <input
                      type="checkbox"
                      checked={localSettings.defaultTools.data_analyzer}
                      onChange={(e) => handleToolToggle('data_analyzer', e.target.checked)}
                      className="w-4 h-4 text-deepclause-primary bg-bg-dark border-border rounded focus:ring-2 focus:ring-deepclause-primary focus:ring-opacity-50"
                    />
                    <div className="flex-1">
                      <span className="text-text-primary font-medium">Data Analyzer</span>
                      <p className="text-xs text-text-secondary mt-0.5">
                        Analyze CSV, JSON files with statistics and insights.
                      </p>
                    </div>
                  </label>
                </div>
              </div>

              {/* Advanced Tools Section */}
              <div className="bg-bg-light border border-border rounded-lg p-4">
                <h4 className="text-md font-medium text-deepclause-primary mb-3">
                  ⚙️ Advanced Tools
                </h4>
                <div className="space-y-3">
                  <label className="flex items-center gap-3 p-3 bg-bg-medium rounded cursor-pointer hover:bg-opacity-80 transition-colors">
                    <input
                      type="checkbox"
                      checked={localSettings.defaultTools.linux_vm}
                      onChange={(e) => handleToolToggle('linux_vm', e.target.checked)}
                      className="w-4 h-4 text-deepclause-primary bg-bg-dark border-border rounded focus:ring-2 focus:ring-deepclause-primary focus:ring-opacity-50"
                    />
                    <div className="flex-1">
                      <span className="text-text-primary font-medium">Linux VM</span>
                      <p className="text-xs text-text-secondary mt-0.5">
                        Sandboxed Linux environment with shell and Python. Resource intensive - enable only when needed.
                      </p>
                    </div>
                  </label>
                </div>
              </div>
            </div>

            {/* Default Tools Help Text */}
            <div className="bg-bg-light border border-border rounded-lg p-4 text-sm text-text-secondary mt-4">
              <p className="mb-2">
                <strong className="text-text-primary">💡 Default Tools Configuration:</strong>
              </p>
              <ul className="list-disc list-inside space-y-1 ml-2">
                <li><strong>Web Search:</strong> Choose one of Brave, You.com, or Google. Only one can be active at a time.</li>
                <li><strong>Academic Search:</strong> Google Scholar is independent and can be used alongside your web search tool.</li>
                <li><strong>API Keys:</strong> Set required keys in the "Environment" or "API Keys" tab.</li>
                <li><strong>Performance:</strong> Disabling unused tools can improve startup time.</li>
                <li><strong>Linux VM:</strong> Very resource intensive - only enable for shell/Python execution needs.</li>
                <li>Changes take effect on the next DML execution.</li>
              </ul>
            </div>
          </section>
          )}

          {/* MCP Servers Tab */}
          {activeTab === 'mcp-servers' && (
          <section>
            <div className="space-y-4">
              {localSettings.mcp_servers.map((server, index) => (
                <div key={index} className="bg-bg-light border border-border rounded-lg p-4">
                  <div className="flex justify-between items-start mb-3">
                    <h4 className="text-md font-medium text-deepclause-primary">
                      Server {index + 1}
                    </h4>
                    <button
                      onClick={() => handleMcpServerRemove(index)}
                      className="text-red-500 hover:text-red-400 transition-colors"
                      title="Remove server"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>
                  
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    {/* Name */}
                    <div className="flex flex-col gap-2">
                      <label className="text-sm font-medium text-text-secondary">
                        Name
                      </label>
                      <input
                        type="text"
                        value={server.name}
                        onChange={(e) => handleMcpServerChange(index, 'name', e.target.value)}
                        placeholder="e.g., playwright-mcp"
                        className="bg-bg-medium border border-border rounded px-3 py-2 text-text-primary focus:outline-none focus:border-deepclause-primary focus:ring-2 focus:ring-deepclause-primary focus:ring-opacity-20"
                      />
                    </div>

                    {/* Type */}
                    <div className="flex flex-col gap-2">
                      <label className="text-sm font-medium text-text-secondary">
                        Type
                      </label>
                      <select
                        value={server.type}
                        onChange={(e) => handleMcpServerChange(index, 'type', e.target.value)}
                        className="bg-bg-medium border border-border rounded px-3 py-2 text-text-primary focus:outline-none focus:border-deepclause-primary focus:ring-2 focus:ring-deepclause-primary focus:ring-opacity-20"
                      >
                        {MCP_TYPES.map((type) => (
                          <option key={type} value={type}>
                            {type}
                          </option>
                        ))}
                      </select>
                    </div>
                  </div>

                  {/* Conditional fields based on type */}
                  {server.type === 'stdio' && (
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mt-4">
                      <div className="flex flex-col gap-2">
                        <label className="text-sm font-medium text-text-secondary">
                          Command
                        </label>
                        <input
                          type="text"
                          value={server.command || ''}
                          onChange={(e) => handleMcpServerChange(index, 'command', e.target.value)}
                          placeholder="e.g., npx"
                          className="bg-bg-medium border border-border rounded px-3 py-2 text-text-primary focus:outline-none focus:border-deepclause-primary focus:ring-2 focus:ring-deepclause-primary focus:ring-opacity-20 font-mono text-sm"
                        />
                      </div>
                      <div className="flex flex-col gap-2">
                        <label className="text-sm font-medium text-text-secondary">
                          Arguments (comma-separated)
                        </label>
                        <input
                          type="text"
                          value={server.args?.join(', ') || ''}
                          onChange={(e) => handleMcpArgsChange(index, e.target.value)}
                          placeholder="e.g., @playwright/mcp@latest, --extension"
                          className="bg-bg-medium border border-border rounded px-3 py-2 text-text-primary focus:outline-none focus:border-deepclause-primary focus:ring-2 focus:ring-deepclause-primary focus:ring-opacity-20 font-mono text-sm"
                        />
                      </div>
                    </div>
                  )}

                  {(server.type === 'http' || server.type === 'streamable-http' || server.type === 'sse') && (
                    <div className="flex flex-col gap-2 mt-4">
                      <label className="text-sm font-medium text-text-secondary">
                        URL
                      </label>
                      <input
                        type="url"
                        value={server.url || ''}
                        onChange={(e) => handleMcpServerChange(index, 'url', e.target.value)}
                        placeholder="e.g., http://localhost:3000"
                        className="bg-bg-medium border border-border rounded px-3 py-2 text-text-primary focus:outline-none focus:border-deepclause-primary focus:ring-2 focus:ring-deepclause-primary focus:ring-opacity-20 font-mono text-sm"
                      />
                    </div>
                  )}
                </div>
              ))}

              <Button
                variant="secondary"
                onClick={handleMcpServerAdd}
                className="w-full flex items-center justify-center gap-2"
              >
                <Plus className="w-4 h-4" />
                Add MCP Server
              </Button>
            </div>

            {/* MCP Help Text */}
            <div className="bg-bg-light border border-border rounded-lg p-4 text-sm text-text-secondary mt-4">
              <p className="mb-2">
                <strong className="text-text-primary">💡 MCP Servers:</strong>
              </p>
              <ul className="list-disc list-inside space-y-1 ml-2">
                <li><strong>stdio:</strong> Connects to a local command/script (e.g., npx, node)</li>
                <li><strong>http/streamable-http:</strong> Connects to HTTP-based MCP server</li>
                <li><strong>sse:</strong> Connects via Server-Sent Events</li>
                <li>MCP servers provide additional tools that can be used in DML execution</li>
                <li>Changes take effect immediately after saving (no restart needed)</li>
              </ul>
            </div>
          </section>
          )}

          {/* Environment Variables Tab */}
          {activeTab === 'env-vars' && (
          <section>
            <div className="space-y-4">
              {(localSettings.environmentVariables || []).map((envVar, index) => (
                <div key={index} className="bg-bg-light border border-border rounded-lg p-4">
                  <div className="flex justify-between items-start mb-3">
                    <h4 className="text-md font-medium text-deepclause-primary">
                      Variable {index + 1}
                    </h4>
                    <button
                      onClick={() => handleEnvVarRemove(index)}
                      className="text-red-500 hover:text-red-400 transition-colors"
                      title="Remove variable"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>
                  
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    {/* Key */}
                    <div className="flex flex-col gap-2">
                      <label className="text-sm font-medium text-text-secondary">
                        Variable Name
                      </label>
                      <input
                        type="text"
                        value={envVar.key}
                        onChange={(e) => handleEnvVarChange(index, 'key', e.target.value)}
                        placeholder="e.g., STRIPE_API_KEY"
                        className="bg-bg-medium border border-border rounded px-3 py-2 text-text-primary focus:outline-none focus:border-deepclause-primary focus:ring-2 focus:ring-deepclause-primary focus:ring-opacity-20 font-mono text-sm"
                      />
                    </div>

                    {/* Value */}
                    <div className="flex flex-col gap-2">
                      <label className="text-sm font-medium text-text-secondary">
                        Value
                      </label>
                      <div className="relative">
                        <input
                          type={showEnvValues[index] ? 'text' : 'password'}
                          value={envVar.value}
                          onChange={(e) => handleEnvVarChange(index, 'value', e.target.value)}
                          placeholder="Enter value"
                          className="w-full bg-bg-medium border border-border rounded px-3 py-2 pr-10 text-text-primary focus:outline-none focus:border-deepclause-primary focus:ring-2 focus:ring-deepclause-primary focus:ring-opacity-20 font-mono text-sm"
                        />
                        <button
                          type="button"
                          onClick={() => toggleEnvValueVisibility(index)}
                          className="absolute right-2 top-1/2 -translate-y-1/2 text-text-secondary hover:text-text-primary transition-colors"
                          title={showEnvValues[index] ? 'Hide' : 'Show'}
                        >
                          {showEnvValues[index] ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                        </button>
                      </div>
                    </div>
                  </div>
                </div>
              ))}

              <Button
                variant="secondary"
                onClick={handleEnvVarAdd}
                className="w-full flex items-center justify-center gap-2"
              >
                <Plus className="w-4 h-4" />
                Add Environment Variable
              </Button>
            </div>

            {/* Environment Variables Help Text */}
            <div className="bg-bg-light border border-border rounded-lg p-4 text-sm text-text-secondary mt-4">
              <p className="mb-2">
                <strong className="text-text-primary">💡 Environment Variables:</strong>
              </p>
              <ul className="list-disc list-inside space-y-1 ml-2">
                <li>Inject custom environment variables into the main process</li>
                <li>Useful for third-party API keys (e.g., Stripe, Twilio, etc.)</li>
                <li>Variables are set when the application starts</li>
                <li>Can be accessed by MCP servers and other processes</li>
                <li>Use ALL_CAPS naming convention (e.g., MY_API_KEY)</li>
              </ul>
            </div>
          </section>
          )}
        </div>

        {/* Footer Buttons */}
        <div className="flex gap-3 justify-end mt-4 pt-4 border-t border-border flex-shrink-0">
          <Button variant="secondary" onClick={handleCancel} disabled={isLoading}>
            Cancel
          </Button>
          <Button 
            variant="primary" 
            onClick={handleSave} 
            disabled={isLoading}
            className="flex items-center gap-2"
          >
            {isLoading ? (
              <>
                <RefreshCw className="w-4 h-4 animate-spin" />
                Saving...
              </>
            ) : (
              <>
                <Save className="w-4 h-4" />
                Save Settings
              </>
            )}
          </Button>
        </div>
      </div>
    </div>
  );
}
