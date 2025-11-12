import { useEffect, useRef, useState } from 'react';
import { ChevronRight, File, FileCode } from 'lucide-react';

export interface AutocompleteOption {
  value: string;
  label: string;
  description?: string;
  type: 'dml' | 'workspace';
}

interface AutocompleteProps {
  options: AutocompleteOption[];
  onSelect: (value: string) => void;
  onClose: () => void;
  filter: string;
}

export function Autocomplete({ options, onSelect, onClose, filter }: AutocompleteProps) {
  const [selectedIndex, setSelectedIndex] = useState(0);
  const listRef = useRef<HTMLDivElement>(null);
  const optionRefs = useRef<(HTMLDivElement | null)[]>([]);

  // Filter options based on the filter string
  const filteredOptions = options.filter((option) => {
    const searchText = filter.toLowerCase();
    return (
      option.label.toLowerCase().includes(searchText) ||
      option.value.toLowerCase().includes(searchText) ||
      (option.description && option.description.toLowerCase().includes(searchText))
    );
  });

  // Reset selected index when filter changes
  useEffect(() => {
    setSelectedIndex(0);
  }, [filter]);

  // Scroll selected option into view
  useEffect(() => {
    if (optionRefs.current[selectedIndex]) {
      optionRefs.current[selectedIndex]?.scrollIntoView({
        block: 'nearest',
        behavior: 'smooth',
      });
    }
  }, [selectedIndex]);

  // Handle keyboard navigation
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        setSelectedIndex((prev) => (prev + 1) % filteredOptions.length);
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        setSelectedIndex((prev) => (prev - 1 + filteredOptions.length) % filteredOptions.length);
      } else if (e.key === 'Enter' || e.key === 'Tab') {
        e.preventDefault();
        if (filteredOptions[selectedIndex]) {
          onSelect(filteredOptions[selectedIndex].value);
        }
      } else if (e.key === 'Escape') {
        e.preventDefault();
        onClose();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [filteredOptions, selectedIndex, onSelect, onClose]);

  if (filteredOptions.length === 0) {
    return (
      <div
        className="absolute bg-bg-dark border border-border rounded-lg shadow-2xl py-2 px-3 z-50 max-w-md mb-2 bottom-full"
      >
        <div className="text-text-tertiary text-sm">No matches found</div>
      </div>
    );
  }

  return (
    <div
      ref={listRef}
      className="absolute bg-bg-dark border border-border rounded-lg shadow-2xl py-1 z-50 max-w-md max-h-64 overflow-y-auto mb-2 bottom-full"
    >
      {filteredOptions.map((option, index) => (
        <div
          key={option.value}
          ref={(el) => (optionRefs.current[index] = el)}
          onClick={() => onSelect(option.value)}
          className={`
            flex items-start gap-3 px-3 py-2 cursor-pointer transition-colors
            ${
              index === selectedIndex
                ? 'bg-deepclause-primary/20 border-l-2 border-deepclause-primary'
                : 'hover:bg-bg-medium border-l-2 border-transparent'
            }
          `}
        >
          <div className="flex-shrink-0 mt-0.5">
            {option.type === 'dml' ? (
              <FileCode className="w-4 h-4 text-deepclause-primary" />
            ) : (
              <File className="w-4 h-4 text-text-tertiary" />
            )}
          </div>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2">
              <span className="text-sm font-medium text-text-primary truncate">
                {option.label}
              </span>
              {index === selectedIndex && (
                <ChevronRight className="w-3 h-3 text-deepclause-primary flex-shrink-0" />
              )}
            </div>
            {option.description && (
              <div className="text-xs text-text-tertiary mt-0.5 line-clamp-2">
                {option.description}
              </div>
            )}
          </div>
        </div>
      ))}
      <div className="border-t border-border mt-1 pt-1 px-3 pb-2">
        <div className="text-xs text-text-tertiary">
          ↑↓ Navigate · Enter/Tab Select · Esc Close
        </div>
      </div>
    </div>
  );
}
