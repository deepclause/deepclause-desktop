import { useEffect, useRef, useState } from 'react';
import { X, Loader2 } from 'lucide-react';
import styles from './CompileLogView.module.css';
import { useChatStore } from '../../stores/useChatStore';

interface CompileLogViewProps {
  onClose: () => void;
  isCompiling: boolean;
}

export function CompileLogView({ onClose, isCompiling }: CompileLogViewProps) {
  const [output, setOutput] = useState('');
  const outputRef = useRef<HTMLDivElement>(null);
  const [isComplete, setIsComplete] = useState(false);
  const streamingMessage = useChatStore((state) => state.streamingMessage);

  // Subscribe to streaming message from chat store
  useEffect(() => {
    if (streamingMessage) {
      setOutput(streamingMessage.content);
    }
  }, [streamingMessage]);

  // Detect when streaming ends
  useEffect(() => {
    if (!isCompiling && output) {
      setIsComplete(true);
    }
  }, [isCompiling, output]);

  // Auto-scroll to bottom when output updates
  useEffect(() => {
    if (outputRef.current) {
      outputRef.current.scrollTop = outputRef.current.scrollHeight;
    }
  }, [output]);

  const handleClose = () => {
    if (isCompiling && !isComplete) {
      const confirmed = window.confirm(
        'Compilation is still in progress. Closing this window will not stop the compilation. Continue?'
      );
      if (!confirmed) {
        return;
      }
    }
    onClose();
  };

  return (
    <div className={styles.overlay}>
      <div className={styles.modal}>
        {/* Header */}
        <div className={styles.header}>
          <h2 className={styles.title}>DML Compilation</h2>
          <button
            onClick={handleClose}
            className={styles.closeButton}
            title="Close"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Content */}
        <div className={styles.content}>
          {/* Streaming Output Section */}
          <div className={styles.section}>
            <div className={styles.sectionHeader}>
              <span className={styles.sectionTitle}>DML Output</span>
              <span className={`${styles.sectionBadge} ${isComplete ? styles.complete : styles.streaming}`}>
                {isComplete ? 'Complete' : 'Streaming...'}
              </span>
            </div>
            <div className={styles.outputBox} ref={outputRef}>
              {output ? (
                <pre className={styles.outputText}>{output}</pre>
              ) : (
                <div className={styles.placeholder}>
                  Waiting for output...
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Loading Spinner Overlay when compiling */}
        {isCompiling && !isComplete && (
          <div className={styles.loadingOverlay}>
            <Loader2 className={styles.spinner} />
            <p className={styles.loadingText}>Generating DML code...</p>
            <p className={styles.loadingSubtext}>This may take a minute</p>
          </div>
        )}
      </div>
    </div>
  );
}
