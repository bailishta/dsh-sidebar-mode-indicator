/**
 * Client half of the sidebar session-mode indicator.
 *
 * Each Session runs under the agent preset it started with, and that mode is
 * fixed once the Session opens. The row's trailing seat is where the shipped
 * Client draws a Session's resting metadata (relative time, status icons), so
 * this plugin adds exactly one more piece of that metadata: the Session's own
 * mode, as localized text. Nothing else is rendered or changed.
 */
window.__ModuleLoader__.load({
  id: 'dsh-session-mode-indicator',
  factory(require) {
    const React = require('react');
    const h = React.createElement;

    /** Locale namespace owned by this plugin. */
    const NS = 'session-mode-indicator';

    /**
     * Shipped preset ids whose copy the plugin carries itself. Every other id
     * (a user-authored preset) is shown verbatim; the projection stores only
     * the id, not the declaration's display name.
     */
    const BUILT_IN_MODES = {
      standard: 'mode.standard',
      ptc: 'mode.ptc',
      minimal: 'mode.minimal',
      cordis: 'mode.cordis',
    };

    /** Dictionaries for every built-in DSH locale; unknown locales fall back to English. */
    const DICTIONARIES = {
      en: {
        'mode.standard': 'Standard',
        'mode.ptc': 'PTC',
        'mode.minimal': 'Minimal',
        'mode.cordis': 'Create',
        'badge.aria': 'Session mode: {mode}',
      },
      zh: {
        'mode.standard': '标准',
        'mode.ptc': 'PTC',
        'mode.minimal': '极简',
        'mode.cordis': '创造',
        'badge.aria': '会话模式：{mode}',
      },
    };

    /**
     * Row styling: the mode is a compact outlined pill so it stays legible
     * beside the 10px resting time, while still reading as row metadata
     * rather than a control. Colors come from host theme tokens only.
     */
    const CSS = [
      '.dsm-mode-badge{',
      'flex:none;white-space:nowrap;user-select:none;',
      'display:inline-flex;align-items:center;justify-content:center;',
      'height:20px;padding:0 7px;border-radius:10px;',
      'font-size:12px;line-height:18px;font-weight:500;letter-spacing:.02em;',
      'color:var(--dsw-alias-label-secondary);',
      'border:1px solid var(--dsw-alias-border-l2);',
      '}',
    ].join('');

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

    /**
     * One Session row's mode text.
     * @param props.sessionId - Session this row shows; the plugin reads only its
     * own list projection and never retains or opens the Session.
     * @param props.useSessions - selector hook over the Client Session list.
     * @param props.t - locale lookup for this plugin's namespace.
     * @returns the mode text, or nothing while the list carries no mode.
     */
    function SessionModeBadge({ sessionId, useSessions, t }) {
      const presetId = useSessions(
        (state) => state?.byId?.[sessionId]?.projectionValues?.agentPreset,
      );
      if (typeof presetId !== 'string' || presetId === '') return null;
      const label = modeLabel(presetId, t);
      const aria = t('badge.aria', { mode: label });
      return h(
        'span',
        {
          className: 'dsm-mode-badge',
          'data-session-mode': presetId,
          title: aria,
          'aria-label': aria,
        },
        label,
      );
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
      },
    };
  },
});
