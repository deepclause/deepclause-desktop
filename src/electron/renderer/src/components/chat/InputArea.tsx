import { useState, useRef, useEffect } from 'react';
import { Send } from 'lucide-react';
import { useAppStore } from '../../stores/useAppStore';
import { useChatStore } from '../../stores/useChatStore';
import { useFileStore } from '../../stores/useFileStore';
import { useConversationStore } from '../../stores/useConversationStore';
import { Autocomplete, AutocompleteOption } from './Autocomplete';

export function InputArea() {
  const [input, setInput] = useState('');
  const [showAutocomplete, setShowAutocomplete] = useState(false);
  const [autocompleteOptions, setAutocompleteOptions] = useState<AutocompleteOption[]>([]);
  const [autocompleteFilter, setAutocompleteFilter] = useState('');
  const [autocompleteCommand, setAutocompleteCommand] = useState<'run' | 'create' | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const isProcessing = useAppStore((state) => state.isProcessing);
  const setProcessing = useAppStore((state) => state.setProcessing);
  const setStatus = useAppStore((state) => state.setStatus);
  const pendingInput = useAppStore((state) => state.pendingInput);
  const setPendingInput = useAppStore((state) => state.setPendingInput);
  const { addMessage, startStreaming } = useChatStore();
  const refreshDmlFiles = useFileStore((state) => state.refreshDmlFiles);
  const dmlFiles = useFileStore((state) => state.dmlFiles);
  const workspaceFiles = useFileStore((state) => state.workspaceFiles);
  const currentConversationId = useConversationStore((state) => state.currentConversationId);

  // Handle pending input from file clicks
  useEffect(() => {
    if (pendingInput) {
      setInput(pendingInput);
      setPendingInput(null);
      textareaRef.current?.focus();
    }
  }, [pendingInput, setPendingInput]);

  // Detect when to show autocomplete
  const handleInputChange = (value: string) => {
    setInput(value);

    // Check for /run command
    if (value.startsWith('/run ')) {
      const afterCommand = value.substring(5); // everything after "/run "
      setAutocompleteCommand('run');
      setAutocompleteFilter(afterCommand);
      
      // Build DML file options
      const options: AutocompleteOption[] = dmlFiles.map((file) => ({
        value: file.name,
        label: file.name,
        description: file.description,
        type: 'dml' as const,
      }));
      
      setAutocompleteOptions(options);
      setShowAutocomplete(true);
    }
    // Check for /create : command
    else if (value.match(/^\/create\s+:/)) {
      const afterColon = value.substring(value.indexOf(':') + 1);
      setAutocompleteCommand('create');
      setAutocompleteFilter(afterColon);
      
      // Build workspace file options (flatten the structure)
      const options: AutocompleteOption[] = flattenWorkspaceFiles(workspaceFiles).map((file) => ({
        value: file.path,
        label: file.name,
        description: `Path: ${file.path}`,
        type: 'workspace' as const,
      }));
      
      setAutocompleteOptions(options);
      setShowAutocomplete(true);
    } else {
      setShowAutocomplete(false);
      setAutocompleteCommand(null);
    }
  };

  // Flatten workspace files for easier filtering
  const flattenWorkspaceFiles = (files: any[]): any[] => {
    const result: any[] = [];
    for (const file of files) {
      if (file.type === 'file') {
        result.push(file);
      }
    }
    return result;
  };

  // Handle autocomplete selection
  const handleAutocompleteSelect = (value: string) => {
    if (autocompleteCommand === 'run') {
      setInput(`/run ${value}`);
    } else if (autocompleteCommand === 'create') {
      setInput(`/create :${value}`);
    }
    setShowAutocomplete(false);
    setAutocompleteCommand(null);
    textareaRef.current?.focus();
  };

  // Close autocomplete
  const handleAutocompleteClose = () => {
    setShowAutocomplete(false);
    setAutocompleteCommand(null);
  };

  const handleSubmit = async () => {
    const trimmedInput = input.trim();
    if (!trimmedInput || isProcessing) {
      console.log('Submit blocked:', { trimmedInput, isProcessing });
      return;
    }

    // Clear input
    setInput('');

    // Add user message
    addMessage('user', trimmedInput);

    // Show processing state
    setProcessing(true);
    setStatus('Processing...');

    try {
      // Check for special commands
      if (trimmedInput.startsWith('/')) {
        await handleCommand(trimmedInput);
      } else {
        // Process as natural language - result will be streamed
        startStreaming();
        
        // Require conversation to be active
        if (!currentConversationId) {
          addMessage('error', '❌ Error: No active conversation. Please create a new conversation first.');
          return;
        }
        
        console.log(`[ABORT] Frontend sending processInput with conversationId: ${currentConversationId}`);
        
        // Get fresh messages array after adding user message
        const currentMessages = useChatStore.getState().messages;
        const result = await window.electronAPI.processInput(trimmedInput, currentConversationId, currentMessages);

        // Streaming will be finalized automatically by the 'dml-output-end' event

        // If streaming failed or no output was streamed, show error
        if (!result.success) {
          addMessage('error', `❌ Error: ${result.error}`);
        }
      }
    } catch (error) {
      addMessage('error', `❌ Error: ${(error as Error).message}`);
    } finally {
      setProcessing(false);
      setStatus('Ready');
    }
  };

  const handleCommand = async (command: string) => {
    const parts = command.split(' ');
    const cmd = parts[0].toLowerCase();
    const args = parts.slice(1).join(' ');

    console.log('[InputArea] Handling command:', cmd, 'args:', args);

    switch (cmd) {
      case '/help':
        showHelp();
        break;

      case '/create':
        if (args) {
          // Check if args starts with a colon (file path syntax)
          if (args.startsWith(':')) {
            const filepath = args.substring(1).trim();
            if (!filepath) {
              addMessage('system', '❌ Usage: /create:<filepath> or /create <description>');
              break;
            }
            
            // Read the prompt from the file
            try {
              const workspaceResult = await window.electronAPI.getPaths();
              if (!workspaceResult.success || !workspaceResult.paths) {
                addMessage('error', `❌ Failed to get workspace path`);
                break;
              }
              
              const fullPath = `${workspaceResult.paths.workspace}/${filepath}`;
              const fileResult = await window.electronAPI.readFile(fullPath);
              
              if (!fileResult.success || !fileResult.content) {
                addMessage('error', `❌ Failed to read file: ${fileResult.error || 'Unknown error'}`);
                break;
              }
              
              // Use the file content as the prompt
              startStreaming();
              const result = await window.electronAPI.createDml(fileResult.content);
              // Streaming will be finalized automatically by the 'dml-output-end' event
              
              if (!result.success) {
                addMessage('error', `❌ ${result.error}`);
              }
            } catch (error) {
              addMessage('error', `❌ Error reading file: ${(error as Error).message}`);
            }
          } else {
            // Regular /create with description
            startStreaming();
            const result = await window.electronAPI.createDml(args);
            // Streaming will be finalized automatically by the 'dml-output-end' event
            
            if (!result.success) {
              addMessage('error', `❌ ${result.error}`);
            }
          }
        } else {
          addMessage('system', '❌ Usage: /create <description> or /create:<filepath>');
        }
        break;

      case '/save':
        if (args) {
          const result = await window.electronAPI.saveDml(args);
          if (result.success) {
            await refreshDmlFiles();
            addMessage('system', `✅ ${result.result}`);
          } else {
            addMessage('error', `❌ ${result.error}`);
          }
        } else {
          addMessage('system', '❌ Usage: /save <filename>');
        }
        break;

      case '/run':
        if (args) {
          // Require conversation to be active
          if (!currentConversationId) {
            addMessage('error', '❌ Error: No active conversation. Please create a new conversation first.');
            break;
          }
          
          console.log(`[ABORT] Frontend sending runDmlFile with conversationId: ${currentConversationId}`);
          startStreaming();
          const result = await window.electronAPI.runDmlFile(args, '{}', currentConversationId);
          // Streaming will be finalized automatically by the 'dml-output-end' event

          if (!result.success) {
            addMessage('error', `❌ ${result.error}`);
          }
        } else {
          addMessage('system', '❌ Usage: /run <filename>');
        }
        break;

      case '/learn':
        if (args) {
          const result = await window.electronAPI.learnDmlFile(args);
          if (result.success) {
            addMessage('system', `✅ ${result.message}`);
            // Refresh the file list to show the new file in learned folder
            await refreshDmlFiles();
          } else {
            addMessage('error', `❌ ${result.error}`);
          }
        } else {
          addMessage('system', '❌ Usage: /learn <filename>');
        }
        break;

      case '/explain':
        console.log('[InputArea] /explain command triggered');
        console.log('[InputArea] currentConversationId:', currentConversationId);
        
        // Require conversation to be active
        if (!currentConversationId) {
          console.log('[InputArea] No active conversation, showing error');
          addMessage('error', '❌ Error: No active conversation found.\n\nTo use /explain:\n1. Create a new conversation (click "New Conversation")\n2. Run a DML file using: /run <filepath>\n3. Then use: /explain');
          break;
        }
        
        console.log('[InputArea] Starting streaming for explanation');
        startStreaming();
        
        console.log('[InputArea] Calling explainExecution API');
        const explainResult = await window.electronAPI.explainExecution(currentConversationId);
        console.log('[InputArea] explainExecution result:', explainResult);
        
        // Streaming will be finalized automatically by the 'dml-output-end' event
        
        if (!explainResult.success) {
          console.log('[InputArea] Explanation failed:', explainResult.error);
          addMessage('error', `❌ ${explainResult.error}`);
        } else {
          console.log('[InputArea] Explanation succeeded');
        }
        break;

      case '/list':
        const result = await window.electronAPI.listDmlFiles();
        if (result.success) {
          addMessage('agent', result.result || '', true);
        } else {
          addMessage('error', `❌ ${result.error}`);
        }
        break;

      default:
        addMessage('system', `❌ Unknown command: ${cmd}. Type /help for help.`);
    }
  };

  const showHelp = () => {
    const helpText = `**Available Commands:**

- **/help** - Show this help message
- **/create <description>** - Generate new DML code from description
- **/create:<filepath>** - Generate new DML code from a file prompt in workspace (autocomplete with space + :)
- **/save <filename>** - Save last generated DML
- **/run <filename>** - Run a DML file (autocomplete after space)
- **/explain** - Explain the last executed DML file in simple, non-technical terms
- **/learn <filename>** - Copy a DML file to the learned folder, so it becomes part of the agent's DML generation context.
- **/list** - List all DML files

**Autocomplete:**
- Type **/run** followed by a space to see available DML files
- Type **/create** followed by space and **:** to browse workspace files
- Use ↑↓ arrows to navigate, Enter/Tab to select, Esc to close

**Natural Language:**
Just type what you want to do, and the agent will find or create the right DML files.

**The /explain command provides:**
- What the last executed DML program was designed to do
- How it worked step-by-step
- Which decisions were made by symbolic logic vs AI/LLM
- What the final result means

**Examples:**
- "Search for information about Python"
- "Analyze this document"
- "/create a script to download papers"
- "/create:my_prompt.txt"
- "/run search.dml"
- "/learn deep_research.dml"`;
    addMessage('system', helpText);
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    // If autocomplete is showing, let it handle navigation keys
    if (showAutocomplete && (e.key === 'ArrowUp' || e.key === 'ArrowDown' || e.key === 'Tab' || e.key === 'Escape')) {
      // Autocomplete component will handle these
      return;
    }
    
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      
      // Close autocomplete if it's showing when Enter is pressed
      if (showAutocomplete) {
        return; // Let autocomplete handle the Enter
      }
      
      handleSubmit();
    }
  };

  // Auto-resize textarea
  useEffect(() => {
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto';
      textareaRef.current.style.height = textareaRef.current.scrollHeight + 'px';
    }
  }, [input]);

  return (
    <div className="px-6 py-4 bg-bg-darkest border-t border-border/50">
      <div className="max-w-4xl mx-auto" ref={containerRef}>
        <div className="relative">
          {showAutocomplete && (
            <Autocomplete
              options={autocompleteOptions}
              onSelect={handleAutocompleteSelect}
              onClose={handleAutocompleteClose}
              filter={autocompleteFilter}
            />
          )}
          <div className="flex items-end gap-3 bg-bg-medium rounded-2xl border border-border/50 p-2 shadow-lg hover:border-deepclause-primary/30 transition-all duration-200 focus-within:border-deepclause-primary focus-within:shadow-xl">
            <textarea
              ref={textareaRef}
              value={input}
              onChange={(e) => handleInputChange(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="Ask me anything or use /commands..."
              className="flex-1 bg-transparent px-3 py-2 text-text-primary resize-none min-h-[44px] max-h-[200px] focus:outline-none placeholder:text-text-secondary/50"
              rows={1}
              disabled={isProcessing}
            />
            <button
              onClick={handleSubmit}
              disabled={isProcessing || !input.trim()}
              className={`flex items-center justify-center w-10 h-10 rounded-xl transition-all duration-200 ${
                isProcessing || !input.trim()
                  ? 'bg-bg-light text-text-secondary cursor-not-allowed'
                  : 'bg-deepclause-primary text-white hover:bg-deepclause-primary/90 hover:scale-105 active:scale-95 shadow-md'
              }`}
              title="Send message"
            >
              <Send className="w-5 h-5" />
            </button>
          </div>
        </div>
        {isProcessing && (
          <div className="flex items-center justify-center gap-2 mt-2 text-xs text-text-secondary">
            <div className="w-1.5 h-1.5 bg-deepclause-primary rounded-full animate-pulse" />
            <span>Processing...</span>
          </div>
        )}
      </div>
    </div>
  );
}
