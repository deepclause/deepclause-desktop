import React from 'react';
import { LucideIcon } from 'lucide-react';

interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: 'primary' | 'secondary' | 'danger' | 'ghost';
  size?: 'sm' | 'md' | 'lg';
  icon?: LucideIcon;
  children: React.ReactNode;
}

export function Button({
  variant = 'primary',
  size = 'md',
  icon: Icon,
  children,
  className = '',
  disabled,
  ...props
}: ButtonProps) {
  const baseClasses = 'inline-flex items-center justify-center gap-2 rounded font-medium transition-all duration-200';

  const variantClasses = {
    primary: 'bg-deepclause-primary text-white hover:bg-deepclause-primary-dark shadow-soft hover:shadow-medium hover:-translate-y-0.5 disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:translate-y-0 disabled:shadow-none',
    secondary: 'bg-bg-light text-text-primary border border-border hover:bg-bg-hover hover:border-deepclause-primary disabled:opacity-50 disabled:cursor-not-allowed',
    danger: 'bg-deepclause-danger text-white hover:bg-red-700 shadow-soft hover:shadow-medium hover:-translate-y-0.5 disabled:opacity-50 disabled:cursor-not-allowed',
    ghost: 'bg-transparent text-text-secondary hover:text-text-primary hover:bg-bg-medium disabled:opacity-50 disabled:cursor-not-allowed',
  };

  const sizeClasses = {
    sm: 'px-2 py-1 text-sm',
    md: 'px-4 py-2 text-base',
    lg: 'px-6 py-3 text-lg',
  };

  return (
    <button
      className={`${baseClasses} ${variantClasses[variant]} ${sizeClasses[size]} ${className}`}
      disabled={disabled}
      {...props}
    >
      {Icon && <Icon className="w-4 h-4" />}
      {children}
    </button>
  );
}
