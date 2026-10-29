import '../styles/base.css';
import '../styles/page.css';
import '../styles/logo.css';
import { logoSvg } from '../ui/logo.ts';
import { SITE, suggestChannelUrl } from '../config.ts';

const link = document.querySelector<HTMLAnchorElement>('#suggest-link');
if (link) {
  link.href = suggestChannelUrl();
  link.target = '_blank';
  link.rel = 'noopener noreferrer';
  link.setAttribute('aria-label', 'Suggest a channel by opening an issue on GitHub, opens in a new tab');
}

document.title = `About — ${SITE.projectName}`;

// The wordmark in the page heading.
const slot = document.querySelector('[data-logo]');
if (slot) slot.innerHTML = logoSvg({ title: 'Retro TV', compact: true });
