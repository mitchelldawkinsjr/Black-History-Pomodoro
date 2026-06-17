const REVEAL_TIERS = [
  {
    breakAt: 1,
    label: 'Department',
    getValue: (artwork) => artwork.department,
    getDetail: (artwork) => {
      if (artwork.classification && artwork.classification !== artwork.department) {
        return artwork.classification;
      }
      return '';
    },
  },
  {
    breakAt: 2,
    label: 'Medium',
    getValue: (artwork) => artwork.medium,
  },
  {
    breakAt: 3,
    label: 'Culture',
    getValue: (artwork) => artwork.culture || artwork.country,
    getDetail: (artwork) => artwork.period || '',
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
    getDetail: (artwork) => artwork.artistDisplayBio || '',
  },
  {
    breakAt: 6,
    label: 'Subjects',
    getValue: (artwork) => formatTagList(getTagTerms(artwork)),
  },
  {
    breakAt: 7,
    label: 'Title',
    getValue: (artwork) => artwork.title,
  },
  {
    breakAt: 8,
    label: 'Catalog note',
    getValue: (artwork) => {
      const catalog = getMetCatalogText(artwork);
      if (catalog) {
        return truncateText(catalog, 110);
      }
      return artwork.repository || '';
    },
    getDetail: (artwork) => getMetCatalogText(artwork),
  },
  {
    breakAt: 9,
    label: 'Dimensions',
    getValue: (artwork) => artwork.dimensions,
    getDetail: (artwork) => (
      artwork.galleryNumber ? `Gallery ${artwork.galleryNumber}` : ''
    ),
  },
  {
    breakAt: 10,
    label: 'Credit line',
    getValue: (artwork) => artwork.creditLine,
  },
];

function stripHtml(text) {
  return String(text)
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function truncateText(text, maxLength) {
  const cleaned = stripHtml(text ?? '');
  if (!cleaned) {
    return '';
  }
  if (cleaned.length <= maxLength) {
    return cleaned;
  }
  return `${cleaned.slice(0, maxLength - 1).trim()}…`;
}

function getMetCatalogText(artwork) {
  if (!artwork) {
    return '';
  }
  return stripHtml(artwork.objectDescription || artwork.additionalInformation || '');
}

function getTagTerms(artwork) {
  if (!Array.isArray(artwork?.tags)) {
    return [];
  }
  return artwork.tags
    .map((tag) => (typeof tag === 'string' ? tag : tag?.term))
    .filter(Boolean);
}

function formatTagList(tags) {
  if (!tags?.length) {
    return '';
  }
  return tags.join(', ');
}

function buildDateContext(artwork) {
  if (artwork.period) {
    return artwork.period;
  }

  if (artwork.department) {
    return artwork.department;
  }

  return artwork.classification || '';
}

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
  const unlockedClues = getUnlockedCluesForBreak(artwork, breakNumber);

  return {
    breakNumber,
    maxBreaks,
    clue: getClueForBreak(artwork, breakNumber),
    unlockedClues,
    headline: getArtworkHeadline(artwork, breakNumber),
    progressLabel: `Break ${breakNumber} of ${maxBreaks}`,
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
