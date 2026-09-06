import CrimeGraphLogo from './CrimeGraphLogo';

interface CrimeGraphLoaderProps {
  size?: number;
  showText?: boolean;
  text?: string;
  fullPage?: boolean;
  className?: string;
}

export default function CrimeGraphLoader({
  size = 32,
  showText = false,
  text = 'Loading...',
  fullPage = false,
  className = '',
}: CrimeGraphLoaderProps) {
  const content = (
    <div
      role="status"
      aria-label="Loading"
      className={`inline-flex flex-col items-center justify-center gap-3 select-none ${className}`}
    >
      <div className="animate-crimegraph-pulse flex items-center justify-center">
        <CrimeGraphLogo size={size} showText={showText} />
      </div>

      {text && (
        <span className="text-xs font-mono font-medium text-zinc-500 tracking-tight animate-pulse">
          {text}
        </span>
      )}
      <span className="sr-only">Loading...</span>
    </div>
  );

  if (fullPage) {
    return (
      <div className="min-h-[300px] w-full flex items-center justify-center p-8">
        {content}
      </div>
    );
  }

  return content;
}
