import { getSecret, loadConfig, setSecret } from "../store.js";
import type { Integration, IntegrationCategory, ProviderMeta, SettingValue } from "../types.js";
import { citygross, hemkop, ica, willys } from "./grocery.js";
import { haPrice, spotPrice } from "./price.js";
import { schoolIcs, schoolsoft, skola24, skolmatHa, skolmaten, vklass } from "./school.js";
import type { AnyProvider, GroceryProvider, PriceProvider, ProviderCtx, SchoolProvider, WasteProvider } from "./types.js";
import { wasteEdp, wasteHa, wasteIcs, wasteManual, wasteSrv, wasteStockholm } from "./waste.js";

/**
 * Every supported service, per category. To add one: implement the interface in
 * providers/types.ts, add it here – the setup wizard draws its form from `meta.fields`.
 */
export const PROVIDERS = {
  school: [skola24, schoolIcs, skolmaten, skolmatHa, vklass, schoolsoft] as SchoolProvider[],
  grocery: [willys, ica, citygross, hemkop] as GroceryProvider[],
  waste: [wasteEdp, wasteSrv, wasteStockholm, wasteManual, wasteIcs, wasteHa] as WasteProvider[],
  price: [spotPrice, haPrice] as PriceProvider[],
} satisfies Record<IntegrationCategory, AnyProvider[]>;

/** Which categories allow several integrations at once (one school calendar per child). */
export const MULTIPLE: Record<IntegrationCategory, boolean> = { school: true, grocery: true, waste: false, price: false };

export function allMeta(): ProviderMeta[] {
  return Object.values(PROVIDERS).flat().map((p) => p.meta);
}

export function findProvider<C extends IntegrationCategory>(category: C, id: string): (typeof PROVIDERS)[C][number] | undefined {
  return (PROVIDERS[category] as AnyProvider[]).find((p) => p.meta.id === id) as (typeof PROVIDERS)[C][number] | undefined;
}

export const secretKey = (integrationId: string, field: string) => `int.${integrationId}.${field}` as const;

/**
 * Build a provider context. `overrides` lets the wizard test with values not yet saved
 * (a typed password); secrets fall back to what is stored.
 */
export function makeCtx(integration: Integration, overrides: Record<string, string> = {}): ProviderCtx {
  const settings: Record<string, SettingValue> = { ...integration.settings };
  // Providers that need a place (a store near you) fall back to where the household lives.
  if (!settings.__place) settings.__place = loadConfig().household.place ?? "";
  return {
    integration,
    settings,
    str: (k) => String(overrides[k] ?? settings[k] ?? "").trim(),
    secret: (k) => overrides[k] || getSecret(secretKey(integration.id, k)),
    remember: (k, v) => {
      if (!overrides[k]) setSecret(secretKey(integration.id, k), v);
    },
  };
}
