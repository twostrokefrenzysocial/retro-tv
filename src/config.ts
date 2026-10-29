/**
 * Site-wide settings. Edit config/site.config.json rather than this file;
 * the JSON is imported at build time so there is nothing to fetch.
 */
import siteConfig from '../config/site.config.json';

export interface SiteConfig {
  projectName: string;
  tagline: string;
  repoUrl: string;
}

export const SITE: SiteConfig = siteConfig;

/** Issue template for the "Suggest a channel" link. */
const SUGGESTION_BODY = `### Channel name

<!-- What would it be called on the dial? -->

### Theme

<!-- A sentence or two: what kind of programmes would it show? -->

### Example Archive collections or items

<!--
Collection identifiers (for example: classic_tv, prelinger) or links to
specific archive.org items. The more playable examples the better.
-->

### Anything else

<!-- Suggested channel number, rights notes, anything we should know. -->
`;

/** A GitHub "new issue" URL with the suggestion template filled in. */
export function suggestChannelUrl(): string {
  const base = SITE.repoUrl.replace(/\/+$/, '');
  const params = new URLSearchParams({
    title: 'Channel suggestion: ',
    labels: 'channel-suggestion',
    body: SUGGESTION_BODY,
  });
  return `${base}/issues/new?${params.toString()}`;
}
