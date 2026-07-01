import {
  buildArtistProfile,
  buildCollectionDetail,
  buildCollectionHighlight,
  buildCultureContext,
  buildDateContext,
  buildDepartmentContext,
  buildMediumContext,
  buildScaleContext,
  buildSubjectNarrative,
  buildTitleContext,
  buildWorkStory,
  formatTagList,
  getMetCatalogText,
  getTagTerms,
  truncateText,
} from './artwork-copy.js';

const REVEAL_TIERS = [
  {
    breakAt: 1,
    label: 'Collection',
    getValue: (artwork) => artwork.department,
    getDetail: (artwork) => buildDepartmentContext(artwork),
  },
  {
    breakAt: 2,
    label: 'Medium',
    getValue: (artwork) => artwork.medium,
    getDetail: (artwork) => buildMediumContext(artwork),
  },
  {
    breakAt: 3,
    label: 'Origins',
    getValue: (artwork) => (
      artwork.culture
      || artwork.country
      || artwork.period
      || artwork.artistNationality
      || artwork.department
    ),
    getDetail: (artwork) => buildCultureContext(artwork),
  },
  {
    breakAt: 4,
    label: 'Date',
    getValue: (artwork) => artwork.objectDate || artwork.period,
    getDetail: (artwork) => buildDateContext(artwork),
  },
  {
    breakAt: 5,
    label: 'Artist',
    getValue: (artwork) => artwork.artistDisplayName,
    getDetail: (artwork) => buildArtistProfile(artwork),
  },
  {
    breakAt: 6,
    label: 'Subjects',
    getValue: (artwork) => formatTagList(getTagTerms(artwork)),
    getDetail: (artwork) => buildSubjectNarrative(artwork),
  },
  {
    breakAt: 7,
    label: 'Title',
    getValue: (artwork) => artwork.title,
    getDetail: (artwork) => buildTitleContext(artwork),
  },
  {
    breakAt: 8,
    label: 'About this work',
    getValue: (artwork) => {
      const story = buildWorkStory(artwork);
      return story ? truncateText(story, 160) : '';
    },
    getDetail: (artwork) => buildWorkStory(artwork),
  },
  {
    breakAt: 9,
    label: 'Scale',
    getValue: (artwork) => artwork.dimensions,
    getDetail: (artwork) => buildScaleContext(artwork),
  },
  {
    breakAt: 10,
    label: 'At The Met',
    getValue: (artwork) => (
      buildCollectionHighlight(artwork)
      || artwork.repository
      || 'The Metropolitan Museum of Art'
    ),
    getDetail: (artwork) => buildCollectionDetail(artwork),
  },
];

function buildClueEntry(artwork, tier) {
  const rawValue = tier.getValue?.(artwork);
  const value = typeof rawValue === 'string' ? rawValue.trim() : rawValue;
  if (!value) {
    return null;
  }

  const detail = tier.getDetail?.(artwork);
  const cleanedDetail = typeof detail === 'string' ? detail.trim() : '';

  return {
    label: tier.label,
    value: String(value),
    detail: cleanedDetail,
    breakNumber: tier.breakAt,
  };
}

export function getUnlockedClues(artwork, breakCount) {
  if (!artwork) {
    return [];
  }

  return REVEAL_TIERS
    .filter((tier) => breakCount >= tier.breakAt)
    .map((tier) => buildClueEntry(artwork, tier))
    .filter(Boolean);
}

export function getUnlockedCluesForBreak(artwork, breakNumber) {
  if (!artwork || breakNumber < 1) {
    return [];
  }

  return REVEAL_TIERS
    .filter((tier) => breakNumber >= tier.breakAt)
    .map((tier) => buildClueEntry(artwork, tier))
    .filter(Boolean);
}

export function getLatestClue(artwork, breakCount) {
  const clues = getUnlockedClues(artwork, breakCount);
  return clues.length ? clues[clues.length - 1] : null;
}

export function getArtworkHeadline(artwork, breakCount) {
  if (!artwork) {
    return 'Loading today\'s painting…';
  }

  if (breakCount >= 7 && artwork.title) {
    return artwork.title;
  }

  if (breakCount >= 5 && artwork.artistDisplayName) {
    return artwork.artistDisplayName;
  }

  if (breakCount >= 1 && artwork.department) {
    return artwork.department;
  }

  return 'The Met collection';
}

export function getClueForBreak(artwork, breakNumber) {
  if (!artwork || breakNumber < 1) {
    return null;
  }

  const tier = REVEAL_TIERS.find((entry) => entry.breakAt === breakNumber);
  if (!tier) {
    return null;
  }

  return buildClueEntry(artwork, tier);
}

export function getBreakRevealDisplay(artwork, breakNumber, maxBreaks = 10) {
  const paintingBreakNumber = ((breakNumber - 1) % maxBreaks) + 1;
  const unlockedClues = getUnlockedCluesForBreak(artwork, paintingBreakNumber);

  return {
    breakNumber,
    paintingBreakNumber,
    maxBreaks,
    clue: getClueForBreak(artwork, paintingBreakNumber),
    unlockedClues,
    headline: getArtworkHeadline(artwork, paintingBreakNumber),
    progressLabel: `Break ${breakNumber}`,
    attribution: 'Courtesy of The Metropolitan Museum of Art',
  };
}

export function getArtworkDisplay(artwork, breakCount) {
  const clues = getUnlockedClues(artwork, breakCount);
  const latestClue = clues.length ? clues[clues.length - 1] : null;

  return {
    headline: getArtworkHeadline(artwork, breakCount),
    latestClue,
    clues,
    titleUnlocked: breakCount >= 7,
    artistUnlocked: breakCount >= 5,
    objectURL: breakCount >= 10 ? artwork?.objectURL ?? null : null,
    objectID: artwork?.objectID ?? null,
  };
}
