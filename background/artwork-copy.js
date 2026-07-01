const DEPARTMENT_BLURBS = {
  'European Paintings':
    'Seven centuries of Western painting — from devotional panels to the experiments of the modern age.',
  'Asian Art':
    'Painting and calligraphy from across East, South, and Southeast Asia, on silk, paper, and panel.',
  'Islamic Art':
    'Works from Islamic lands spanning Spain to South Asia — manuscript illumination, ceramics, and textiles.',
  'Arts of Africa, Oceania, and the Americas':
    'Objects and paintings shaped by Indigenous and diasporic traditions across three continents.',
  'Modern and Contemporary Art':
    'Art from the late 19th century to today — movements that rewrote what painting could be.',
  'Drawings and Prints':
    'Works on paper — sketches, studies, and finished compositions in ink, chalk, and watercolor.',
  'American Art':
    'Painting and decorative arts that trace the United States from colonial portraiture to modernism.',
  'Egyptian Art':
    'Ancient Egyptian painting and relief, often tied to tomb, temple, and ritual life.',
  'Greek and Roman Art':
    'Classical and Hellenistic works rooted in myth, empire, and the ancient Mediterranean.',
};

const ERA_HINTS = [
  { max: 1400, text: 'A work of the late medieval or early Renaissance world.' },
  { max: 1600, text: 'Painted during the Renaissance or Mannerist era — an age of humanism and patronage.' },
  { max: 1700, text: 'From the Baroque period, when drama, light, and movement dominated European art.' },
  { max: 1800, text: 'Created in the 18th century — the age of Enlightenment, revolutions, and grand narratives.' },
  { max: 1850, text: 'A 19th-century work, when academies and avant-garde movements collided.' },
  { max: 1900, text: 'Painted around the turn of the 20th century, as artists broke from tradition.' },
  { max: 1950, text: 'A modern work from the first half of the 20th century.' },
  { max: Infinity, text: 'A work of the modern or contemporary era.' },
];

export function stripHtml(text) {
  return String(text)
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function truncateText(text, maxLength) {
  const cleaned = stripHtml(text ?? '');
  if (!cleaned) {
    return '';
  }
  if (cleaned.length <= maxLength) {
    return cleaned;
  }
  const slice = cleaned.slice(0, maxLength - 1);
  const lastSpace = slice.lastIndexOf(' ');
  const trimmed = lastSpace > maxLength * 0.6 ? slice.slice(0, lastSpace) : slice;
  return `${trimmed.trim()}…`;
}

export function getMetCatalogText(artwork) {
  if (!artwork) {
    return '';
  }
  return stripHtml(artwork.objectDescription || artwork.additionalInformation || '');
}

export function getTagTerms(artwork) {
  if (!Array.isArray(artwork?.tags)) {
    return [];
  }
  return artwork.tags
    .map((tag) => (typeof tag === 'string' ? tag : tag?.term))
    .filter(Boolean);
}

export function formatTagList(tags) {
  if (!tags?.length) {
    return '';
  }
  if (tags.length === 1) {
    return tags[0];
  }
  if (tags.length === 2) {
    return `${tags[0]} and ${tags[1]}`;
  }
  return `${tags.slice(0, -1).join(', ')}, and ${tags[tags.length - 1]}`;
}

function parsePrimaryYear(artwork) {
  if (artwork.objectBeginDate != null && !Number.isNaN(Number(artwork.objectBeginDate))) {
    return Number(artwork.objectBeginDate);
  }

  const match = String(artwork.objectDate ?? '').match(/\d{3,4}/);
  return match ? Number(match[0]) : null;
}

function parseArtistLifespan(artwork) {
  const begin = artwork.artistBeginDate;
  const end = artwork.artistEndDate;
  if (begin && end) {
    return `${begin}–${end}`;
  }
  return '';
}

function joinSentences(parts) {
  return parts
    .map((part) => String(part ?? '').trim())
    .filter(Boolean)
    .map((part) => (part.endsWith('.') ? part : `${part}.`))
    .join(' ');
}

export function buildDepartmentContext(artwork) {
  const department = artwork.department?.trim();
  if (!department) {
    return '';
  }

  const blurb = DEPARTMENT_BLURBS[department];
  if (blurb) {
    return blurb;
  }

  return `Part of the Met's ${department} collection — one of the museum's major areas of strength.`;
}

export function buildMediumContext(artwork) {
  const medium = (artwork.medium ?? '').trim();
  if (!medium) {
    return '';
  }

  const lower = medium.toLowerCase();

  if (lower.includes('oil on canvas')) {
    return 'Oil on canvas — the classic European studio medium, built up in layers that hold rich color and visible brushwork.';
  }
  if (lower.includes('oil on panel') || lower.includes('oil on wood')) {
    return 'Oil on a wooden panel — a durable support favored by Renaissance and early modern painters.';
  }
  if (lower.includes('tempera')) {
    return 'Egg tempera dries quickly and yields precise, matte color — a technique tied to medieval and early Renaissance workshops.';
  }
  if (lower.includes('watercolor') || lower.includes('watercolour')) {
    return 'Transparent washes of watercolor let light pass through the paper, ideal for atmosphere and delicate detail.';
  }
  if (lower.includes('gouache')) {
    return 'Opaque watercolor (gouache) combines fluid washes with flat, matte passages of color.';
  }
  if (lower.includes('ink')) {
    return 'Ink on paper rewards line, gesture, and restraint — common in East Asian scroll painting and European drawing.';
  }
  if (lower.includes('silk')) {
    return 'Painting on silk asks for controlled, flowing strokes — a hallmark of many Asian traditions.';
  }
  if (lower.includes('acrylic')) {
    return 'Acrylic paint dries fast and holds bold, flat color — a hallmark of much 20th-century painting.';
  }

  return `Made with ${medium} — the materials shape how color, texture, and light read on the surface.`;
}

export function buildCultureContext(artwork) {
  const parts = [];

  if (artwork.culture?.trim()) {
    parts.push(`Rooted in ${artwork.culture.trim()} tradition`);
  } else if (artwork.country?.trim()) {
    parts.push(`Associated with ${artwork.country.trim()}`);
  } else if (artwork.artistNationality?.trim()) {
    parts.push(`Reflects ${artwork.artistNationality.trim()} artistic heritage`);
  }

  if (artwork.dynasty?.trim()) {
    parts.push(`${artwork.dynasty.trim()} dynasty`);
  }
  if (artwork.reign?.trim()) {
    parts.push(`from the reign of ${artwork.reign.trim()}`);
  }
  if (artwork.period?.trim() && artwork.period.trim() !== artwork.objectDate?.trim()) {
    parts.push(artwork.period.trim());
  }

  if (!parts.length) {
    return buildDepartmentContext(artwork);
  }

  return joinSentences([parts.join(', ')]);
}

export function buildDateContext(artwork) {
  const year = parsePrimaryYear(artwork);
  const parts = [];

  if (artwork.period?.trim()) {
    parts.push(artwork.period.trim());
  }

  if (year != null) {
    const era = ERA_HINTS.find((entry) => year <= entry.max);
    if (era) {
      parts.push(era.text);
    }

    const lifespan = parseArtistLifespan(artwork);
    const artistEnd = Number(artwork.artistEndDate);
    if (lifespan && artistEnd && year >= artistEnd - 5) {
      parts.push(`Painted near the end of the artist's life (${lifespan})`);
    } else if (lifespan && year <= Number(artwork.artistBeginDate) + 10) {
      parts.push(`An early work from the artist's career (${lifespan})`);
    }
  } else if (artwork.department) {
    parts.push(buildDepartmentContext(artwork));
  }

  return joinSentences(parts);
}

export function buildArtistProfile(artwork) {
  const parts = [];
  const bio = artwork.artistDisplayBio?.trim();
  const nationality = artwork.artistNationality?.trim();
  const lifespan = parseArtistLifespan(artwork);
  const role = artwork.artistRole?.trim();

  if (bio) {
    parts.push(bio);
  } else if (nationality && lifespan) {
    parts.push(`${nationality} artist, ${lifespan}`);
  } else if (nationality) {
    parts.push(`${nationality} artist`);
  }

  if (role && role !== 'Artist') {
    parts.push(role);
  }

  const deptLine = buildDepartmentArtistLine(artwork);
  if (deptLine) {
    parts.push(deptLine);
  }

  const careerLine = buildArtistCareerLine(artwork);
  if (careerLine) {
    parts.push(careerLine);
  }

  if (artwork.isHighlight) {
    parts.push('Represented among the Met\'s most celebrated holdings');
  }

  return joinSentences(parts);
}

function buildDepartmentArtistLine(artwork) {
  const department = artwork.department ?? '';
  if (department.includes('European Paintings')) {
    return 'A voice in the long conversation of Western painting';
  }
  if (department.includes('Asian Art')) {
    return 'Working within Asian pictorial and calligraphic traditions';
  }
  if (department.includes('Modern and Contemporary')) {
    return 'Part of the story of art in the modern age';
  }
  if (department.includes('American Art')) {
    return 'Shaping the visual culture of the United States';
  }
  return '';
}

function buildArtistCareerLine(artwork) {
  const year = parsePrimaryYear(artwork);
  const begin = Number(artwork.artistBeginDate);
  const end = Number(artwork.artistEndDate);

  if (year == null || !begin || !end) {
    return '';
  }

  const midpoint = begin + (end - begin) * 0.5;
  if (year < midpoint - 5) {
    return 'This painting comes from the earlier part of their career';
  }
  if (year > midpoint + 5) {
    return 'This painting comes from their mature or late period';
  }
  return 'This painting dates to the middle of their working life';
}

export function buildSubjectNarrative(artwork) {
  const tags = getTagTerms(artwork);
  if (!tags.length) {
    return 'Watch how the composition unfolds — figures, space, and color will emerge stroke by stroke.';
  }

  if (tags.length === 1) {
    return `The image centers on ${tags[0].toLowerCase()} — notice how it organizes the whole composition.`;
  }

  return `Look for ${formatTagList(tags.map((tag) => tag.toLowerCase()))} as the painting reveals itself.`;
}

export function buildTitleContext(artwork) {
  const title = artwork.title?.trim();
  if (!title) {
    return '';
  }

  const parts = [];
  const year = artwork.objectDate?.trim();

  if (year) {
    parts.push(`Known as "${title}", dated ${year}`);
  } else {
    parts.push(`Known as "${title}"`);
  }

  const tags = getTagTerms(artwork);
  if (tags.length) {
    parts.push(`Its subject touches on ${formatTagList(tags.map((tag) => tag.toLowerCase()))}`);
  }

  if (artwork.portfolio?.trim()) {
    parts.push(`Part of the series ${artwork.portfolio.trim()}`);
  }

  return joinSentences(parts);
}

export function buildWorkStory(artwork) {
  const catalog = getMetCatalogText(artwork);
  if (catalog) {
    return catalog;
  }

  const parts = [];
  const tags = getTagTerms(artwork);
  const title = artwork.title?.trim();
  const date = artwork.objectDate?.trim();
  const medium = artwork.medium?.trim();

  if (tags.length && title) {
    parts.push(
      `"${title}" brings together ${formatTagList(tags.map((tag) => tag.toLowerCase()))} — themes that guide the eye across the canvas.`,
    );
  } else if (tags.length) {
    parts.push(`This painting weaves together ${formatTagList(tags.map((tag) => tag.toLowerCase()))}.`);
  }

  if (date && medium) {
    parts.push(`Painted ${date} in ${medium.toLowerCase()}.`);
  } else if (date) {
    parts.push(`Created ${date}.`);
  } else if (medium) {
    parts.push(`Executed in ${medium.toLowerCase()}.`);
  }

  if (artwork.isHighlight) {
    parts.push('The Met highlights this work as a landmark of its collection.');
  }

  if (artwork.isTimelineWork) {
    parts.push('It appears on the Met\'s Heilbrunn Timeline of Art History — a signal of its art-historical importance.');
  }

  if (!parts.length && title) {
    parts.push(`"${title}" is one work in a collection that spans five thousand years of human creativity.`);
  }

  return joinSentences(parts);
}

export function buildScaleContext(artwork) {
  const parts = [];

  if (artwork.galleryNumber?.trim()) {
    parts.push(`You can find it in Gallery ${artwork.galleryNumber.trim()} at The Met Fifth Avenue`);
  }

  const height = artwork.measurements?.height;
  if (height != null && height > 150) {
    parts.push('A large-scale work meant to command the wall');
  } else if (height != null && height < 40) {
    parts.push('An intimate, small-scale piece — best seen up close');
  }

  if (!parts.length && artwork.repository?.trim()) {
    parts.push(artwork.repository.trim());
  }

  return joinSentences(parts);
}

export function buildCollectionHighlight(artwork) {
  const parts = [];

  if (artwork.isHighlight) {
    parts.push('One of the Met\'s signature highlights');
  }

  if (artwork.galleryNumber?.trim()) {
    parts.push(`Gallery ${artwork.galleryNumber.trim()}`);
  }

  if (artwork.accessionYear) {
    parts.push(`Joined the collection in ${artwork.accessionYear}`);
  }

  if (!parts.length && artwork.repository?.trim()) {
    return artwork.repository.trim();
  }

  return parts.join(' · ');
}

export function buildCollectionDetail(artwork) {
  const parts = [];

  if (artwork.isTimelineWork) {
    parts.push('Featured on the Met\'s Heilbrunn Timeline of Art History');
  }

  const credit = artwork.creditLine?.trim();
  if (credit) {
    parts.push(`How it entered the collection: ${credit}`);
  }

  if (artwork.objectURL?.trim()) {
    parts.push('Open the full catalog entry for provenance, related works, and high-resolution zoom');
  }

  return joinSentences(parts);
}
