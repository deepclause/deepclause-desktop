import React from 'react';
import { useAppStore } from '../../stores/useAppStore';

export function StatusBar() {
  const { status, currentPaths } = useAppStore();

  return (
    <footer className="flex justify-between items-center px-6 py-2 bg-bg-medium border-t border-border text-sm text-text-secondary">
      <span>{status}</span>
      {currentPaths && (
        <span
          className="font-mono text-xs"
          title={`DML Examples: ${currentPaths.dmlExamples}\nConfig: ${currentPaths.config}`}
        >
          Workspace: {currentPaths.workspace}
        </span>
      )}
    </footer>
  );
}
