/** Presentation only: retain series keys, original titles and meaningful disambiguators. */
export function folderTitle(value: string): string {
  let title = value.trim();
  const qualifiers: string[] = [];
  for (;;) {
    const match = /\s*[（(]([^()（）]*)[)）]\s*$/.exec(title);
    if (!match || !title.slice(0, match.index).trim()) break;
    title = title.slice(0, match.index).trim();
    const note = match[1].trim();
    const kind = note.toLowerCase().replace(/[\s·._-]+/g, '');
    if (!/^(系列|合集|电影系列|系列电影|电视剧系列|影视宇宙|collection|filmcollection|moviecollection|series|filmseries|movieseries|saga)$/.test(kind)
      && !/^(共)?\d+\s*部(作品|电影|剧集)?$/.test(note)
      && !/^\d+\s*(movies|films|seasons)$/i.test(note)) qualifiers.unshift(note);
  }
  return [title, ...qualifiers].filter(Boolean).join(' ');
}
