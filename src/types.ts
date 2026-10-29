/** Shared types between the catalog builder and the browser app. */

export interface CatalogItem {
  identifier: string;
  title: string;
  year: number | null;
  filename: string;
  duration: number;
  licenseurl: string | null;
  collection: string;
}

export interface ChannelSummary {
  number: number;
  slug: string;
  name: string;
  description: string;
  itemCount: number;
  totalRuntime: number;
  commercialBreaks: boolean;
  /** Era bounds, so commercials can be matched to the programmes. */
  minYear?: number;
  maxYear?: number;
}

export interface CatalogIndex {
  generatedAt: string;
  epoch: string;
  channels: ChannelSummary[];
  commercialCount: number;
}

export interface ChannelCatalog {
  slug: string;
  number: number;
  name: string;
  description: string;
  commercialBreaks: boolean;
  minYear?: number;
  maxYear?: number;
  items: CatalogItem[];
}
