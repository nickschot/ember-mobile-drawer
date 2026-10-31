import type { SnapPoint } from '#src/index.ts';

export type ParseResult =
  | { snapPoints: SnapPoint[]; error?: undefined }
  | { snapPoints?: undefined; error: string };

/** More would not fit on a phone, and is likely a typo. */
const MAX_SNAP_POINTS = 8;
/** Larger px values are almost certainly a typo. */
const MAX_PX = 10000;

const NUMBER = /^\d+(?:\.\d+)?$/;

/**
 * Parses snap points typed into the playground, e.g. `0, 120, 'content', '90%'`
 * or `[0, "50%", "100%"]`. Only accepts what `<MobileDrawer>` accepts, so a
 * typo shows a message instead of throwing while the drawer renders:
 * non-negative px numbers (an optional `px` suffix is allowed), percentages
 * from `0%` to `100%`, and `content`. Quotes and surrounding brackets are
 * optional. Nothing is evaluated.
 */
export function parseSnapPoints(text: string): ParseResult {
  let body = text.trim();
  if (body.startsWith('[') && body.endsWith(']')) body = body.slice(1, -1);
  const tokens = body.split(',').map((token) => token.trim());
  if (tokens.length === 1 && tokens[0] === '') {
    return { error: 'Enter at least one snap point.' };
  }
  if (tokens.length > MAX_SNAP_POINTS) {
    return { error: `Use at most ${MAX_SNAP_POINTS} snap points.` };
  }

  const snapPoints: SnapPoint[] = [];
  for (const raw of tokens) {
    const token = raw.replace(/^(['"])(.*)\1$/, '$2').trim();
    if (token === 'content') {
      snapPoints.push('content');
    } else if (token.endsWith('%') && NUMBER.test(token.slice(0, -1))) {
      const percentage = Number(token.slice(0, -1));
      if (percentage > 100) {
        return { error: `${raw}: percentages go up to 100%.` };
      }
      snapPoints.push(`${percentage}%`);
    } else if (NUMBER.test(token.replace(/px$/, ''))) {
      const px = Number(token.replace(/px$/, ''));
      if (px > MAX_PX) return { error: `${raw}: use at most ${MAX_PX}px.` };
      snapPoints.push(px);
    } else {
      return {
        error: `${raw === '' ? 'An empty entry' : raw}: use px (120), a percentage ('50%') or 'content'.`,
      };
    }
  }
  return { snapPoints };
}

/** Formats snap points the way they are written in a template or JS. */
export function formatSnapPoints(snapPoints: readonly SnapPoint[]): string {
  return snapPoints
    .map((snapPoint) =>
      typeof snapPoint === 'number' ? String(snapPoint) : `'${snapPoint}'`,
    )
    .join(', ');
}
