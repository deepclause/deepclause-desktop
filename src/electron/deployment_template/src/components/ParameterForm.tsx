import { useState, useEffect } from 'react';
import { Play, RotateCw } from 'lucide-react';

interface Parameter {
  key: string;
  name: string;
  description: string;
  type: 'text' | 'file' | 'select' | 'multiselect' | 'number' | 'boolean';
  options?: string[];
  default?: any;
}

interface ParameterFormProps {
  parameters: Parameter[];
  onExecute: (values: Record<string, any>, files: Record<string, File>) => void;
  isExecuting: boolean;
}

export default function ParameterForm({ parameters, onExecute, isExecuting }: ParameterFormProps) {
  const [values, setValues] = useState<Record<string, any>>({});
  const [files, setFiles] = useState<Record<string, File>>({});

  // Initialize with default values
  useEffect(() => {
    const defaults: Record<string, any> = {};
    parameters.forEach(param => {
      if (param.default !== undefined) {
        defaults[param.key] = param.default;
      } else if (param.type === 'boolean') {
        defaults[param.key] = false;
      } else if (param.type === 'multiselect') {
        defaults[param.key] = [];
      } else {
        defaults[param.key] = '';
      }
    });
    setValues(defaults);
  }, [parameters]);

  const handleChange = (key: string, value: any) => {
    setValues(prev => ({ ...prev, [key]: value }));
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    onExecute(values, files);
  };
  
  const handleFileChange = (key: string, file: File | null) => {
    if (file) {
      setFiles(prev => ({ ...prev, [key]: file }));
      setValues(prev => ({ ...prev, [key]: file.name }));
    } else {
      setFiles(prev => {
        const newFiles = { ...prev };
        delete newFiles[key];
        return newFiles;
      });
      setValues(prev => ({ ...prev, [key]: '' }));
    }
  };

  const handleReset = () => {
    const defaults: Record<string, any> = {};
    parameters.forEach(param => {
      if (param.default !== undefined) {
        defaults[param.key] = param.default;
      } else if (param.type === 'boolean') {
        defaults[param.key] = false;
      } else if (param.type === 'multiselect') {
        defaults[param.key] = [];
      } else {
        defaults[param.key] = '';
      }
    });
    setValues(defaults);
  };

  const renderInput = (param: Parameter) => {
    const value = values[param.key] ?? '';

    switch (param.type) {
      case 'boolean':
        return (
          <label className="flex items-center gap-2 cursor-pointer">
            <input
              type="checkbox"
              checked={value}
              onChange={(e) => handleChange(param.key, e.target.checked)}
              className="w-4 h-4 text-primary-600 border-gray-300 rounded focus:ring-primary-500"
              disabled={isExecuting}
            />
            <span className="text-sm text-gray-700">{param.description}</span>
          </label>
        );

      case 'select':
        return (
          <select
            value={value}
            onChange={(e) => handleChange(param.key, e.target.value)}
            className="input-field"
            disabled={isExecuting}
          >
            <option value="">Select an option</option>
            {param.options?.map(option => (
              <option key={option} value={option}>{option}</option>
            ))}
          </select>
        );

      case 'multiselect':
        return (
          <div className="space-y-2">
            {param.options?.map(option => (
              <label key={option} className="flex items-center gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={value.includes(option)}
                  onChange={(e) => {
                    const newValue = e.target.checked
                      ? [...value, option]
                      : value.filter((v: string) => v !== option);
                    handleChange(param.key, newValue);
                  }}
                  className="w-4 h-4 text-primary-600 border-gray-300 rounded focus:ring-primary-500"
                  disabled={isExecuting}
                />
                <span className="text-sm text-gray-700">{option}</span>
              </label>
            ))}
          </div>
        );

      case 'file':
        return (
          <div className="space-y-2">
            <input
              type="file"
              onChange={(e) => {
                const file = e.target.files?.[0] || null;
                handleFileChange(param.key, file);
              }}
              className="input-field"
              disabled={isExecuting}
            />
            {value && (
              <p className="text-xs text-gray-600">
                Selected: <span className="font-medium">{value}</span>
              </p>
            )}
          </div>
        );

      case 'number':
        return (
          <input
            type="number"
            value={value}
            onChange={(e) => handleChange(param.key, e.target.value)}
            className="input-field"
            disabled={isExecuting}
          />
        );

      default:
        return (
          <input
            type="text"
            value={value}
            onChange={(e) => handleChange(param.key, e.target.value)}
            placeholder={param.description}
            className="input-field"
            disabled={isExecuting}
          />
        );
    }
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      {parameters.length === 0 ? (
        <p className="text-sm text-gray-600">No parameters required for this DML file.</p>
      ) : (
        parameters.map(param => (
          <div key={param.key}>
            {param.type !== 'boolean' && (
              <label className="label-text">
                {param.name || param.key}
              </label>
            )}
            {renderInput(param)}
            {param.type !== 'boolean' && param.description && (
              <p className="text-xs text-gray-500 mt-1">{param.description}</p>
            )}
          </div>
        ))
      )}

      <div className="flex gap-2 pt-4">
        <button
          type="submit"
          disabled={isExecuting}
          className="btn-primary flex-1 flex items-center justify-center gap-2"
        >
          {isExecuting ? (
            <>
              <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
              Executing...
            </>
          ) : (
            <>
              <Play className="w-4 h-4" />
              Execute
            </>
          )}
        </button>
        
        {parameters.length > 0 && (
          <button
            type="button"
            onClick={handleReset}
            disabled={isExecuting}
            className="btn-secondary flex items-center gap-2"
          >
            <RotateCw className="w-4 h-4" />
            Reset
          </button>
        )}
      </div>
    </form>
  );
}
