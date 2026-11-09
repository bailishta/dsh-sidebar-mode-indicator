/**
 * Client half of the sidebar session-mode indicator.
 *
 * Each Session runs under the agent preset it started with, and that mode is
 * fixed once the Session opens. The row's trailing seat is where the shipped
 * Client draws a Session's resting metadata (relative time, status icons), so
 * this plugin adds exactly one more piece of that metadata: the Session's own
 * mode as a small pill. A colored dot inside the pill identifies the mode.
 *
 * Modes are discovered, never hard-coded: the shipped presets keep their
 * localized names, and every other preset (a user- or plugin-authored mode)
 * gets a color assigned automatically — from a deterministic id hash, probed
 * for an unused hue and then pinned in local storage. Other plugins can also
 * declare a mode name/color ahead of time through the provided
 * `sessionModeIndicator` Client service (see `registerMode`), which is the
 * interface for future modes.
 */
window.__ModuleLoader__.load({
  id: 'dsh-session-mode-indicator',
  factory(require) {
    const React = require('react');
    const h = React.createElement;

    /** Locale namespace owned by this plugin. */
    const NS = 'session-mode-indicator';
    /** Browser-local preference key; this Web client owns the value. */
    const STORAGE_KEY = 'dsh.session-mode-indicator.settings.v1';
    /** Current stored shape version. Older shapes are migrated on read. */
    const SETTINGS_VERSION = 2;

    /** Shipped modes, in display order. */
    const MODE_ORDER = ['standard', 'ptc', 'cordis', 'minimal'];

    /** Locale key naming one shipped mode. */
    const MODE_LABEL_KEYS = {
      standard: 'mode.standard',
      ptc: 'mode.ptc',
      cordis: 'mode.cordis',
      minimal: 'mode.minimal',
    };

    /** Default dot color per shipped mode; also the reset target. */
    const DEFAULT_COLORS = {
      standard: '#9aa4b2',
      ptc: '#4f8cff',
      cordis: '#b06bff',
      minimal: '#3ecf8e',
    };

    /** Color for a mode id that is neither configured nor assignable yet. */
    const FALLBACK_COLOR = '#9aa4b2';

    /** Colors offered for every mode in the settings page. */
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

    /** Vivid subset used for automatic assignment; gray and white stay manual. */
    const AUTO_PALETTE = [
      '#4f8cff',
      '#23b5d3',
      '#3ecf8e',
      '#f5b73d',
      '#ff8a4c',
      '#f0616d',
      '#b06bff',
      '#f472b6',
    ];

    const HEX_COLOR = /^#[0-9a-f]{6}$/i;

    /** Separator for the primitive Session-mode key used by selector hooks. */
    const KEY_SEPARATOR = '\u0000';

    // ---------------------------------------------------------------- state --

    /**
     * Durable preference: whether dots draw, per-mode user colors, and the
     * pinned colors the auto-assignment settled on for discovered modes.
     */
    let dots = true;
    let overrides = {};
    let auto = {};

    /** Presets the registry published, when the roster could be read. */
    let roster = [];
    /** `idle` | `loading` | `ready` | `unavailable`. */
    let rosterStatus = 'idle';
    /** Contributions from other plugins through the provided service. */
    const contributions = new Map();

    /** Immutable snapshot handed to React; replaced on every publish. */
    let snapshot = {
      version: 0,
      dots,
      overrides,
      auto,
      roster,
      rosterStatus,
      contributions,
    };
    const listeners = new Set();

    /** Re-read a stored color map, keeping only valid `id → #rrggbb` entries. */
    function readColors(source) {
      const colors = {};
      if (typeof source !== 'object' || source === null) return colors;
      for (const [id, color] of Object.entries(source)) {
        if (id !== '' && typeof color === 'string' && HEX_COLOR.test(color)) colors[id] = color;
      }
      return colors;
    }

    /**
     * Read the stored preference, migrating the pre-v2 shape in place.
     * @returns `{ dots, overrides, auto }`.
     */
    function loadSettings() {
      const fallback = { dots: true, overrides: {}, auto: {} };
      try {
        const raw = window.localStorage.getItem(STORAGE_KEY);
        if (typeof raw !== 'string' || raw === '') return fallback;
        const parsed = JSON.parse(raw);
        if (typeof parsed !== 'object' || parsed === null) return fallback;
        const value = { dots: parsed.dots !== false, overrides: {}, auto: {} };
        if (parsed.v === SETTINGS_VERSION) {
          value.overrides = readColors(parsed.overrides);
          value.auto = readColors(parsed.auto);
          return value;
        }
        // v1 stored a complete `colors` map; only non-default entries were
        // user choices, so keep those and let the rest fall back to defaults.
        const legacy = readColors(parsed.colors);
        for (const [id, color] of Object.entries(legacy)) {
          if (DEFAULT_COLORS[id] !== color) value.overrides[id] = color;
        }
        return value;
      } catch {
        return fallback;
      }
    }

    const stored = loadSettings();
    dots = stored.dots;
    overrides = stored.overrides;
    auto = stored.auto;

    /** Write the current preference; storage may be unavailable or full. */
    function persist() {
      try {
        window.localStorage.setItem(
          STORAGE_KEY,
          JSON.stringify({ v: SETTINGS_VERSION, dots, overrides, auto }),
        );
      } catch {
        // Keep the in-memory preference when the browser refuses to store it.
      }
    }

    /** Adopt another window's write without losing the current listeners. */
    function reloadSettings() {
      const next = loadSettings();
      const changed =
        next.dots !== dots ||
        JSON.stringify(next.overrides) !== JSON.stringify(overrides) ||
        JSON.stringify(next.auto) !== JSON.stringify(auto);
      if (!changed) return;
      dots = next.dots;
      overrides = next.overrides;
      auto = next.auto;
      pinAutoColors();
      publish();
    }

    /** Publish one new snapshot to every subscriber. */
    function publish() {
      snapshot = {
        version: snapshot.version + 1,
        dots,
        overrides,
        auto,
        roster,
        rosterStatus,
        contributions,
      };
      for (const listener of [...listeners]) listener();
    }

    /** @returns the current snapshot (stable reference between publishes). */
    function getSnapshot() {
      return snapshot;
    }

    /**
     * Subscribe to preference, roster, and contribution changes.
     * @param listener - called after every publish.
     * @returns the unsubscribe function.
     */
    function subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    }

    /** React binding over the plugin snapshot. */
    function useSnapshot() {
      return React.useSyncExternalStore(subscribe, getSnapshot);
    }

    // ---------------------------------------------------------- color model --

    /** @returns true for one of the shipped modes. */
    function isBuiltin(id) {
      return Object.prototype.hasOwnProperty.call(DEFAULT_COLORS, id);
    }

    /**
     * Stable 32-bit hash of a mode id (FNV-1a), used to seed auto colors.
     * @param id - mode id.
     * @returns an unsigned 32-bit integer.
     */
    function hashId(id) {
      let hash = 0x811c9dc5;
      for (let index = 0; index < id.length; index += 1) {
        hash ^= id.charCodeAt(index);
        hash = Math.imul(hash, 0x01000193) >>> 0;
      }
      return hash >>> 0;
    }

    /**
     * Pick a vivid color for a mode id, probing past colors already in use.
     * @param id - mode id.
     * @param used - colors another mode currently resolves to.
     * @returns the chosen hex color.
     */
    function pickAutoColor(id, used) {
      const start = hashId(id) % AUTO_PALETTE.length;
      for (let offset = 0; offset < AUTO_PALETTE.length; offset += 1) {
        const color = AUTO_PALETTE[(start + offset) % AUTO_PALETTE.length];
        if (!used.has(color)) return color;
      }
      return AUTO_PALETTE[start];
    }

    /** @returns the plugin's contribution for this mode, when one is active. */
    function contributionOf(id) {
      return contributions.get(id);
    }

    /**
     * Resolve one mode's dot color: user override, plugin contribution, pinned
     * auto color, shipped default, then the unpinned hash guess.
     * @param id - mode id.
     * @returns the hex color to draw.
     */
    function resolveColor(id) {
      const override = overrides[id];
      if (override !== undefined) return override;
      const contributed = contributionOf(id)?.color;
      if (contributed !== undefined) return contributed;
      const pinned = auto[id];
      if (pinned !== undefined) return pinned;
      const shipped = DEFAULT_COLORS[id];
      if (shipped !== undefined) return shipped;
      return AUTO_PALETTE[hashId(id) % AUTO_PALETTE.length];
    }

    /**
     * Every mode id the plugin currently knows about: shipped modes, published
     * presets, active contributions, and ids discovered elsewhere. Pinned
     * auto colors and user overrides are deliberately excluded, so a mode that
     * no longer exists stops being listed and stops reserving a color.
     * @param extra - additional ids discovered elsewhere.
     * @returns a de-duplicated id list.
     */
    function knownIds(extra = []) {
      const ids = new Set(MODE_ORDER);
      for (const row of roster) ids.add(row.id);
      for (const id of contributions.keys()) ids.add(id);
      for (const id of extra) if (typeof id === 'string' && id !== '') ids.add(id);
      return [...ids];
    }

    /**
     * Pin a color for every discovered mode that has none yet. Runs outside
     * render because it persists storage and publishes a new snapshot.
     * @param extra - additional ids discovered elsewhere.
     * @returns true when at least one color was assigned.
     */
    function pinAutoColors(extra = []) {
      const ids = knownIds(extra);
      const used = new Set();
      const pending = [];
      for (const id of ids) {
        const explicit = overrides[id] ?? contributionOf(id)?.color;
        if (explicit !== undefined) {
          used.add(explicit);
        } else if (isBuiltin(id)) {
          used.add(auto[id] ?? DEFAULT_COLORS[id]);
        } else if (auto[id] !== undefined) {
          used.add(auto[id]);
        } else {
          pending.push(id);
        }
      }
      if (pending.length === 0) return false;
      for (const id of pending.sort()) {
        const color = pickAutoColor(id, used);
        auto[id] = color;
        used.add(color);
      }
      persist();
      return true;
    }

    // ------------------------------------------------------------- display --

    /**
     * Display text for one mode: shipped copy, a plugin contribution's name, a
     * published preset name, or the generic custom label.
     * @param id - mode id.
     * @param t - locale lookup for this plugin's namespace.
     * @returns the display name.
     */
    function modeName(id, t) {
      const contributed = contributionOf(id);
      if (contributed?.name !== undefined) return contributed.name;
      const key = MODE_LABEL_KEYS[id];
      if (key !== undefined) return t(key);
      const row = roster.find((entry) => entry.id === id);
      if (row !== undefined && row.name !== undefined) return row.name;
      return t('mode.custom');
    }

    /** @returns whether this mode has a name of its own, not the generic one. */
    function hasOwnName(id) {
      return (
        isBuiltin(id) ||
        contributionOf(id)?.name !== undefined ||
        roster.some((entry) => entry.id === id && entry.name !== undefined)
      );
    }

    /**
     * Primitive Session-mode key for selector hooks: every mode used by a
     * Session that is neither archived nor blank (a blank Session has not
     * started a turn, and a row for it draws no trailing metadata).
     * @param state - Session list snapshot.
     * @param archived - archived Session ids to skip.
     * @returns sorted ids joined by the key separator.
     */
    function collectSessionPresetIds(state, archived) {
      const ids = new Set();
      const byId = state?.byId;
      if (byId !== null && typeof byId === 'object') {
        for (const sessionId of Object.keys(byId)) {
          const summary = byId[sessionId];
          if (summary?.blank === true) continue;
          if (archived !== undefined && archived.has(sessionId)) continue;
          const preset = summary?.projectionValues?.agentPreset;
          if (typeof preset === 'string' && preset !== '') ids.add(preset);
        }
      }
      return [...ids].sort().join(KEY_SEPARATOR);
    }

    /** Called from `apply`; replaced with the real roster reader. */
    let refreshRoster = () => {};

    // ---------------------------------------------------------- components --

    /** Host-styled switch; same markup and behavior as the shipped `Switch`. */
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
     * @param props.id - mode id.
     * @param props.t - locale lookup for this plugin's namespace.
     * @returns the preview, the mode name, and its color choices.
     */
    function ModeColorRow({ id, t }) {
      const name = modeName(id, t);
      const current = resolveColor(id);
      const builtin = isBuiltin(id);
      return h('div', { className: 'dsm-color-row' }, [
        h('span', {
          key: 'preview',
          className: 'dsm-color-preview',
          style: { backgroundColor: current },
        }),
        h('span', { key: 'name', className: 'dsm-color-name' }, name),
        !builtin && h('span', { key: 'id', className: 'dsm-color-id', title: id }, id),
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
              onClick: () => setModeColor(id, color),
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
          onChange: (event) => setModeColor(id, event.target.value),
        }),
      ]);
    }

    /**
     * The settings section page: the dot toggle and one color per known mode.
     * @param props.t - locale lookup for this plugin's namespace.
     * @param props.useSessions - selector hook over the Client Session list.
     * @returns the settings page.
     */
    function SessionModeSettingsPage({ t, useSessions, useWorkspaces }) {
      const listPhase = useSessions((state) => state?.phase);
      const archivedIds = useWorkspaces((state) => state?.archivedSessionIds);
      const archivedKey = Array.isArray(archivedIds) ? archivedIds.join(KEY_SEPARATOR) : '';
      const archived = React.useMemo(
        () => new Set(Array.isArray(archivedIds) ? archivedIds : []),
        [archivedKey],
      );
      const key = useSessions((state) => collectSessionPresetIds(state, archived));
      const snap = useSnapshot();
      const sessionIds = key === '' || key === undefined ? [] : key.split(KEY_SEPARATOR);

      React.useEffect(() => {
        refreshRoster();
      }, []);
      React.useEffect(() => {
        if (sessionIds.length === 0) return;
        if (pinAutoColors(sessionIds)) publish();
      }, [key]);
      // Drop pinned colors for modes that are neither declared nor used by a
      // live Session: retired presets and archived-only test modes then stop
      // occupying a color and never show up in this list again. Gated on the
      // Session list so an early empty snapshot cannot wipe real pins.
      React.useEffect(() => {
        if (listPhase !== 'ready') return;
        const valid = new Set([...MODE_ORDER, ...roster.map((row) => row.id)]);
        for (const id of contributions.keys()) valid.add(id);
        for (const id of sessionIds) valid.add(id);
        let removed = false;
        for (const id of Object.keys(auto)) {
          if (!valid.has(id)) {
            delete auto[id];
            removed = true;
          }
        }
        if (!removed) return;
        persist();
        pinAutoColors(sessionIds);
        publish();
      }, [key, listPhase, snap.version]);

      const customIds = knownIds(sessionIds)
        .filter((id) => !isBuiltin(id))
        .sort((left, right) => {
          const byName = modeName(left, t).localeCompare(modeName(right, t));
          if (byName !== 0) return byName;
          return left < right ? -1 : left > right ? 1 : 0;
        });
      const rosterNote =
        snap.rosterStatus === 'unavailable' ? t('page.custom.unavailable') : null;

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
              checked: snap.dots,
              label: t('page.dots.title'),
              onChange: setDots,
            }),
          ]),
        ]),
        h('div', { className: 'dsm-group', key: 'builtin' }, [
          h('h3', { className: 'dsm-group-head', key: 'head' }, t('page.groups.builtin')),
          ...MODE_ORDER.map((id) => h(ModeColorRow, { key: id, id, t })),
        ]),
        h('section', { className: 'dsm-group', key: 'custom' }, [
          h('div', { className: 'dsm-group-head-row', key: 'head' }, [
            h('h3', { className: 'dsm-group-head', key: 'title' }, t('page.groups.custom')),
            h(
              'button',
              {
                key: 'refresh',
                type: 'button',
                className: 'dsm-refresh',
                onClick: () => {
                  refreshRoster();
                },
              },
              t('page.refresh'),
            ),
          ]),
          h('p', { className: 'dsm-group-desc', key: 'desc' }, t('page.custom.description')),
          ...(customIds.length > 0
            ? customIds.map((id) => h(ModeColorRow, { key: id, id, t }))
            : [h('p', { className: 'dsm-note', key: 'empty' }, t('page.custom.empty'))]),
          rosterNote === null ? null : h('p', { className: 'dsm-note', key: 'note' }, rosterNote),
        ]),
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
      const snap = useSnapshot();

      React.useEffect(() => {
        if (typeof presetId !== 'string' || presetId === '') return;
        if (isBuiltin(presetId) || overrides[presetId] !== undefined) return;
        if (contributionOf(presetId)?.color !== undefined) return;
        if (auto[presetId] !== undefined) return;
        if (pinAutoColors([presetId])) publish();
      }, [presetId]);

      if (typeof presetId !== 'string' || presetId === '') return null;
      const label = modeName(presetId, t);
      const aria = hasOwnName(presetId)
        ? t('badge.aria', { mode: label })
        : t('badge.customAria', { id: presetId });
      const content = snap.dots
        ? [
            h('span', {
              key: 'dot',
              className: 'dsm-mode-dot',
              style: { backgroundColor: resolveColor(presetId) },
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

    // --------------------------------------------------------- preferences --

    /** @param enabled - whether rows draw the mode dot. */
    function setDots(enabled) {
      if (dots === enabled) return;
      dots = enabled;
      persist();
      publish();
    }

    /**
     * Store a user color for one mode.
     * @param id - mode id.
     * @param color - hex color.
     */
    function setModeColor(id, color) {
      if (typeof id !== 'string' || id === '' || !HEX_COLOR.test(color)) return;
      if (overrides[id] === color) return;
      overrides = { ...overrides, [id]: color };
      persist();
      publish();
    }

    /** Drop user colors and pinned auto colors, then re-derive auto colors. */
    function resetColors() {
      overrides = {};
      auto = {};
      pinAutoColors();
      persist();
      publish();
    }

    // ------------------------------------------------------- public service --

    /**
     * Normalize one contribution from another plugin.
     * @param input - candidate `{ id, name?, color? }`.
     * @returns the normalized contribution, or undefined when invalid.
     */
    function normalizeContribution(input) {
      if (typeof input !== 'object' || input === null) return undefined;
      const id = input.id;
      if (typeof id !== 'string' || id === '') return undefined;
      const contribution = { id };
      if (typeof input.name === 'string' && input.name !== '') contribution.name = input.name;
      if (typeof input.color === 'string' && HEX_COLOR.test(input.color)) {
        contribution.color = input.color;
      }
      return contribution;
    }

    /**
     * Registry exposed as the `sessionModeIndicator` Client service. Another
     * plugin registers a mode's name and/or preferred color ahead of time;
     * everything else (auto colors, settings listing) follows automatically.
     */
    const registry = {
      /**
       * Declare one mode's display metadata.
       * @param input - `{ id, name?, color? }`.
       * @returns the disposer that retires this contribution.
       */
      registerMode(input) {
        const contribution = normalizeContribution(input);
        if (contribution === undefined) {
          throw new TypeError('sessionModeIndicator.registerMode: id must be a non-empty string');
        }
        contributions.set(contribution.id, contribution);
        pinAutoColors([contribution.id]);
        publish();
        let disposed = false;
        return () => {
          if (disposed) return;
          disposed = true;
          contributions.delete(contribution.id);
          publish();
        };
      },
      /** @returns the mode list with names, colors, and origin. */
      getModes() {
        return knownIds().map((id) => ({
          id,
          name: modeName(id, t),
          color: resolveColor(id),
          builtin: isBuiltin(id),
          contributed: contributionOf(id) !== undefined,
        }));
      },
      /**
       * Subscribe to preference and mode-list changes.
       * @param listener - callback.
       * @returns the unsubscribe function.
       */
      subscribe(listener) {
        return subscribe(listener);
      },
    };

    // ------------------------------------------------------------- styling --

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
      '.dsm-group-head-row{display:flex;justify-content:space-between;align-items:baseline;gap:12px;}',
      '.dsm-group-head{margin:0;color:var(--dsw-alias-label-tertiary);font-size:12px;font-weight:600;letter-spacing:.06em;text-transform:uppercase;}',
      '.dsm-group-desc{margin:0;color:var(--dsw-alias-label-tertiary);font-size:12px;line-height:18px;}',
      '.dsm-note{margin:0;color:var(--dsw-alias-label-tertiary);font-size:12px;line-height:18px;}',
      '.dsm-refresh{background:0 0;border:0;color:var(--dsw-alias-state-business-primary);font:inherit;font-size:12px;line-height:18px;cursor:pointer;padding:0;}',
      '.dsm-row{display:flex;justify-content:space-between;align-items:center;gap:24px;padding:14px 0;border-bottom:.5px solid var(--dsw-alias-border-l2);}',
      '.dsm-row-title{font-size:14px;line-height:20px;}',
      '.dsm-row-desc{color:var(--dsw-alias-label-secondary);margin-top:4px;font-size:12px;line-height:18px;}',
      '.dsm-color-row{display:flex;align-items:center;gap:12px;padding:6px 0;flex-wrap:wrap;}',
      '.dsm-color-preview{flex:none;width:14px;height:14px;border-radius:50%;}',
      '.dsm-color-name{font-size:13px;line-height:20px;color:var(--dsw-alias-label-primary);}',
      '.dsm-color-id{max-width:160px;font-family:var(--dsw-font-mono,ui-monospace,SFMono-Regular,Menlo,monospace);color:var(--dsw-alias-label-tertiary);text-overflow:ellipsis;white-space:nowrap;font-size:11px;line-height:18px;overflow:hidden;}',
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
        'mode.custom': 'Custom',
        'badge.aria': 'Session mode: {mode}',
        'badge.customAria': 'Session mode: {id}',
        'page.nav': 'Mode dots',
        'page.title': 'Session mode dots',
        'page.intro':
          'Each Session keeps the mode it started with. A colored dot marks that mode in the left sidebar; new modes get a color automatically, and you can change any color here.',
        'page.groups.dots': 'Visibility',
        'page.dots.title': 'Show mode dots',
        'page.dots.description':
          'Draw a dot before the mode label in each Session row. The dot color identifies the mode.',
        'page.groups.builtin': 'Built-in modes',
        'page.groups.custom': 'Custom modes',
        'page.custom.description':
          'Custom modes get a color automatically. Their names come from the preset declaration; a mode without one shows as "Custom".',
        'page.custom.empty':
          'No custom modes yet. A new mode is colored automatically and listed here once a live Session uses it.',
        'page.custom.unavailable':
          'The preset list could not be read; only modes seen in live Sessions are listed.',
        'page.refresh': 'Refresh',
        'page.colors.custom': 'Custom color',
        'page.colors.reset': 'Reset colors',
      },
      zh: {
        'mode.standard': '标准',
        'mode.ptc': 'PTC',
        'mode.minimal': '极简',
        'mode.cordis': '创造',
        'mode.custom': '自定义',
        'badge.aria': '会话模式：{mode}',
        'badge.customAria': '会话模式：{id}',
        'page.nav': '模式圆点',
        'page.title': '会话模式圆点',
        'page.intro':
          '每个会话开启后模式固定、不能切换。左侧栏用彩色圆点标记模式；新模式会自动分配颜色，也可以在这里修改。',
        'page.groups.dots': '显示',
        'page.dots.title': '显示模式圆点',
        'page.dots.description': '在会话行的模式标签前显示圆点，圆点颜色对应会话模式。',
        'page.groups.builtin': '内置模式',
        'page.groups.custom': '自定义模式',
        'page.custom.description':
          '自定义模式会自动分配颜色；名称来自预设声明，未声明名称时显示为「自定义」。',
        'page.custom.empty':
          '还没有自定义模式。新建模式后会自动分配颜色，并在有未归档会话使用后出现在这里。',
        'page.custom.unavailable': '无法读取预设列表，仅列出未归档会话中已使用的模式。',
        'page.refresh': '刷新',
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
            if (event.key !== null && event.key !== STORAGE_KEY) return;
            reloadSettings();
          };
          window.addEventListener('storage', onStorage);
          return () => {
            window.removeEventListener('storage', onStorage);
          };
        }, 'session-mode: settings sync');

        // Read the preset roster once the remote face is reachable; a failed
        // read is retried when the settings page mounts or Refresh is pressed.
        let rosterRequest = null;
        refreshRoster = () => {
          if (rosterRequest !== null) return rosterRequest;
          let remote;
          let namespace;
          try {
            if (typeof ctx.get === 'function') {
              remote = ctx.get('remote');
              namespace = ctx.get('remote.agentPresets');
            }
          } catch {
            remote = undefined;
            namespace = undefined;
          }
          const agentPresets = namespace ?? remote?.agentPresets;
          const list = agentPresets?.list;
          if (typeof list !== 'function') {
            rosterStatus = 'unavailable';
            publish();
            return Promise.resolve();
          }
          rosterStatus = 'loading';
          publish();
          rosterRequest = Promise.resolve()
            .then(() => list.call(agentPresets))
            .then((result) => {
              if (result === null || typeof result !== 'object' || result.ok !== true) {
                throw new Error('agentPresets/list refused');
              }
              const presets = result.value?.presets;
              if (!Array.isArray(presets)) throw new Error('agentPresets/list has no roster');
              roster = presets
                .filter((row) => typeof row?.id === 'string' && row.id !== '')
                .map((row) => ({
                  id: row.id,
                  name:
                    typeof row.name === 'string' && row.name !== '' ? row.name : undefined,
                  isDefault: row.isDefault === true,
                  broken: typeof row.broken === 'string' ? row.broken : undefined,
                }));
              rosterStatus = 'ready';
              pinAutoColors();
            })
            .catch(() => {
              rosterStatus = 'unavailable';
            })
            .finally(() => {
              rosterRequest = null;
              publish();
            });
          return rosterRequest;
        };
        ctx.effect(() => {
          refreshRoster();
          return () => {
            rosterRequest = null;
          };
        }, 'session-mode: preset roster');

        // Public interface for future modes: another plugin may declare a
        // mode's name and preferred color before any Session uses it.
        ctx.effect(() => {
          try {
            const provider = ctx.reflect?.provide
              ? ctx.reflect.provide.bind(ctx.reflect)
              : typeof ctx.provide === 'function'
                ? ctx.provide.bind(ctx)
                : undefined;
            if (provider === undefined) return () => {};
            return provider('sessionModeIndicator', registry);
          } catch {
            return () => {};
          }
        }, 'session-mode: mode registry service');

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
