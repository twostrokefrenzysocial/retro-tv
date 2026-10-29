import { logoSvg } from './logo.ts';

/** The static markup for the set. Built once, then driven by the app. */
export const SHELL_HTML = `
<div class="tv" data-state="off">
  <div class="tv-brand">${logoSvg({ title: 'Retro TV' })}</div>

  <div class="tv-set">
    <div class="cabinet-top" aria-hidden="true"></div>

    <div class="tv-screen" id="screen">
      <div class="picture">
        <video class="picture-video is-live" playsinline></video>
        <video class="picture-video" playsinline></video>
        <canvas class="picture-static" aria-hidden="true"></canvas>
        <canvas class="picture-testcard" aria-hidden="true"></canvas>

        <div class="fx fx-fringe" aria-hidden="true"></div>
        <div class="fx fx-scanlines" aria-hidden="true"></div>
        <div class="fx fx-vignette" aria-hidden="true"></div>
        <div class="fx fx-flicker" aria-hidden="true"></div>
        <div class="fx fx-glow" aria-hidden="true"></div>

        <div class="picture-off" aria-hidden="true"></div>
      </div>

      <div class="osd">
        <div class="osd-channel" role="status"></div>
        <div class="osd-digits" role="status"></div>
        <div class="osd-volume" role="status">
          <span class="osd-volume-label">VOL</span>
          <span class="osd-bars"></span>
        </div>
        <div class="osd-info">
          <div class="osd-channel-name"></div>
          <div class="osd-title"></div>
          <div class="osd-progress"><div class="osd-progress-fill"></div></div>
          <div class="osd-next"></div>
          <a class="osd-source" target="_blank" rel="noopener noreferrer"></a>
        </div>
      </div>

      <button class="power-screen" id="power-on" type="button">
        ${logoSvg({ title: '' })}
        <span class="power-glyph" aria-hidden="true"></span>
        <span class="power-label">Turn on</span>
      </button>
    </div>

    <div class="cabinet-fascia">
      <div class="cabinet-grille" aria-hidden="true"></div>
      <div class="cabinet-badge">${logoSvg({ title: 'Retro TV', compact: true })}</div>

      <div class="cabinet-knobs" role="group" aria-label="Television dials">
        <div class="knob-well">
          <button type="button" class="knob knob-large" data-knob="channel"
                  aria-label="Channel dial. Click to change channel, or use the arrow keys.">
            <span class="knob-face" aria-hidden="true"></span>
          </button>
          <span class="knob-caption" aria-hidden="true">CH</span>
        </div>

        <div class="knob-well">
          <button type="button" class="knob knob-large" data-knob="volume"
                  role="slider" aria-label="Volume dial"
                  aria-valuemin="0" aria-valuemax="100" aria-valuenow="80">
            <span class="knob-face" aria-hidden="true"></span>
          </button>
          <span class="knob-caption" aria-hidden="true">VOL</span>
        </div>

        <div class="knob-well">
          <button type="button" class="knob knob-small" data-knob="power" aria-label="Power">
            <span class="knob-face" aria-hidden="true"></span>
          </button>
          <span class="knob-caption" aria-hidden="true">PWR</span>
        </div>

        <div class="knob-well">
          <button type="button" class="knob knob-small" data-knob="guide" aria-label="Open the TV guide">
            <span class="knob-face" aria-hidden="true"></span>
          </button>
          <span class="knob-caption" aria-hidden="true">GUIDE</span>
        </div>
      </div>
    </div>
  </div>

  <div class="tv-controls" role="group" aria-label="Television controls">
    <button type="button" class="btn btn-power" data-action="power" aria-label="Power off">
      <span aria-hidden="true">&#9211;</span>
    </button>
    <div class="btn-pair">
      <button type="button" class="btn" data-action="ch-up" aria-label="Channel up">CH &#9650;</button>
      <button type="button" class="btn" data-action="ch-down" aria-label="Channel down">CH &#9660;</button>
    </div>
    <div class="btn-pair">
      <button type="button" class="btn" data-action="vol-up" aria-label="Volume up">VOL &#43;</button>
      <button type="button" class="btn" data-action="vol-down" aria-label="Volume down">VOL &#8722;</button>
    </div>
    <button type="button" class="btn" data-action="mute" aria-label="Mute">MUTE</button>
    <button type="button" class="btn" data-action="info" aria-label="Show programme info">INFO</button>
    <button type="button" class="btn" data-action="last" aria-label="Previous channel">LAST</button>
    <button type="button" class="btn" data-action="guide" aria-label="Open TV guide">GUIDE</button>
    <button type="button" class="btn" data-action="settings" aria-label="Picture settings">SET</button>
  </div>

  <nav class="tv-links" aria-label="Site">
    <a href="/whats-on/">What&rsquo;s On</a>
    <a href="/about/">About</a>
    <a href="#" id="suggest-channel">Suggest a channel</a>
    <button type="button" class="link-button" data-action="help">Keyboard help</button>
  </nav>

  <dialog class="help" id="help" aria-labelledby="help-title">
    <div class="help-inner">
      <div class="help-head">
        <h2 id="help-title">Keyboard controls</h2>
        <button type="button" class="guide-close" data-help="close" aria-label="Close keyboard help">
          <span aria-hidden="true">&#10005;</span>
        </button>
      </div>
      <dl class="help-list"></dl>
    </div>
  </dialog>

  <dialog class="guide" id="guide" aria-label="TV guide">
    <div class="guide-head">
      <div class="guide-brand">
        <span class="guide-brand-mark" aria-hidden="true"></span>
        <span>Programme Guide</span>
      </div>
      <div class="guide-times-wrap">
        <div class="guide-times"></div>
      </div>
      <button type="button" class="guide-close" data-guide="close" aria-label="Close the guide">
        <span aria-hidden="true">&#10005;</span>
      </button>
    </div>

    <p class="guide-status" hidden></p>

    <div class="guide-body">
      <div class="guide-rows"></div>
      <div class="guide-now" aria-hidden="true"></div>
    </div>

    <div class="guide-details" hidden>
      <h3 class="guide-details-title"></h3>
      <p class="guide-details-meta"></p>
      <a class="guide-details-link" target="_blank" rel="noopener noreferrer"></a>
    </div>

    <p class="guide-hint">
      Arrow keys to move, Enter to watch what is on now, Escape to close.
    </p>
  </dialog>

  <dialog class="settings" id="settings" aria-labelledby="settings-title">
    <form method="dialog" class="settings-form">
      <h2 id="settings-title">Picture settings</h2>
      <p class="settings-intro">
        Tune the look of the set. Everything here is cosmetic and saved on this device.
      </p>
      <div class="settings-list" id="settings-list"></div>
      <div class="settings-actions">
        <button type="button" class="btn" data-settings="reset">Reset</button>
        <button type="submit" class="btn btn-primary" value="close">Done</button>
      </div>
    </form>
  </dialog>
</div>
`;
