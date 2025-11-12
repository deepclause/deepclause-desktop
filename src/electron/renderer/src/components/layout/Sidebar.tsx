import React from 'react';

interface SidebarProps {
  side: 'left' | 'right';
  title: string;
  visible: boolean;
  children: React.ReactNode;
  actions?: React.ReactNode;
  width?: string; // Optional custom width (e.g., 'w-96', 'w-[600px]')
  bgColor?: string; // Optional custom background color
}

export function Sidebar({ side, title, visible, children, actions, width = 'w-80', bgColor = 'bg-bg-medium' }: SidebarProps) {
  const sideClasses = side === 'left' ? 'border-r' : 'border-l';

  return (
    <aside
      className={`${bgColor} ${sideClasses} border-border flex flex-col flex-shrink-0 transition-all duration-300 ${
        visible ? width : 'w-0 overflow-hidden'
      }`}
    >
      <div className="flex justify-between items-center px-4 py-3 border-b-2 border-deepclause-primary bg-bg-darkest">
        <h3 className="text-xs font-semibold text-text-secondary uppercase tracking-wider">
          {title}
        </h3>
        {actions && <div className="flex gap-1">{actions}</div>}
      </div>
      <div className="flex-1 overflow-y-auto p-3">{children}</div>
    </aside>
  );
}
