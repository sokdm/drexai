export function Loader({ label = "Loading" }: { label?: string }) {
  return (
    <div className="flex flex-col items-center gap-4 text-center">
      <div className="relative h-16 w-16">
        <span className="absolute inset-0 rounded-full border-2 border-brand/20" />
        <span className="absolute inset-2 animate-ping rounded-full bg-brand/20" />
        <span className="absolute inset-5 rounded-md bg-brand shadow-soft dark:bg-brand-dark" />
      </div>
      <p className="text-sm font-bold text-slate-600 dark:text-slate-300">{label}</p>
    </div>
  );
}
