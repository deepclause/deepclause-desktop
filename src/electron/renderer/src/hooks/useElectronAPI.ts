import { useEffect } from 'react';
import { useAppStore } from '../stores/useAppStore';
import { useChatStore } from '../stores/useChatStore';
import { useFileStore } from '../stores/useFileStore';

export function useElectronAPI() {
  const setPaths = useAppStore((state) => state.setPaths);
  const setStatus = useAppStore((state) => state.setStatus);
  const refreshDmlFiles = useFileStore((state) => state.refreshDmlFiles);
  const refreshWorkspaceFiles = useFileStore((state) => state.refreshWorkspaceFiles);

  // Initialize agent on mount
  useEffect(() => {
    const initializeAgent = async () => {
      setStatus('Initializing agent...');
      const result = await window.electronAPI.initializeAgent();

      if (result.success && result.paths) {
        setPaths(result.paths);
        setStatus('Ready');
        await Promise.all([refreshDmlFiles(), refreshWorkspaceFiles()]);
      } else {
        setStatus('Initialization failed: ' + result.error);
      }
    };

    initializeAgent();
  }, [setPaths, setStatus, refreshDmlFiles, refreshWorkspaceFiles]);

  // Setup streaming output handler
  useEffect(() => {
    const handleChunk = (chunk: string) => {
      useChatStore.getState().appendToStreaming(chunk);
    };

    window.electronAPI.onDmlOutputChunk(handleChunk);
    
    // Note: Electron's ipcRenderer.on doesn't return an unsubscribe function
    // and we only set this up once, so no cleanup needed
  }, []); // Empty deps - only set up once

  // Setup streaming end handler
  useEffect(() => {
    const handleStreamEnd = () => {
      const isAborting = useAppStore.getState().isAborting;
      
      useChatStore.getState().finalizeStreaming();
      
      // Add abort completion message if aborting
      if (isAborting) {
        useChatStore.getState().addMessage('system', '⏹️ Execution aborted');
        useAppStore.getState().setAborting(false);
      }
      
      // Refresh workspace after DML execution completes
      refreshWorkspaceFiles();
    };

    window.electronAPI.onDmlOutputEnd(handleStreamEnd);
    
    // Note: Electron's ipcRenderer.on doesn't return an unsubscribe function
    // and we only set this up once, so no cleanup needed
  }, [refreshWorkspaceFiles]); // Include refreshWorkspaceFiles in deps

  // Setup input request handler
  useEffect(() => {
    const handleInputRequest = (data: { 
      requestId: string; 
      promptText: string;
      inputType?: 'text' | 'file' | 'select' | 'multiselect';
      options?: string[];
    }) => {
      // Show system message
      useChatStore.getState().addMessage('system', `⌛ Waiting for input: ${data.promptText}`);
      // Show input dialog
      useAppStore.getState().setInputRequest({
        requestId: data.requestId,
        promptText: data.promptText,
        inputType: data.inputType || 'text',
        options: data.options || []
      });
    };

    window.electronAPI.onRequestUserInput(handleInputRequest);
    
    // Note: Electron's ipcRenderer.on doesn't return an unsubscribe function
    // and we only set this up once, so no cleanup needed
  }, []); // Empty deps - only set up once

  // Setup refresh DML files handler
  useEffect(() => {
    const handleRefreshDmlFiles = () => {
      refreshDmlFiles();
    };

    window.electronAPI.onRefreshDmlFiles(handleRefreshDmlFiles);
    
    // Note: Electron's ipcRenderer.on doesn't return an unsubscribe function
    // and we only set this up once, so no cleanup needed
  }, [refreshDmlFiles]); // Include refreshDmlFiles in deps

  return window.electronAPI;
}
