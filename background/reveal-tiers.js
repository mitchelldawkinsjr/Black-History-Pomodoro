/**
 * Progressive Black History fact/clue reveal across 10 earned breaks.
 * Only source-grounded fields; never invent dates, places, or quotations.
 */

function getDiscovery(artwork) {
  const nested = artwork?.discovery;
  if (nested && typeof nested.factText === 'string' && nested.factText.trim()) {
    return nested;
  }
  if (artwork && typeof artwork.factText === 'string' && artwork.factText.trim()) {
    return artwork;
  }
  return null;
}

function clean(value) {
  if (typeof value !== 'string') {
    return '';
  }
  return value.replace(/\s+/g, ' ').trim();
}

function uniqueStrings(values) {
  const seen = new Set();
  const out = [];
  for (const value of values) {
    const text = clean(value);
    if (!text) continue;
    const key = text.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(text);
  }
  return out;
}

function excerptAtWords(text, ratio) {
  const words = clean(text).split(' ').filter(Boolean);
  if (!words.length) {
    return '';
  }
  const count = Math.max(1, Math.min(words.length, Math.ceil(words.length * ratio)));
  let excerpt = words.slice(0, count).join(' ');
  if (count < words.length) {
    excerpt = `${excerpt}…`;
  }
  return excerpt;
}

function shortExcerpt(text, maxWords = 14) {
  const words = clean(text).split(' ').filter(Boolean);
  if (!words.length) {
    return '';
  }
  if (words.length <= maxWords) {
    return words.join(' ');
  }
  return `${words.slice(0, maxWords).join(' ')}…`;
}

function buildClue(label, value, detail = '', breakAt) {
  const cleaned = clean(value);
  if (!cleaned) {
    return null;
  }
  return {
    label,
    value: cleaned,
    detail: clean(detail),
    breakNumber: breakAt,
    kind: label === 'Fact' || label === 'Excerpt' ? 'fact' : 'meta',
  };
}

/** Attribution for the image the discovery was matched to (Commons credit, creator, license). */
export function buildImageAttribution(discovery) {
  const visual = discovery?.visual;
  if (!visual || typeof visual !== 'object') {
    return 'Courtesy of The Black History API';
  }

  const credit = clean(visual.credit ?? '');
  if (credit) {
    if (/^courtesy of\b/i.test(credit)) {
      return credit;
    }
    if (/^black history (pomodoro|api)$/i.test(credit)) {
      return 'Courtesy of The Black History API';
    }
    return `Courtesy of ${credit}`;
  }

  const creator = clean(visual.creator ?? '');
  const license = clean(visual.license ?? '');
  const title = clean(visual.title ?? '');
  if (creator && license) {
    return `Courtesy of ${creator} — ${license}`;
  }
  if (title && license) {
    return `Courtesy of ${title} — ${license}`;
  }
  if (license) {
    return `Courtesy of ${license}`;
  }
  return 'Courtesy of The Black History API';
}

function buildImageClue(discovery) {
  const visual = discovery?.visual;
  if (!visual || typeof visual !== 'object') {
    return null;
  }

  const title = clean(visual.title ?? '');
  const credit = clean(visual.credit ?? '');
  const license = clean(visual.license ?? '');
  const creator = clean(visual.creator ?? '');
  const depictsSubject = visual.depictsSubject === true;

  const value =
    title
    || credit
    || (depictsSubject ? 'Matched subject image' : 'Project visual');
  if (!value) {
    return null;
  }

  const detailParts = [];
  if (creator && creator !== title) {
    detailParts.push(creator);
  }
  if (license) {
    detailParts.push(license);
  } else if (credit && credit !== title && credit !== value) {
    detailParts.push(credit);
  }
  if (!depictsSubject) {
    detailParts.push('Subject not verified');
  }

  return {
    label: 'Image',
    value,
    detail: detailParts.join(' · '),
    breakNumber: 10,
    kind: 'meta',
  };
}

export function deriveRevealCards(discovery, earnedBreaks) {
  if (!discovery || earnedBreaks < 1) {
    return [];
  }

  const tags = uniqueStrings(discovery.tags ?? []);
  const people = uniqueStrings(discovery.people ?? []);
  const factText = clean(discovery.factText);
  const eventDate = clean(discovery.eventDate ?? '');
  const sourceLabel = clean(discovery.source?.label ?? '');
  const cards = [];

  const push = (breakAt, label, value, detail = '') => {
    if (earnedBreaks < breakAt) {
      return;
    }
    const clue = buildClue(label, value, detail, breakAt);
    if (clue) {
      cards.push(clue);
    }
  };

  // Early tease only until a concrete theme (or later meta) takes its place.
  if (earnedBreaks < 2 || !tags[0]) {
    push(
      1,
      'Discovery',
      'A story from Black history',
      tags[0] ? `Opening theme: ${tags[0]}` : 'More detail unlocks with each focus session',
    );
  }

  if (tags[0]) {
    const themeDetail =
      tags.length > 1
        ? tags.slice(1, 3).join(' · ')
        : earnedBreaks >= 5
          ? 'Tied to today’s discovery'
          : '';
    push(2, 'Theme', tags[0], themeDetail);
  } else if (tags[1]) {
    push(2, 'Theme', tags[1]);
  }

  if (eventDate) {
    push(3, 'When', eventDate, tags[0] && earnedBreaks < 7 ? `During a chapter of ${tags[0]}` : '');
  }

  // Geography/institution only when explicitly present in source metadata — omit otherwise.
  if (people[0]) {
    const peopleDetail =
      people.length > 1
        ? `${people.length} people named in this discovery`
        : eventDate
          ? `Named in the ${eventDate} account`
          : '';
    push(7, 'People', people.join(', '), peopleDetail);
  }

  if (factText) {
    push(5, 'Excerpt', shortExcerpt(factText, 12), '');
    push(
      6,
      'Excerpt',
      shortExcerpt(factText, 20),
      tags[0] ? `Theme · ${tags[0]}` : '',
    );
    push(8, 'Fact', excerptAtWords(factText, 0.4), tags[0] ? `Theme · ${tags[0]}` : '');
    push(
      9,
      'Fact',
      excerptAtWords(factText, 0.75),
      people[0] ? `Featuring · ${people[0]}` : tags[0] ? `Theme · ${tags[0]}` : '',
    );
    push(
      10,
      'Fact',
      factText,
      sourceLabel ? `Source · ${sourceLabel}` : '',
    );
  }

  if (earnedBreaks >= 10) {
    const imageClue = buildImageClue(discovery);
    if (imageClue) {
      cards.push(imageClue);
    }
  }

  return cards;
}

export function getUnlockedClues(artwork, breakCount) {
  return deriveRevealCards(getDiscovery(artwork), breakCount);
}

export function getUnlockedCluesForBreak(artwork, breakNumber) {
  return deriveRevealCards(getDiscovery(artwork), breakNumber);
}

export function getLatestClue(artwork, breakCount) {
  const clues = getUnlockedClues(artwork, breakCount);
  return clues.length ? clues[clues.length - 1] : null;
}

export function getArtworkHeadline(artwork, breakCount) {
  const discovery = getDiscovery(artwork);
  if (!discovery?.factText) {
    return 'Loading today’s discovery…';
  }

  const people = uniqueStrings(discovery.people ?? []);
  const tags = uniqueStrings(discovery.tags ?? []);
  const eventDate = clean(discovery.eventDate ?? '');

  if (breakCount >= 10) {
    return people[0] || tags[0] || 'Black history discovery';
  }
  if (breakCount >= 7 && people[0]) {
    return people[0];
  }
  if (breakCount >= 2 && tags[0]) {
    return tags[0];
  }
  if (breakCount >= 1) {
    return tags[0] || people[0] || 'A story from Black history';
  }

  // Ready, before first break — tease without spoiling the fact.
  if (people[0] && tags[0]) {
    return `${people[0]} · ${tags[0]}`;
  }
  if (people[0]) {
    return people[0];
  }
  if (tags[0] && eventDate) {
    return `${tags[0]} · ${eventDate}`;
  }
  if (tags[0]) {
    return tags[0];
  }
  if (eventDate) {
    return `A story from ${eventDate}`;
  }
  return 'Today’s discovery is ready';
}

export function getClueForBreak(artwork, breakNumber) {
  const clues = deriveRevealCards(getDiscovery(artwork), breakNumber);
  return clues.find((clue) => clue.breakNumber === breakNumber) ?? null;
}

export function getBreakRevealDisplay(artwork, breakNumber, maxBreaks = 10) {
  const paintingBreakNumber = ((breakNumber - 1) % maxBreaks) + 1;
  const unlockedClues = getUnlockedCluesForBreak(artwork, paintingBreakNumber);
  const discovery = getDiscovery(artwork);

  return {
    breakNumber,
    paintingBreakNumber,
    maxBreaks,
    clue: getClueForBreak(artwork, paintingBreakNumber),
    unlockedClues,
    headline: getArtworkHeadline(artwork, paintingBreakNumber),
    progressLabel: `Discovery ${paintingBreakNumber}/${maxBreaks}`,
    attribution: buildImageAttribution(discovery),
    factText: clean(discovery?.factText ?? ''),
  };
}

export function getArtworkDisplay(artwork, breakCount) {
  const clues = getUnlockedClues(artwork, breakCount);
  const latestClue = clues.length ? clues[clues.length - 1] : null;
  const discovery = getDiscovery(artwork);

  return {
    headline: getArtworkHeadline(artwork, breakCount),
    latestClue,
    clues,
    titleUnlocked: breakCount >= 7,
    artistUnlocked: breakCount >= 5,
    objectURL: breakCount >= 10 ? discovery?.source?.url ?? null : null,
    objectID: discovery?.id ?? artwork?.objectID ?? null,
    factText: breakCount >= 8 ? clean(discovery?.factText ?? '') : '',
    factComplete: breakCount >= 10,
  };
}
