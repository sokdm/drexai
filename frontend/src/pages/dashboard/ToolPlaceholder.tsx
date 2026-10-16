import { dashboardItems } from "../../config/navigation";

export function ToolPlaceholder({ slug }: { slug: string }) {
  const item = dashboardItems.find((entry) => entry.path.endsWith(slug));
  const Icon = item?.icon;
  return (
    <section className="rounded-md border border-line bg-white p-8 dark:border-slate-800 dark:bg-slate-900">
      {Icon && <Icon className="mb-5 text-brand dark:text-brand-dark" size={32} />}
      <p className="text-sm font-semibold text-brand dark:text-brand-dark">Coming in a later phase</p>
      <h2 className="mt-2 text-3xl font-black">{item?.label ?? "Feature"}</h2>
      <p className="mt-3 max-w-2xl text-slate-600 dark:text-slate-300">This route is wired into the dashboard with a polished placeholder so future functionality can be added without changing navigation structure.</p>
    </section>
  );
}
