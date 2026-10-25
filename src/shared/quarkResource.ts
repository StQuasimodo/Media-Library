/** Filename/parent-directory hints, not measurements from a media stream. */
export interface QuarkResourceInfo {
  resolution: string | null;
  source: string | null;
  videoCodec: string | null;
  encoder: string | null;
  bitDepth: number | null;
  hdr: string[];
  audioCodecs: string[];
  audioChannels: string[];
  audioLanguages: string[];
  subtitles: string[];
  editions: string[];
  frameRate: string | null;
  bitRate: string | null;
  container: string | null;
}

export function resourceInfoLabels(info: Partial<QuarkResourceInfo>): string[] {
  return [...new Set([
    info.resolution, info.source, info.videoCodec, info.encoder,
    info.bitDepth ? `${info.bitDepth}-bit` : null,
    ...(info.hdr ?? []), ...(info.audioCodecs ?? []),
    ...(info.audioChannels ?? []).map(value=>`${value} 声道`),
    ...(info.audioLanguages ?? []), ...(info.subtitles ?? []),
    ...(info.editions ?? []), info.frameRate, info.bitRate, info.container,
  ].filter((value): value is string=>Boolean(value)))];
}
