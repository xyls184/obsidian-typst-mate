import { beforeAll, describe, expect, it } from 'bun:test';
import i18next from 'i18next';
import en from '../../resources/locales/en.json';

describe('i18n integration', () => {
  const i18n = i18next.createInstance();

  beforeAll(async () => {
    await i18n.init({
      lng: 'en',
      fallbackLng: 'en',
      defaultNS: 'translation',
      resources: { en: { translation: en } },
    });
  });

  it('translates a key', () => {
    expect(i18n.t('commands.openTypstTools')).toBe('Open Typst Tools');
  });

  it('returns the key for missing translations', () => {
    expect(i18n.t('nonexistent.key')).toBe('nonexistent.key');
  });

  it('interpolates values', () => {
    expect(i18n.t('notices.exportedTo', { path: 'out.pdf' })).toBe('Exported to out.pdf');
  });

  it('translates chinese keys when lng is zh', async () => {
    const zhInstance = i18next.createInstance();
    const zh = await Bun.file('resources/locales/zh.json').json();
    await zhInstance.init({
      lng: 'zh',
      fallbackLng: 'en',
      defaultNS: 'translation',
      resources: {
        en: { translation: en },
        zh: { translation: zh },
      },
    });

    expect(zhInstance.t('commands.openTypstTools')).toBe('打开 Typst 工具');
    expect(zhInstance.t('notices.exportedTo', { path: 'out.pdf' })).toBe('已导出到 out.pdf');
    expect(zhInstance.t('settings.renderer.refreshAll')).toBe('刷新全部公式');
  });
});
