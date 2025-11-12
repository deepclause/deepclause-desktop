import { LucideIcon } from 'lucide-react';

interface EdgeTabProps {
  icon: LucideIcon;
  label: string;
  position: 'left' | 'right';
  isActive: boolean;
  onClick: () => void;
}

export function EdgeTab({ icon: Icon, label, position, isActive, onClick }: EdgeTabProps) {
  const positionClasses = position === 'left' 
    ? 'left-0 rounded-r-lg' 
    : 'right-0 rounded-l-lg';
  
  const hoverClasses = position === 'left'
    ? 'hover:translate-x-1'
    : 'hover:-translate-x-1';

  return (
    <button
      onClick={onClick}
      className={`
        fixed top-1/2 -translate-y-1/2 z-50
        ${positionClasses}
        ${isActive ? 'bg-deepclause-primary text-white' : 'bg-bg-medium text-text-secondary hover:bg-bg-light hover:text-text-primary'}
        flex flex-col items-center gap-1 px-2 py-4
        border-2 ${isActive ? 'border-deepclause-primary' : 'border-border'}
        shadow-lg transition-all duration-200 ease-out
        ${hoverClasses}
        group
      `}
      title={label}
    >
      <Icon className="w-5 h-5" />
      <span className="text-xs font-medium writing-mode-vertical transform rotate-180">
        {label}
      </span>
    </button>
  );
}
