export function SiteMark({ className = "size-9" }: { className?: string }) {
  return (
    <img
      src="/site-mark.png"
      alt=""
      aria-hidden="true"
      className={`shrink-0 object-contain ${className}`}
    />
  );
}
