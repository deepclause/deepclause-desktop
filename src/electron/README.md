# DeepClause Electron App

This directory contains the Electron application version of DeepClause.

## Overview

The Electron app provides a desktop GUI for interacting with DeepClause's neurosymbolic AI system. It separates concerns into three main areas:

### Architecture

```
src/electron/
├── main/               # Main process (Node.js)
│   ├── index.js       # Entry point, window management
│   ├── dml-agent.js   # DML Agent logic (adapted from CLI)
│   ├── ipc-handlers.js # IPC communication handlers
│   └── workspace-manager.js # Workspace folder management
├── preload/           # Preload scripts
│   └── preload.js     # Secure bridge to renderer
└── renderer/          # Renderer process (Browser)
    ├── index.html     # Main UI
    ├── renderer.js    # UI logic
    └── styles.css     # Styling
```

### Main Process
- Handles all Node.js operations
- Manages WASM modules and SWI-Prolog
- Accesses file system and workspace
- Runs DML code execution

### Renderer Process
- Provides the user interface
- Displays chat/console output
- Shows file list sidebar
- Sends user input to main process

### Preload Script
- Securely exposes IPC methods to renderer
- Bridges main and renderer processes
- Follows Electron security best practices

## Workspace Management

The app uses these directories:

- **Workspace**: `~/AppData/DeepClause/workspace` (or platform equivalent)
  - User files for DML scripts to work with
  
- **DML Examples**: `~/AppData/DeepClause/dml_examples`
  - DML script files
  - Copied from bundled resources on first run
  
- **Config**: `~/AppData/DeepClause/config`
  - settings.json for model configuration

Users can also select a custom workspace folder using the "Workspace" button.

## Bundled Resources

The app bundles these resources:

- **WASM modules**: `build/*.wasm` - SWI-Prolog WASM runtime
- **V86 files**: `build/v86*` - x86 emulator files
- **DML examples**: `dml_examples/*.dml` - Example scripts
- **Config**: `config/settings.json` - Default configuration

These are accessed via `process.resourcesPath` in production or relative paths in development.

## Development

### Running in Development

```bash
npm install
npm run electron:dev
```

This will:
- Start Electron with DevTools open
- Use files from the project directory
- Enable hot-reload-like development

### Building for Distribution

```bash
# Build for current platform
npm run build

# Build for specific platform
npm run build:linux
npm run build:mac
npm run build:win
```

Output will be in the `dist/` directory.

## Features

- **Natural Language Interface**: Chat with the AI agent
- **File Management**: Browse and run DML files from sidebar
- **Command Support**: Use `/create`, `/run`, `/save`, `/list` commands
- **Workspace Selection**: Choose custom workspace folders
- **Execution Control**: Abort long-running DML executions
- **Real-time Output**: See execution results in real-time
- **Dark Theme**: Modern, comfortable UI for extended use

## Security

The app follows Electron security best practices:

- Context isolation enabled
- Node integration disabled in renderer
- Preload script for secure IPC
- No eval() or unsafe code execution
- Content Security Policy enforced

## Customization

### Changing Models

Edit `config/settings.json`:

```json
{
  "models": {
    "agent": {
      "name": "gemini-2.5-flash",
      "temperature": 0.0,
      "provider": "google"
    }
  }
}
```

Or set environment variables:
- `AGENT_MODEL`
- `AGENT_MODEL_TEMP`

### Adding DML Files

1. Place `.dml` files in the workspace's `dml_examples` folder
2. Click "Refresh" in the sidebar
3. Files will appear in the list

## Troubleshooting

### WASM modules not loading
- Check that `build/` directory contains `v86.wasm` and other files
- Verify `extraResources` in `package.json` includes the build folder

### Workspace access issues
- Check permissions on the userData directory
- Try selecting a different workspace folder
- Ensure sufficient disk space

### IPC communication errors
- Verify preload script is loading correctly
- Check browser console for errors
- Ensure main process handlers are registered

## Future Enhancements

- [ ] Syntax highlighting for DML code
- [ ] File editor within the app
- [ ] Multiple workspace tabs
- [ ] Export/import workspace configurations
- [ ] Plugin system for custom tools
- [ ] Integrated terminal
- [ ] Code completion for DML
