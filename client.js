/**
 * Client half of the sidebar session-mode indicator.
 *
 * Each Session runs under the agent preset it started with, and that mode is
 * fixed once the Session opens. The row's trailing seat is where the shipped
 * Client draws a Session's resting metadata (relative time, status icons), so
 * this plugin adds exactly one more piece of that metadata: the Session's own
 * mode as a small pill. A colored dot inside the pill identifies the mode, and
 * the Plugins settings section gets a page that toggles the dot and edits one
 * color per mode.
 */
window.__ModuleLoader__.load({
  id: 'dsh-session-mode-indicator',
  factory(require) {
    const React = require('react');
    const h = React.createElement;

    /** Locale namespace owned by this plugin. */
    const NS = 'session-mode-indicator';
    /** Browser-local settings key; the preference belongs to this Web client. */
    const STORAGE_KEY = 'dsh.session-mode-indicator.settings.v1';

    /** Modes shown in the settings page, in display order. */
    const MODE_ORDER = ['standard', 'ptc', 'cordis', 'minimal'];

    /** Locale key naming one shipped mode. */
    const MODE_LABEL_KEYS = {
      standard: 'mode.standard',
      ptc: 'mode.ptc',
      cordis: 'mode.cordis',
      minimal: 'mode.minimal',
    };

    /**
     * Shipped preset ids whose copy the plugin carries itself. Every other id
     * (a user-authored preset) is shown verbatim; the projection stores only
     * the id, not the declaration's display name.
     */
    const BUILT_IN_MODES = MODE_LABEL_KEYS;

    /** Default dot color per mode; also the reset target. */
    const DEFAULT_COLORS = {
      standard: '#9aa4b2',
      ptc: '#4f8cff',
      cordis: '#b06bff',
      minimal: '#3ecf8e',
    };

    /** Color for a preset this build does not ship (or a corrupted stored value). */
    const FALLBACK_COLOR = '#9aa4b2';

    /** Colors offered for every mode; readable on both host themes. */
    const PALETTE = [
      '#9aa4b2',
      '#4f8cff',
      '#23b5d3',
      '#3ecf8e',
      '#f5b73d',
      '#ff8a4c',
      '#f0616d',
      '#b06bff',
      '#f472b6',
      '#e6e8ec',
    ];

    const DEFAULT_SETTINGS = { dots: true, colors: DEFAULT_COLORS };

    const HEX_COLOR = /^#[0-9a-f]{6}$/i;

    /**
     * Read the stored preference, falling back to defaults for anything absent
     * or malformed. Storage can be unavailable, so every read stays guarded.
     * @returns a complete settings value.
     */
    function loadSettings() {
      const fallback = { dots: DEFAULT_SETTINGS.dots, colors: { ...DEFAULT_COLORS } };
      try {
        const raw = window.localStorage.getItem(STORAGE_KEY);
        if (typeof raw !== 'string' || raw === '') return fallback;
        const parsed = JSON.parse(raw);
        if (typeof parsed !== 'object' || parsed === null) return fallback;
        const colors = { ...DEFAULT_COLORS };
        const storedColors = parsed.colors;
        if (typeof storedColors === 'object' && storedColors !== null) {
          for (const mode of MODE_ORDER) {
            const value = storedColors[mode];
            if (typeof value === 'string' && HEX_COLOR.test(value)) colors[mode] = value;
          }
        }
        return { dots: parsed.dots !== false, colors };
      } catch {
        return fallback;
      }
    }

    /** Settings value shared by every subscriber; replaced on write. */
    let settings = loadSettings();
    const settingsListeners = new Set();

    /**
     * Publish one settings value.
     * @param next - the next complete value.
     */
    function publish(next) {
      settings = next;
      try {
        window.localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
      } catch {
        // A read-only or full storage keeps the in-memory preference only.
      }
      for (const listener of [...settingsListeners]) listener();
    }

    /** @returns the current settings value (stable reference between writes). */
    function getSettings() {
      return settings;
    }

    /**
     * Subscribe to settings writes.
     * @param listener - called after every publish.
     * @returns the unsubscribe function.
     */
    function subscribeSettings(listener) {
      settingsListeners.add(listener);
      return () => {
        settingsListeners.delete(listener);
      };
    }

    /** @param enabled - whether rows draw the mode dot. */
    function setDots(enabled) {
      if (settings.dots === enabled) return;
      publish({ ...settings, dots: enabled });
    }

    /**
     * @param mode - shipped mode id.
     * @param color - hex color to store.
     */
    function setModeColor(mode, color) {
      if (!MODE_ORDER.includes(mode) || !HEX_COLOR.test(color)) return;
      if (settings.colors[mode] === color) return;
      publish({ ...settings, colors: { ...settings.colors, [mode]: color } });
    }

    /** Restore the default color for every mode. */
    function resetColors() {
      publish({ ...settings, colors: { ...DEFAULT_COLORS } });
    }

    /** React binding over the settings store. */
    function useSettings() {
      return React.useSyncExternalStore(subscribeSettings, getSettings);
    }

    /**
     * Dot color for one preset.
     * @param presetId - the Session's recorded agent-preset id.
     * @param value - current settings value.
     * @returns the configured color, or the neutral fallback.
     */
    function colorFor(presetId, value) {
      const color = value.colors[presetId];
      return typeof color === 'string' ? color : FALLBACK_COLOR;
    }

    /**
     * Resolve one Session's mode to display text.
     * @param presetId - the Session's recorded agent-preset id.
     * @param t - locale lookup for this plugin's namespace.
     * @returns the translated built-in name, or the raw id for other presets.
     */
    function modeLabel(presetId, t) {
      const key = BUILT_IN_MODES[presetId];
      const translated = key === undefined ? undefined : t(key);
      return typeof translated === 'string' && translated !== '' ? translated : presetId;
    }

    /** Shipped host switch: same markup and behavior as the shipped `Switch`. */
    function Toggle({ checked, label, onChange }) {
      return h(
        'button',
        {
          type: 'button',
          role: 'switch',
          'aria-checked': checked,
          'aria-label': label,
          className: 'dsm-switch',
          onClick: () => onChange(!checked),
        },
        h('span', { className: 'dsm-switch-thumb' }),
      );
    }

    /**
     * Navigation glyph of the settings section: a mode switch.
     * @param props.size - requested square edge in pixels.
     * @returns the glyph, drawn in the nav row's current color.
     */
    function SessionModeIcon({ size = 16 }) {
      return h(
        'svg',
        {
          width: size,
          height: size,
          viewBox: '0 0 16 16',
          fill: 'none',
          'aria-hidden': true,
          xmlns: 'http://www.w3.org/2000/svg',
        },
        h('rect', {
          x: 1.5,
          y: 4,
          width: 13,
          height: 8,
          rx: 4,
          stroke: 'currentColor',
          strokeWidth: 1.5,
        }),
        h('circle', { cx: 10.5, cy: 8, r: 2.2, fill: 'currentColor' }),
      );
    }

    /**
     * One mode's color row in the settings page.
     * @param props.mode - shipped mode id.
     * @param props.settings - current settings value.
     * @param props.t - locale lookup for this plugin's namespace.
     * @returns the preview, the mode name, and its color choices.
     */
    function ModeColorRow({ mode, settings: value, t }) {
      const current = colorFor(mode, value);
      const name = t(MODE_LABEL_KEYS[mode]);
      return h('div', { className: 'dsm-color-row' }, [
        h('span', {
          key: 'preview',
          className: 'dsm-color-preview',
          style: { backgroundColor: current },
        }),
        h('span', { key: 'name', className: 'dsm-color-name' }, name),
        h(
          'div',
          {
            key: 'swatches',
            className: 'dsm-swatches',
            role: 'radiogroup',
            'aria-label': name,
          },
          PALETTE.map((color) =>
            h('button', {
              key: color,
              type: 'button',
              role: 'radio',
              'aria-checked': current === color,
              'aria-label': color,
              title: color,
              className: 'dsm-swatch',
              style: { backgroundColor: color },
              onClick: () => setModeColor(mode, color),
            }),
          ),
        ),
        h('input', {
          key: 'custom',
          type: 'color',
          className: 'dsm-color-input',
          value: current,
          'aria-label': t('page.colors.custom'),
          title: t('page.colors.custom'),
          onChange: (event) => setModeColor(mode, event.target.value),
        }),
      ]);
    }

    /**
     * The settings section page: the dot toggle and one color per mode.
     * @param props.t - locale lookup for this plugin's namespace.
     * @returns the settings page.
     */
    function SessionModeSettingsPage({ t }) {
      const value = useSettings();
      return h('div', { className: 'dsm-page' }, [
        h('h2', { className: 'dsm-title', key: 'title' }, t('page.title')),
        h('p', { className: 'dsm-intro', key: 'intro' }, t('page.intro')),
        h('div', { className: 'dsm-group', key: 'visibility' }, [
          h('h3', { className: 'dsm-group-head', key: 'head' }, t('page.groups.dots')),
          h('div', { className: 'dsm-row', key: 'row' }, [
            h('div', { key: 'copy' }, [
              h('div', { className: 'dsm-row-title', key: 'title' }, t('page.dots.title')),
              h('div', { className: 'dsm-row-desc', key: 'desc' }, t('page.dots.description')),
            ]),
            h(Toggle, {
              key: 'switch',
              checked: value.dots,
              label: t('page.dots.title'),
              onChange: setDots,
            }),
          ]),
        ]),
        h('section', { className: 'dsm-group', key: 'colors' }, [
          h('h3', { className: 'dsm-group-head', key: 'head' }, t('page.groups.colors')),
          h('p', { className: 'dsm-group-desc', key: 'desc' }, t('page.colors.description')),
          ...MODE_ORDER.map((mode) =>
            h(ModeColorRow, { key: mode, mode, settings: value, t }),
          ),
          h(
            'button',
            {
              key: 'reset',
              type: 'button',
              className: 'dsm-reset',
              onClick: resetColors,
            },
            t('page.colors.reset'),
          ),
        ]),
      ]);
    }

    /**
     * One Session row's mode pill: a colored dot identifying the mode and the
     * mode's name beside it.
     * @param props.sessionId - Session this row shows; the plugin reads only its
     * own list projection and never retains or opens the Session.
     * @param props.useSessions - selector hook over the Client Session list.
     * @param props.t - locale lookup for this plugin's namespace.
     * @returns the pill, or nothing while the list carries no mode.
     */
    function SessionModeBadge({ sessionId, useSessions, t }) {
      const presetId = useSessions(
        (state) => state?.byId?.[sessionId]?.projectionValues?.agentPreset,
      );
      const value = useSettings();
      if (typeof presetId !== 'string' || presetId === '') return null;
      const label = modeLabel(presetId, t);
      const aria = t('badge.aria', { mode: label });
      const content = value.dots
        ? [
            h('span', {
              key: 'dot',
              className: 'dsm-mode-dot',
              style: { backgroundColor: colorFor(presetId, value) },
            }),
            h('span', { key: 'label' }, label),
          ]
        : label;
      return h(
        'span',
        {
          className: 'dsm-mode-badge',
          'data-session-mode': presetId,
          title: aria,
          'aria-label': aria,
        },
        content,
      );
    }

    /**
     * Row and settings styling. Colors come from host theme tokens; the dot and
     * swatch fills are user-chosen artwork.
     */
    const CSS = [
      '.dsm-mode-badge{',
      'flex:none;white-space:nowrap;user-select:none;display:inline-flex;align-items:center;gap:5px;',
      'height:20px;padding:0 6px;border-radius:10px;',
      'font-size:12px;line-height:18px;font-weight:500;letter-spacing:.02em;',
      'color:var(--dsw-alias-label-secondary);',
      'border:1px solid var(--dsw-alias-border-l2);',
      '}',
      '.dsm-mode-dot{flex:none;width:8px;height:8px;border-radius:50%;}',
      '.dsm-page{width:100%;max-width:720px;color:var(--dsw-alias-label-primary);display:flex;flex-direction:column;gap:12px;}',
      '.dsm-title{margin:0;font-size:18px;font-weight:600;line-height:1.4;}',
      '.dsm-intro{margin:0;color:var(--dsw-alias-label-tertiary);font-size:13px;line-height:20px;}',
      '.dsm-group{display:flex;flex-direction:column;gap:10px;}',
      '.dsm-group+.dsm-group{margin-top:20px;}',
      '.dsm-group-head{margin:0;color:var(--dsw-alias-label-tertiary);font-size:12px;font-weight:600;letter-spacing:.06em;text-transform:uppercase;}',
      '.dsm-group-desc{margin:0;color:var(--dsw-alias-label-tertiary);font-size:12px;line-height:18px;}',
      '.dsm-row{display:flex;justify-content:space-between;align-items:center;gap:24px;padding:14px 0;border-bottom:.5px solid var(--dsw-alias-border-l2);}',
      '.dsm-row-title{font-size:14px;line-height:20px;}',
      '.dsm-row-desc{color:var(--dsw-alias-label-secondary);margin-top:4px;font-size:12px;line-height:18px;}',
      '.dsm-color-row{display:flex;align-items:center;gap:12px;padding:6px 0;flex-wrap:wrap;}',
      '.dsm-color-preview{flex:none;width:14px;height:14px;border-radius:50%;}',
      '.dsm-color-name{min-width:56px;font-size:13px;line-height:20px;color:var(--dsw-alias-label-primary);}',
      '.dsm-swatches{display:flex;flex-wrap:wrap;gap:8px;}',
      '.dsm-swatch{box-sizing:border-box;width:18px;height:18px;padding:0;border:0;border-radius:50%;cursor:pointer;}',
      '.dsm-swatch[aria-checked=true]{outline:2px solid var(--dsw-alias-label-primary);outline-offset:2px;}',
      '@media (hover:hover){.dsm-swatch:hover{outline:2px solid var(--dsw-alias-border-l3);outline-offset:2px;}}',
      '.dsm-color-input{box-sizing:border-box;width:18px;height:18px;padding:0;border:0;border-radius:50%;background:0 0;cursor:pointer;-webkit-appearance:none;appearance:none;}',
      '.dsm-color-input::-webkit-color-swatch-wrapper{padding:0;}',
      '.dsm-color-input::-webkit-color-swatch{border:1px solid var(--dsw-alias-border-l3);border-radius:50%;}',
      '.dsm-reset{align-self:flex-start;background:0 0;border:0;color:var(--dsw-alias-state-business-primary);font:inherit;font-size:12px;line-height:18px;cursor:pointer;padding:4px 0;}',
      '.dsm-switch{box-sizing:border-box;position:relative;flex:0 0 auto;width:36px;height:20px;padding:2px;border:0;border-radius:999px;background:var(--dsw-alias-border-l3);cursor:pointer;}',
      '.dsm-switch[aria-checked=true]{background:var(--dsw-alias-brand-primary);}',
      '.dsm-switch:focus-visible{outline:var(--dsw-focus-ring-width) solid var(--dsw-focus-ring-color,var(--dsw-alias-state-business-primary));outline-offset:2px;}',
      '.dsm-switch-thumb{display:block;width:16px;height:16px;border-radius:50%;background:var(--dsw-alias-label-primary-foreground);transition:transform .12s ease;}',
      '.dsm-switch[aria-checked=false] .dsm-switch-thumb{background:var(--dsw-alias-switch-thumb);}',
      '.dsm-switch[aria-checked=true] .dsm-switch-thumb{transform:translate(16px);}',
    ].join('');

    /** Dictionaries for every built-in DSH locale; unknown locales fall back to English. */
    const DICTIONARIES = {
      en: {
        'mode.standard': 'Standard',
        'mode.ptc': 'PTC',
        'mode.minimal': 'Minimal',
        'mode.cordis': 'Create',
        'badge.aria': 'Session mode: {mode}',
        'page.nav': 'Mode dots',
        'page.title': 'Session mode dots',
        'page.intro':
          "Each Session keeps the mode it started with, and that mode cannot change after the Session opens. This page configures the colored dot that marks it in the left sidebar.",
        'page.groups.dots': 'Visibility',
        'page.dots.title': 'Show mode dots',
        'page.dots.description':
          'Draw a dot before the mode label in each Session row. The dot color identifies the mode.',
        'page.groups.colors': 'Dot colors',
        'page.colors.description':
          'Pick a dot color for each mode. Changes apply to the left sidebar immediately.',
        'page.colors.custom': 'Custom color',
        'page.colors.reset': 'Reset colors',
      },
      zh: {
        'mode.standard': '标准',
        'mode.ptc': 'PTC',
        'mode.minimal': '极简',
        'mode.cordis': '创造',
        'badge.aria': '会话模式：{mode}',
        'page.nav': '模式圆点',
        'page.title': '会话模式圆点',
        'page.intro':
          '每个会话开启后模式固定、不能切换。这一页设置左侧栏里标记模式的彩色圆点。',
        'page.groups.dots': '显示',
        'page.dots.title': '显示模式圆点',
        'page.dots.description': '在会话行的模式标签前显示圆点，圆点颜色对应会话模式。',
        'page.groups.colors': '圆点颜色',
        'page.colors.description': '为每种模式选择圆点颜色，修改会立即应用到左侧栏。',
        'page.colors.custom': '自定义颜色',
        'page.colors.reset': '恢复默认颜色',
      },
    };

    /** Non-Chinese dictionaries mirror the English copy. */
    for (const locale of ['de', 'es', 'fr', 'ja', 'pt', 'ru']) {
      DICTIONARIES[locale] = { ...DICTIONARIES.en };
    }

    return {
      inject: ['slots', 'locale'],
      apply(ctx) {
        const t = ctx.locale.bind(NS);

        ctx.effect(() => ctx.locale.register(NS, DICTIONARIES), 'session-mode: dictionaries');

        ctx.effect(() => {
          const tag = document.createElement('style');
          tag.dataset.sessionModeIndicator = '';
          tag.textContent = CSS;
          document.head.appendChild(tag);
          return () => {
            tag.remove();
          };
        }, 'session-mode: styles');

        ctx.effect(() => {
          const onStorage = (event) => {
            if (event.key !== STORAGE_KEY) return;
            const next = loadSettings();
            const changed =
              next.dots !== settings.dots ||
              MODE_ORDER.some((mode) => next.colors[mode] !== settings.colors[mode]);
            if (changed) publish(next);
          };
          window.addEventListener('storage', onStorage);
          return () => {
            window.removeEventListener('storage', onStorage);
          };
        }, 'session-mode: settings sync');

        ctx.effect(
          () =>
            ctx.slots.inject('sidebar.session.row.trailing', () =>
              ctx.slots.register(
                {
                  name: 'sidebar.session.row.trailing',
                  id: 'session-mode',
                  order: 0,
                  locale: NS,
                  inject: () => ({ t }),
                },
                SessionModeBadge,
              ),
            ),
          'session-mode: sidebar row badge',
        );

        ctx.effect(
          () =>
            ctx.slots.inject('settings.section', () =>
              ctx.slots.register(
                {
                  name: 'settings.section',
                  id: 'session-mode',
                  order: 21,
                  label: () => t('page.nav'),
                  locale: NS,
                  inject: () => ({ t }),
                },
                SessionModeSettingsPage,
              ),
            ),
          'session-mode: settings page',
        );

        ctx.effect(
          () =>
            ctx.slots.inject('settings.section.icon', () =>
              ctx.slots.register(
                {
                  name: 'settings.section.icon',
                  id: 'session-mode',
                  order: 0,
                  label: () => t('page.nav'),
                  locale: NS,
                },
                SessionModeIcon,
              ),
            ),
          'session-mode: settings icon',
        );
      },
    };
  },
});
