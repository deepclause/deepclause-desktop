import { useEffect } from 'react';
import { X, Settings } from 'lucide-react';
import { useAppStore } from '../../stores/useAppStore';
import { useSettingsStore } from '../../stores/useSettingsStore';
import { useConversationStore } from '../../stores/useConversationStore';
import { Button } from '../ui/Button';

export function Header() {
  const { isProcessing, isAborting, setAborting, setProcessing, setStatus } = useAppStore();
  const { openDialog, loadSettings } = useSettingsStore();
  const currentConversationId = useConversationStore((state) => state.currentConversationId);

  // Load settings on mount
  useEffect(() => {
    loadSettings();
  }, [loadSettings]);

  const handleAbort = async () => {
    if (isProcessing && !isAborting && currentConversationId) {
      try {
        console.log(`[ABORT] Frontend abort button clicked with conversationId: ${currentConversationId}`);
        setAborting(true);
        setStatus('Aborting...');
        
        // Pass the conversationId to abort specific conversation
        await window.electronAPI.abortExecution(currentConversationId);
        console.log(`[ABORT] Frontend abortExecution completed`);
        
        // Give a brief moment for the abort to take effect
        setTimeout(() => {
          setAborting(false);
          setProcessing(false);
          setStatus('Aborted');
          
          // Reset to Ready after showing "Aborted"
          setTimeout(() => {
            setStatus('Ready');
          }, 2000);
        }, 500);
      } catch (error) {
        console.error('Error aborting execution:', error);
        setAborting(false);
        setStatus('Ready');
      }
    }
  };

  const handleOpenSettings = () => {
    openDialog();
  };

  return (
    <header className="flex justify-between items-center px-6 py-4 bg-bg-darkest border-b-2 border-deepclause-primary shadow-soft">
      <div className="flex items-center gap-4">
        <img
          src="assets/logo_only.png"
          alt="DeepClause Logo"
          className="h-12 w-12 object-contain grayscale contrast-125"
        />
        <div className="flex flex-col">
          <h1 className="text-2xl font-bold text-deepclause-primary tracking-tight">
            DeepClause
          </h1>
          <p className="text-xs text-text-secondary uppercase tracking-wider font-medium">
            Neurosymbolic AI System
          </p>
        </div>
      </div>

      <div className="flex gap-2">
        <Button
          variant="secondary"
          size="sm"
          icon={Settings}
          onClick={handleOpenSettings}
          title="Settings"
        >
          Settings
        </Button>
        {isProcessing && (
          <Button
            variant="danger"
            size="sm"
            icon={X}
            onClick={handleAbort}
            title={isAborting ? "Aborting..." : "Abort execution"}
            disabled={isAborting}
          >
            {isAborting ? 'Aborting...' : 'Abort'}
          </Button>
        )}
      </div>
    </header>
  );
}
