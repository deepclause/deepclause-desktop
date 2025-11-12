import { useEffect, useRef } from 'react';
import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import '@xterm/xterm/css/xterm.css';

export function SerialConsole() {
  const terminalRef = useRef<HTMLDivElement>(null);
  const xtermRef = useRef<Terminal | null>(null);
  const fitAddonRef = useRef<FitAddon | null>(null);

  useEffect(() => {
    if (!terminalRef.current) return;

    // Create terminal instance
    const term = new Terminal({
      cursorBlink: true,
      fontSize: 14,
      fontFamily: 'Menlo, Monaco, "Courier New", monospace',
      theme: {
        background: '#1a1a1a', // Lighter than before (#0a0a0a)
        foreground: '#e5e5e5',
        cursor: '#00ff00',
        cursorAccent: '#000000',
        selectionBackground: '#555555',
        black: '#000000',
        red: '#ff5555',
        green: '#50fa7b',
        yellow: '#f1fa8c',
        blue: '#bd93f9',
        magenta: '#ff79c6',
        cyan: '#8be9fd',
        white: '#bbbbbb',
        brightBlack: '#555555',
        brightRed: '#ff5555',
        brightGreen: '#50fa7b',
        brightYellow: '#f1fa8c',
        brightBlue: '#bd93f9',
        brightMagenta: '#ff79c6',
        brightCyan: '#8be9fd',
        brightWhite: '#ffffff',
      },
      scrollback: 10000,
      convertEol: true,
      disableStdin: false,
      // Don't echo locally - the VM will echo back
      // This prevents double character display
    });

    // Create fit addon
    const fitAddon = new FitAddon();
    term.loadAddon(fitAddon);

    // Open terminal
    term.open(terminalRef.current);
    
    // Store references
    xtermRef.current = term;
    fitAddonRef.current = fitAddon;

    // Fit the terminal after a brief delay to ensure container has dimensions
    setTimeout(() => {
      fitAddon.fit();
    }, 100);

    // Handle terminal input - send to v86
    term.onData((data) => {
      window.electronAPI.sendSerialInput(data);
    });

    // Listen for serial output from v86
    const removeListener = window.electronAPI.onSerialOutput((data: string) => {
      term.write(data);
    });

    // Handle resize with debouncing
    let resizeTimeout: NodeJS.Timeout;
    const handleResize = () => {
      clearTimeout(resizeTimeout);
      resizeTimeout = setTimeout(() => {
        if (fitAddonRef.current) {
          fitAddonRef.current.fit();
        }
      }, 100);
    };
    window.addEventListener('resize', handleResize);

    // Also observe container size changes
    const resizeObserver = new ResizeObserver(() => {
      handleResize();
    });
    if (terminalRef.current) {
      resizeObserver.observe(terminalRef.current);
    }

    // Welcome message
    term.writeln('\x1b[1;32m╔═══════════════════════════════════════════════════════╗\x1b[0m');
    term.writeln('\x1b[1;32m║      v86 Linux VM Serial Console                     ║\x1b[0m');
    term.writeln('\x1b[1;32m╚═══════════════════════════════════════════════════════╝\x1b[0m');
    term.writeln('\x1b[36mConnecting to Linux VM...\x1b[0m');
    term.writeln('');

    // Request initial connection
    window.electronAPI.connectSerialConsole();

    // Cleanup
    return () => {
      window.removeEventListener('resize', handleResize);
      resizeObserver.disconnect();
      removeListener();
      term.dispose();
    };
  }, []);

  return (
    <div className="flex flex-col h-full w-full bg-bg-dark overflow-hidden">
      <div 
        ref={terminalRef} 
        className="flex-1 w-full"
        style={{ minHeight: 0 }}
      />
    </div>
  );
}
