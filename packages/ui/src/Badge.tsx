import React from 'react';

interface BadgeProps {
  /** Badge text content */
  children: React.ReactNode;
  /** Color variant */
  variant?: 'default' | 'success' | 'warning' | 'error' | 'info';
  /** Whether to show a pulsing dot indicator */
  pulse?: boolean;
  className?: string;
}

/** Status badge with optional pulsing indicator */
export const Badge: React.FC<BadgeProps> = ({
  children,
  variant = 'default',
  pulse = false,
  className = '',
}) => {
  const variants: Record<string, string> = {
    default: 'bg-gray-500/20 text-gray-300 border-gray-500/30',
    success: 'bg-emerald-500/20 text-emerald-400 border-emerald-500/30',
    warning: 'bg-amber-500/20 text-amber-400 border-amber-500/30',
    error: 'bg-red-500/20 text-red-400 border-red-500/30',
    info: 'bg-sky-500/20 text-sky-400 border-sky-500/30',
  };

  const dotColors: Record<string, string> = {
    default: 'bg-gray-400',
    success: 'bg-emerald-400',
    warning: 'bg-amber-400',
    error: 'bg-red-400',
    info: 'bg-sky-400',
  };

  return (
    <span
      className={`inline-flex items-center gap-1.5 px-2 py-1 rounded-full text-xs font-medium border ${variants[variant]} ${className}`}
    >
      {pulse && (
        <span className="relative flex h-3 w-3">
          <span
            className={`animate-ping absolute inline-flex h-full w-full rounded-full opacity-75 ${dotColors[variant]}`}
          />
          <span
            className={`relative inline-flex rounded-full h-3 w-3 ${dotColors[variant]}`}
          />
        </span>
      )}
      {children}
    </span>
  );
};
