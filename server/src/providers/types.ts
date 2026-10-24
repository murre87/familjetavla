import type { CalEvent } from "../connectors/ics.js";
import type { Product } from "../connectors/axfood.js";
import type { HourPrice } from "../connectors/elpris.js";
import type { Pickup } from "../connectors/waste.js";
import type { FoodPart, Integration, ProviderMeta, SettingValue, StoreFoodData, TestResult } from "../types.js";

/**
 * Context handed to a provider. `secret(key)` reads an encrypted field of this integration
 * (fields marked `secret: true` in the meta), `remember` stores provider-private state such
 * as a login session.
 */
export interface ProviderCtx {
  integration: Integration;
  settings: Record<string, SettingValue>;
  str(key: string): string;
  secret(key: string): string | undefined;
  remember(key: string, value: string | null): void;
}

export interface SchoolEvent extends CalEvent {
  /** Name of the child as known by the provider (matched via personMap). */
  child?: string;
  /** Lesson that needs gym clothes. */
  gym?: boolean;
  /** Homework, test or hand-in (the provider says so, whatever the title). */
  task?: boolean;
  /** The item on the school platform. */
  url?: string;
}

export interface SchoolNewsItem {
  id: string;
  child?: string;
  title: string;
  text: string;
  published?: string;
  files: { name: string; url: string }[];
}

export interface SchoolProvider {
  meta: ProviderMeta;
  test(ctx: ProviderCtx): Promise<TestResult>;
  fetch(
    ctx: ProviderCtx,
    from: Date,
    to: Date,
  ): Promise<{
    events: SchoolEvent[];
    food?: { child: string; day: string; dishes: string[] }[];
    /** Förskola/fritids: today's care time per child, e.g. "07:30 - 16:00". */
    care?: { child: string; text: string }[];
    /** News from the school (Vklass start page). `child` when the news names one child. */
    news?: SchoolNewsItem[];
  }>;
}

export interface GroceryProvider {
  meta: ProviderMeta;
  test(ctx: ProviderCtx): Promise<TestResult>;
  search(ctx: ProviderCtx, query: string): Promise<Product[]>;
  addToCart(ctx: ProviderCtx, lines: { code: string; qty: number }[]): Promise<{ items: number | null; total: string | null }>;
  /** Butikerna man kan välja bland (värde = det som sparas, etikett = det som visas). */
  stores?(ctx: ProviderCtx): Promise<{ value: string; label: string }[]>;
  /** Fliken Mat: vilka delar butiken har, och hur en del hämtas (först när den öppnas). */
  food?: { parts: FoodPart[]; load(ctx: ProviderCtx, part: FoodPart): Promise<StoreFoodData> };
}

export interface WasteProvider {
  meta: ProviderMeta;
  test(ctx: ProviderCtx): Promise<TestResult>;
  fetch(ctx: ProviderCtx): Promise<Pickup[]>;
}

export interface PriceProvider {
  meta: ProviderMeta;
  test(ctx: ProviderCtx): Promise<TestResult>;
  /** Hourly prices in SEK/kWh for today and, when published, tomorrow. */
  fetch(ctx: ProviderCtx, now: Date): Promise<HourPrice[]>;
}

export type AnyProvider = SchoolProvider | GroceryProvider | WasteProvider | PriceProvider;
