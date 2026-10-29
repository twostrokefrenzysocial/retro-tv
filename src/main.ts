import './styles/base.css';
import './styles/screen.css';
import './styles/osd.css';
import './styles/crt.css';
import './styles/cabinet.css';
import './styles/settings.css';
import './styles/guide.css';
import './styles/help.css';
import './styles/logo.css';
import { RetroTv } from './app.ts';

const root = document.querySelector<HTMLElement>('#app');

if (root) {
  RetroTv.mount(root).catch((err: unknown) => {
    console.error('Retro TV failed to start.', err);
    root.innerHTML =
      '<p class="fatal">Retro TV could not load its programme catalogue. Please try again later.</p>';
  });
}
