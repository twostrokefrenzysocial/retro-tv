import { describe, expect, it } from 'vitest';
import {
  displayTitle,
  formatRank,
  hasNonLatinScript,
  isBlocked,
  isEnglishLanguage,
  isOpenLicense,
  parseLength,
  parseYear,
  pickPlayableFile,
  searchableText,
  withinYears,
} from '../scripts/catalog-parse.ts';

describe('parseLength', () => {
  it('reads a plain seconds value', () => {
    expect(parseLength('1523.45')).toBe(1523);
    expect(parseLength('  90 ')).toBe(90);
  });

  it('reads HH:MM:SS and MM:SS', () => {
    expect(parseLength('01:25:23')).toBe(5123);
    expect(parseLength('25:23')).toBe(1523);
    expect(parseLength('0:30')).toBe(30);
  });

  it('rejects junk, zero and negative runtimes', () => {
    for (const bad of [undefined, '', '   ', 'n/a', '0', '-5', '1:2:3:4', 'aa:bb']) {
      expect(parseLength(bad), `expected null for ${String(bad)}`).toBeNull();
    }
  });
});

describe('formatRank / pickPlayableFile', () => {
  it('ranks h.264 above MPEG4 above the 512Kb derivative', () => {
    // Archive labels the first one "h.264 IA", not a bare "h.264".
    expect(formatRank('h.264 IA')).toBe(0);
    expect(formatRank('h.264')).toBe(0);
    expect(formatRank('MPEG4')).toBe(1);
    expect(formatRank('512Kb MPEG4')).toBe(2);
    expect(formatRank('Thumbnail')).toBeNull();
    expect(formatRank(undefined)).toBeNull();
  });

  it('picks the best available mp4', () => {
    const files = [
      { name: 'a_512kb.mp4', format: '512Kb MPEG4', length: '10' },
      { name: 'a.mp4', format: 'MPEG4', length: '10' },
      { name: 'a.ia.mp4', format: 'h.264 IA', length: '10' },
    ];
    expect(pickPlayableFile(files)?.name).toBe('a.ia.mp4');
    expect(pickPlayableFile(files.slice(0, 2))?.name).toBe('a.mp4');
    expect(pickPlayableFile(files.slice(0, 1))?.name).toBe('a_512kb.mp4');
  });

  it('ignores non-mp4 files even in a playable format', () => {
    expect(pickPlayableFile([{ name: 'movie.ogv', format: 'Ogg Video' }])).toBeNull();
    expect(pickPlayableFile([{ name: 'thumb.jpg', format: 'Thumbnail' }])).toBeNull();
    expect(pickPlayableFile([])).toBeNull();
  });
});

describe('isOpenLicense', () => {
  it('accepts public domain and Creative Commons URLs', () => {
    for (const url of [
      'http://creativecommons.org/licenses/publicdomain/',
      'https://creativecommons.org/publicdomain/zero/1.0/',
      'https://creativecommons.org/licenses/by/4.0/',
      'http://creativecommons.org/mark/1.0/',
    ]) {
      expect(isOpenLicense(url), url).toBe(true);
    }
  });

  it('rejects a missing or unrelated licence', () => {
    expect(isOpenLicense(null)).toBe(false);
    expect(isOpenLicense('https://example.com/all-rights-reserved')).toBe(false);
  });
});

describe('parseYear', () => {
  const now = new Date('2026-10-29T00:00:00Z');

  it('prefers an explicit year field', () => {
    expect(parseYear({ year: '1940' }, 'Anything', now)).toBe(1940);
    expect(parseYear({ year: 1925 }, undefined, now)).toBe(1925);
  });

  it('falls back to the date field', () => {
    expect(parseYear({ date: '1954-03-01' }, undefined, now)).toBe(1954);
    expect(parseYear({ date: ['1946'] }, undefined, now)).toBe(1946);
  });

  it('never uses publicdate, which is when the file was uploaded', () => {
    // The exact bug this guards: a 1940 film uploaded in 2011.
    expect(parseYear({ publicdate: '2011-03-12 22:42:29' }, undefined, now)).toBeNull();
    expect(parseYear({ addeddate: '2011-03-12' }, undefined, now)).toBeNull();
    expect(parseYear({ publicdate: '2011-03-12' }, 'The Ape (1940)', now)).toBe(1940);
  });

  it('reads a year out of the title when no date field exists', () => {
    expect(parseYear({}, 'The Ape (1940)', now)).toBe(1940);
    expect(parseYear({}, 'Trauma (1962)', now)).toBe(1962);
    expect(parseYear({}, 'Murphy Brown 2-10 Candice Bergen (1988)', now)).toBe(1988);
  });

  it('returns null rather than guessing', () => {
    expect(parseYear({}, 'An Untitled Reel', now)).toBeNull();
    expect(parseYear({}, undefined, now)).toBeNull();
  });

  it('ignores implausible years', () => {
    expect(parseYear({ year: '1200' }, undefined, now)).toBeNull();
    // A year in the future is not a release year.
    expect(parseYear({ year: '2099' }, undefined, now)).toBeNull();
    expect(parseYear({}, 'Episode 1812 of a series', now)).toBeNull();
  });
});

describe('withinYears', () => {
  it('accepts anything when no era is declared', () => {
    expect(withinYears(2024, undefined, undefined)).toBe(true);
    expect(withinYears(null, undefined, undefined)).toBe(true);
  });

  it('enforces both ends of the era', () => {
    expect(withinYears(1955, 1950, 1969)).toBe(true);
    expect(withinYears(1950, 1950, 1969)).toBe(true);
    expect(withinYears(1969, 1950, 1969)).toBe(true);
    expect(withinYears(1949, 1950, 1969)).toBe(false);
    expect(withinYears(1970, 1950, 1969)).toBe(false);
  });

  it('rejects an undatable item from an era-bounded channel', () => {
    // A channel that claims to be "the fifties" cannot carry something we
    // are unable to date at all.
    expect(withinYears(null, 1950, 1969)).toBe(false);
    expect(withinYears(null, undefined, 2005)).toBe(false);
  });
});

describe('isBlocked', () => {
  const TERMS = ['childbirth', 'human birth', 'sexual*', 'vd', 'nudist', 'social hygiene'];

  it('catches the graphic classroom films', () => {
    expect(isBlocked('human birth.', TERMS)).toBe('human birth');
    expect(isBlocked('the sexually mature adult.', TERMS)).toBe('sexual*');
    expect(isBlocked('vd: attack plan', TERMS)).toBe('vd');
    expect(isBlocked('social hygiene for young men', TERMS)).toBe('social hygiene');
  });

  it('matches whole words only, so ordinary titles survive', () => {
    expect(isBlocked('birthday party at the zoo', TERMS)).toBeNull();
    expect(isBlocked('mr. sexton goes to town', TERMS)).toBeNull();
    expect(isBlocked('advanced division', TERMS)).toBeNull(); // not "vd"
  });

  it('treats a trailing asterisk as a stem', () => {
    for (const t of ['sexual education', 'sexually transmitted', 'sexuality today']) {
      expect(isBlocked(t, TERMS), t).toBe('sexual*');
    }
    expect(isBlocked('unisexual plants', TERMS)).toBeNull(); // stem is prefix-anchored
  });

  it('returns null when nothing matches', () => {
    expect(isBlocked('duck and cover', TERMS)).toBeNull();
    expect(isBlocked('anything at all', [])).toBeNull();
  });
});

describe('searchableText', () => {
  it('folds title, subject and description together', () => {
    const text = searchableText(
      { subject: ['Hygiene', 'Education'], description: '<p>A film about <b>VD</b></p>' },
      'Attack Plan',
    );
    expect(text).toContain('attack plan');
    expect(text).toContain('hygiene');
    // HTML must not hide a blocked word from the filter.
    expect(text).toContain('vd');
    expect(text).not.toContain('<b>');
  });
});

describe('language filtering', () => {
  it('keeps English, however it is spelled', () => {
    for (const v of ['eng', 'en', 'English', 'ENG', 'en-US']) {
      expect(isEnglishLanguage({ language: v }), v).toBe(true);
    }
  });

  it('drops a declared foreign language', () => {
    for (const v of ['jpn', 'fre', 'French', 'spa', 'ger', 'Mandarin Chinese']) {
      expect(isEnglishLanguage({ language: v }), v).toBe(false);
    }
  });

  it('keeps an item that declares no language', () => {
    // Only a third of items declare one, so absence cannot mean rejection.
    expect(isEnglishLanguage({})).toBe(true);
    expect(isEnglishLanguage({ language: '' })).toBe(true);
    expect(isEnglishLanguage({ language: 'none' })).toBe(true);
  });

  it('keeps a dual-language item, which still has an English track', () => {
    expect(isEnglishLanguage({ language: ['English', 'French'] })).toBe(true);
  });

  it('keeps silent films, which have no spoken language at all', () => {
    expect(isEnglishLanguage({ language: 'silent' })).toBe(true);
    expect(isEnglishLanguage({ language: 'zxx' })).toBe(true);
  });
});

describe('hasNonLatinScript', () => {
  it('catches untagged foreign material by its title', () => {
    // The case that prompted this: a Japanese advert with no language field.
    expect(hasNonLatinScript('懐かしのCM集 - Japanese Commercials')).toBe(true);
    expect(hasNonLatinScript('Gamera vs. Guiron (ガメラ対大悪獣ギロン)')).toBe(true);
    expect(hasNonLatinScript('Броненосец Потёмкин')).toBe(true);
    expect(hasNonLatinScript('Song at Midnight (夜半歌聲)')).toBe(true);
  });

  it('leaves ordinary English titles alone', () => {
    for (const t of ['The Stranger', 'Duck and Cover', 'Café Society', 'Naïve Melody', '£5 a Week']) {
      expect(hasNonLatinScript(t), t).toBe(false);
    }
  });
});

describe('adult and graphic content filtering', () => {
  const TERMS: string[] = [
    'playboy', 'boob*', 'topless', 'nudist', 'xxx', 'pin-up',
    'human birth', 'sexual*', 'vd', 'execution',
  ];

  it('blocks the adult material that reached the screen', () => {
    expect(isBlocked('playboy channel commercial 1982', TERMS)).toBe('playboy');
    expect(isBlocked('big boobs buster 2', TERMS)).toBe('boob*');
    expect(isBlocked('topless dancers of soho', TERMS)).toBe('topless');
  });

  it('does not catch innocent titles that merely look similar', () => {
    for (const t of ['chicken breast preparation', 'the executive suite', 'adult education in ohio',
                     'boston blackie', 'breakfast at the diner']) {
      expect(isBlocked(t, TERMS), t).toBeNull();
    }
  });
});

describe('displayTitle', () => {
  it('drops a container extension left on the end of an upload', () => {
    expect(displayTitle('CMP306_Reflections.wmv')).toBe('Reflections');
    expect(displayTitle('Nosferatu.mp4')).toBe('Nosferatu');
  });

  it('strips an institutional shelf mark from the front', () => {
    expect(displayTitle('JSC-500 Apollo 8-Go For TLI.wmv')).toBe('Apollo 8-Go For TLI');
    expect(displayTitle('HQ220_Universe_Episode11.wmv')).toBe('Universe Episode11');
    expect(displayTitle('VJSC_1413_STS62_Mission_Highlights.wmv')).toBe(
      'STS62 Mission Highlights',
    );
  });

  it('reads underscores as spaces', () => {
    expect(displayTitle('Promo_Hogans_Heroes_CBS_TV_1967')).toBe('Promo Hogans Heroes CBS TV 1967');
    expect(displayTitle('Promo_He__She_CBS_TV_1967')).toBe('Promo He She CBS TV 1967');
  });

  it('leaves a hyphenated title alone', () => {
    expect(displayTitle('Rikki-Tikki-Tavi')).toBe('Rikki-Tikki-Tavi');
    expect(displayTitle('Re-Animator')).toBe('Re-Animator');
    expect(displayTitle('Art--people--feelings')).toBe('Art--people--feelings');
  });

  it('leaves an ordinary title untouched', () => {
    expect(displayTitle('The Big Cat')).toBe('The Big Cat');
    expect(displayTitle('  Blood on the Sun  ')).toBe('Blood on the Sun');
    expect(displayTitle('2001: A Space Odyssey trailer')).toBe('2001: A Space Odyssey trailer');
  });

  it('keeps something to show when the title is only a shelf mark', () => {
    expect(displayTitle('JSC-500')).toBe('JSC-500');
    expect(displayTitle('CMP304_')).toBe('CMP304');
    expect(displayTitle('.wmv')).toBe('.wmv');
  });
});
