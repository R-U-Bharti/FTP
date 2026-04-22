import React from 'react';

interface ProgressBarProps {
  /** Progress value from 0 to 100 */
  value: number;
  /** Size variant */
  size?: 'sm' | 'md' | 'lg';
  /** Color variant */
  variant?: 'default' | 'success' | 'warning' | 'error';
  /** Whether to show percentage label */
  showLabel?: boolean;
  /** Whether to animate the bar */
  animated?: boolean;
  className?: string;
}

/** Animated progress bar with gradient styling */
export const ProgressBar: React.FC<ProgressBarProps> = ({
  value,
  size = 'md',
  variant = 'default',
  showLabel = false,
  animated = true,
  className = '',
}) => {
  const clampedValue = Math.min(100, Math.max(0, value));

  const heights: Record<string, string> = {
    sm: 'h-1.5',
    md: 'h-2.5',
    lg: 'h-4',
  };

  const gradients: Record<string, string> = {
    default: 'from-violet-500 to-indigo-500',
    success: 'from-emerald-500 to-teal-500',
    warning: 'from-amber-500 to-orange-500',
    error: 'from-red-500 to-rose-500',
  };

  return (
    <div className={`w-full ${className}`}>
      {showLabel && (
        <div className="flex justify-between mb-1">
          <span className="text-xs text-gray-400">{clampedValue.toFixed(0)}%</span>
        </div>
      )}
      <div className={`w-full bg-white/5 rounded-full overflow-hidden ${heights[size]}`}>
        <div
          className={`${heights[size]} bg-gradient-to-r ${gradients[variant]} rounded-full transition-all duration-300 ease-out ${animated ? 'relative overflow-hidden' : ''}`}
          style={{ width: `${clampedValue}%` }}
        >
          {animated && clampedValue > 0 && clampedValue < 100 && (
            <div className="absolute inset-0 bg-gradient-to-r from-transparent via-white/20 to-transparent animate-shimmer" />
          )}
        </div>
      </div>
    </div>
  );
};
