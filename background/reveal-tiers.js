const REVEAL_TIERS = [
  { breakAt: 1, label: 'Department', field: 'department' },
  { breakAt: 2, label: 'Medium', field: 'medium' },
  { breakAt: 3, label: 'Culture', field: 'culture' },
  { breakAt: 4, label: 'Period', field: 'period' },
  { breakAt: 5, label: 'Country', field: 'country' },
  { breakAt: 6, label: 'Artist', field: 'artistDisplayName' },
  { breakAt: 7, label: 'Date', field: 'objectDate' },
  { breakAt: 8, label: 'Title', field: 'title' },
  { breakAt: 9, label: 'Dimensions', field: 'dimensions' },
  { breakAt: 10, label: 'Credit', field: 'creditLine' },
];

export function getUnlockedClues(artwork, breakCount) {
  if (!artwork) {
    return [];
  }

  return REVEAL_TIERS.filter((tier) => breakCount >= tier.breakAt)
    .map((tier) => {
      const value = artwork[tier.field]?.trim?.() ?? artwork[tier.field];
      if (!value) {
        return null;
      }
      return { label: tier.label, value };
    })
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

  if (breakCount >= 8 && artwork.title) {
    return artwork.title;
  }

  if (breakCount >= 6 && artwork.artistDisplayName) {
    return artwork.artistDisplayName;
  }

  if (breakCount >= 1 && artwork.department) {
    return artwork.department;
  }

  return 'A mystery from The Met';
}

export function getArtworkDisplay(artwork, breakCount) {
  const clues = getUnlockedClues(artwork, breakCount);
  const latestClue = clues.length ? clues[clues.length - 1] : null;

  return {
    headline: getArtworkHeadline(artwork, breakCount),
    latestClue,
    clues,
    titleUnlocked: breakCount >= 8,
    artistUnlocked: breakCount >= 6,
    objectURL: breakCount >= 10 ? artwork?.objectURL ?? null : null,
    objectID: artwork?.objectID ?? null,
  };
}
