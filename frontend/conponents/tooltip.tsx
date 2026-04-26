import React, { useEffect, useRef, useState } from 'react';

type Side = 'top' | 'bottom' | 'left' | 'right';

interface TooltipProps {
  label: React.ReactNode;
  children: React.ReactNode;
  side?: Side;
  delay?: number;
  block?: boolean;
  className?: string;
  contentClassName?: string;
}

export const Tooltip: React.FC<TooltipProps> = ({
  label,
  children,
  side = 'top',
  delay = 220,
  block = false,
  className = '',
  contentClassName = '',
}) => {
  const [visible, setVisible] = useState(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(
    () => () => {
      if (timerRef.current) {
        clearTimeout(timerRef.current);
      }
    },
    []
  );

  if (label === null || label === undefined || label === false || label === '') {
    return <>{children}</>;
  }

  const show = () => {
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => setVisible(true), delay);
  };
  const hide = () => {
    if (timerRef.current) clearTimeout(timerRef.current);
    setVisible(false);
  };

  const sideClass: Record<Side, string> = {
    top: 'bottom-full left-1/2 -translate-x-1/2 mb-1.5',
    bottom: 'top-full left-1/2 -translate-x-1/2 mt-1.5',
    left: 'right-full top-1/2 -translate-y-1/2 mr-1.5',
    right: 'left-full top-1/2 -translate-y-1/2 ml-1.5',
  };

  const wrapperStyle: React.CSSProperties = block
    ? { position: 'relative', display: 'block', width: '100%' }
    : { position: 'relative', display: 'inline-flex' };

  return (
    <span
      style={wrapperStyle}
      className={className}
      onMouseEnter={show}
      onMouseLeave={hide}
      onFocus={show}
      onBlur={hide}
    >
      {children}
      {visible && (
        <span
          role="tooltip"
          className={`pointer-events-none absolute z-[9999] max-w-[240px] whitespace-normal rounded-md border border-[#3a3a3a] bg-[#101015]/95 px-2 py-1 text-[11px] leading-snug font-medium text-white shadow-lg backdrop-blur-sm ${sideClass[side]} ${contentClassName}`}
        >
          {label}
        </span>
      )}
    </span>
  );
};

export default Tooltip;
