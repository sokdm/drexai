import { brand } from "@drex/shared";

export function BrandMark() {
  return (
    <div className="flex items-center gap-3">
      <img src="/drex-logo.svg" alt="" className="h-10 w-10" />
      <span className="text-lg font-black tracking-normal">{brand.name}</span>
    </div>
  );
}
