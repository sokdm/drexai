import { z } from "zod";
export * from "./editor.js";

export const brand = {
  name: "Drex",
  tagline: "One connected AI workspace for YouTube automation.",
  supportEmail: "support@drex.ai"
};

export const creditPackageSchema = z.object({
  id: z.string(),
  name: z.string(),
  credits: z.number().int().positive(),
  priceUsd: z.number().positive()
});

export type CreditPackage = z.infer<typeof creditPackageSchema>;

export const creditPackages: CreditPackage[] = [
  { id: "mini", name: "Mini", credits: 500, priceUsd: 10 },
  { id: "starter", name: "Starter", credits: 1000, priceUsd: 20 },
  { id: "creator", name: "Creator", credits: 5000, priceUsd: 90 }
];
