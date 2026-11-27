import React, { useEffect, useState } from 'react';

interface SafeImageProps extends React.ImgHTMLAttributes<HTMLImageElement> {
  fallbackLabel?: string;
}

export const SafeImage: React.FC<SafeImageProps> = ({
  src,
  alt,
  className = '',
  fallbackLabel,
  ...rest
}) => {
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    setFailed(false);
  }, [src]);

  if (!src || failed) {
    return (
      <div
        className={`flex flex-col items-center justify-center bg-gradient-to-br from-surface-container-low via-surface-container to-primary-container/40 text-on-surface-variant p-4 text-center ${className}`}
        role="img"
        aria-label={alt || fallbackLabel || 'Atelier Spatial Preview'}
      >
        <span className="material-symbols-outlined text-primary/70 text-[28px] mb-1">
          view_in_ar
        </span>
        <span className="text-[11px] font-medium text-on-surface-variant/80 line-clamp-2">
          {fallbackLabel || alt || '3D Spatial Scene'}
        </span>
      </div>
    );
  }

  return (
    <img
      src={src}
      alt={alt}
      className={className}
      onError={() => setFailed(true)}
      {...rest}
    />
  );
};
