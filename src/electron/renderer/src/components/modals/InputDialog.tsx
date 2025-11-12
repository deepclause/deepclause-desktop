import { useState, useEffect, useRef } from 'react';
import { X, File } from 'lucide-react';
import { Button } from '../ui/Button';

interface InputDialogProps {
  requestId: string;
  promptText: string;
  inputType?: 'text' | 'file' | 'select' | 'multiselect';
  options?: string[];
  onSubmit: (requestId: string, userInput: string) => void;
  onCancel: (requestId: string) => void;
}

export function InputDialog({ 
  requestId, 
  promptText, 
  inputType = 'text',
  options = [],
  onSubmit, 
  onCancel 
}: InputDialogProps) {
  const [input, setInput] = useState('');
  const [selectedOptions, setSelectedOptions] = useState<Set<string>>(new Set());
  const inputRef = useRef<HTMLInputElement>(null);
  const selectRef = useRef<HTMLSelectElement>(null);

  useEffect(() => {
    // Focus appropriate input when modal opens
    if (inputType === 'text') {
      inputRef.current?.focus();
    } else if (inputType === 'select' || inputType === 'multiselect') {
      selectRef.current?.focus();
    }
  }, [inputType]);

  const handleSubmit = () => {
    let valueToSubmit = input;
    
    if (inputType === 'multiselect') {
      // Join selected options with commas
      valueToSubmit = Array.from(selectedOptions).join(', ');
    }
    
    onSubmit(requestId, valueToSubmit);
  };

  const handleCancel = () => {
    onCancel(requestId);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && inputType === 'text') {
      handleSubmit();
    } else if (e.key === 'Escape') {
      handleCancel();
    }
  };

  const handleFileSelect = async () => {
    try {
      const result = await window.electronAPI.selectWorkspaceFile({
        title: 'Select File for Parameter'
      });
      
      if (result.success && result.filePath) {
        setInput(result.filePath);
      }
    } catch (error) {
      console.error('Error selecting file:', error);
    }
  };

  const handleMultiselectToggle = (option: string) => {
    const newSelected = new Set(selectedOptions);
    if (newSelected.has(option)) {
      newSelected.delete(option);
    } else {
      newSelected.add(option);
    }
    setSelectedOptions(newSelected);
  };

  const renderInputField = () => {
    switch (inputType) {
      case 'file':
        return (
          <div className="space-y-3">
            <div className="flex gap-2">
              <input
                ref={inputRef}
                type="text"
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={handleKeyDown}
                placeholder="Enter file path or click Browse..."
                className="flex-1 bg-bg-light border border-border rounded px-3 py-2 text-text-primary focus:outline-none focus:border-deepclause-primary focus:ring-2 focus:ring-deepclause-primary focus:ring-opacity-20"
              />
              <Button 
                variant="secondary" 
                onClick={handleFileSelect}
                className="whitespace-nowrap"
              >
                <File className="w-4 h-4 mr-2" />
                Browse...
              </Button>
            </div>
          </div>
        );

      case 'select':
        return (
          <select
            ref={selectRef}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            className="w-full bg-bg-light border border-border rounded px-3 py-2 text-text-primary focus:outline-none focus:border-deepclause-primary focus:ring-2 focus:ring-deepclause-primary focus:ring-opacity-20"
          >
            <option value="">-- Select an option --</option>
            {options.map((option) => (
              <option key={option} value={option}>
                {option}
              </option>
            ))}
          </select>
        );

      case 'multiselect':
        return (
          <div className="space-y-2 max-h-64 overflow-y-auto border border-border rounded bg-bg-light p-3">
            {options.length === 0 ? (
              <p className="text-text-secondary text-sm">No options available</p>
            ) : (
              options.map((option) => (
                <label
                  key={option}
                  className="flex items-center gap-2 p-2 hover:bg-bg-medium rounded cursor-pointer transition-colors"
                >
                  <input
                    type="checkbox"
                    checked={selectedOptions.has(option)}
                    onChange={() => handleMultiselectToggle(option)}
                    className="w-4 h-4 text-deepclause-primary rounded focus:ring-2 focus:ring-deepclause-primary focus:ring-opacity-20"
                  />
                  <span className="text-text-primary">{option}</span>
                </label>
              ))
            )}
          </div>
        );

      default: // 'text'
        return (
          <input
            ref={inputRef}
            type="text"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Enter your response..."
            className="w-full bg-bg-light border border-border rounded px-3 py-2 text-text-primary focus:outline-none focus:border-deepclause-primary focus:ring-2 focus:ring-deepclause-primary focus:ring-opacity-20"
          />
        );
    }
  };

  return (
    <div className="fixed inset-0 bg-black bg-opacity-70 flex items-center justify-center z-50 animate-fade-in">
      <div className="bg-bg-medium border border-border rounded-lg p-8 min-w-[400px] max-w-[600px] shadow-medium animate-fade-in-up">
        <div className="flex justify-between items-start mb-4">
          <h3 className="text-xl font-semibold text-deepclause-primary">
            Input Required
          </h3>
          <button
            onClick={handleCancel}
            className="text-text-secondary hover:text-text-primary transition-colors"
            title="Cancel"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <p className="text-text-primary mb-6 leading-relaxed">
          {promptText}
        </p>

        <div className="mb-6">
          {renderInputField()}
        </div>

        <div className="flex gap-3 justify-end">
          <Button variant="secondary" onClick={handleCancel}>
            Cancel
          </Button>
          <Button variant="primary" onClick={handleSubmit}>
            Submit
          </Button>
        </div>
      </div>
    </div>
  );
}
