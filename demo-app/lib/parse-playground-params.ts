import { springPresets, type Placement, type SnapPoint } from '#src/index.ts';
import { formatSnapPoints, parseSnapPoints } from './parse-snap-points.ts';

export const PLACEMENTS: Placement[] = ['bottom', 'top', 'left', 'right'];

export const SNAP_POINT_PRESETS: { label: string; snapPoints: SnapPoint[] }[] =
  [
    { label: "0, '50%', '100%'", snapPoints: [0, '50%', '100%'] },
    { label: "0, 'content'", snapPoints: [0, 'content'] },
    {
      label: "0, 120, 'content', '90%'",
      snapPoints: [0, 120, 'content', '90%'],
    },
  ];

/** The names of `springPresets`, for the playground's Spring control. */
export type SpringPresetName = keyof typeof springPresets;

export const SPRING_PRESETS: { name: SpringPresetName; label: string }[] = [
  { name: 'default', label: 'Default' },
  { name: 'ios', label: 'iOS (smooth)' },
  { name: 'iosSnappy', label: 'iOS snappy' },
  { name: 'iosBouncy', label: 'iOS bouncy' },
];

export const isSpringPresetName = (value: unknown): value is SpringPresetName =>
  SPRING_PRESETS.some((preset) => preset.name === value);

/** The `preset` value of snap points that match none of the presets. */
export const CUSTOM = -1;

/** Default of `--mobile-drawer-backdrop-opacity` in the base styles. */
export const DEFAULT_BACKDROP_OPACITY = 0.4;

export const isPlacement = (value: unknown): value is Placement =>
  PLACEMENTS.includes(value as Placement);

export interface PlaygroundState {
  placement: Placement;
  preset: number;
  snapPoints: SnapPoint[];
  snapPointsText: string;
  snapPointsError: string | undefined;
  active: number;
  handleOnly: boolean;
  tall: boolean;
  backdropOpacity: number;
  spring: SpringPresetName;
}

/**
 * The playground's initial state from the URL's query string, e.g.
 * `?placement=left&preset=0&snap=1&handle=1&tall=1` or
 * `?points=0,200,'content'&snap=2&backdrop=0.6&spring=ios`. Pure: it reads nothing from
 * the component, so the component can assign every field once. Invalid or
 * missing values fall back to the defaults.
 *
 * - `points` wins over `preset`; if it doesn't parse, the error is kept (so
 *   it shows under the field) and the preset's snap points are used.
 * - `snap` must be an integer index into the snap points; `1.5` is rejected
 *   (not rounded).
 * - `backdrop` must be a number from 0 to 1; an empty value is the default.
 * - `spring` is the name of a spring preset (`ios`, `iosSnappy`, ...).
 */
export function parsePlaygroundParams(search: string): PlaygroundState {
  const params = new URLSearchParams(search);

  const placementParam = params.get('placement');
  const placement = isPlacement(placementParam) ? placementParam : 'bottom';

  let preset = 0;
  const presetParam = params.get('preset');
  if (presetParam !== null && presetParam !== '') {
    const number = Number(presetParam);
    if (SNAP_POINT_PRESETS[number]) preset = number;
  }
  let snapPoints = SNAP_POINT_PRESETS[preset]!.snapPoints;
  let snapPointsText = formatSnapPoints(snapPoints);
  let snapPointsError: string | undefined;

  const pointsParam = params.get('points');
  if (pointsParam !== null) {
    snapPointsText = pointsParam;
    const result = parseSnapPoints(pointsParam);
    if (result.error !== undefined) {
      snapPointsError = result.error;
    } else {
      snapPoints = result.snapPoints;
      const formatted = formatSnapPoints(snapPoints);
      preset = SNAP_POINT_PRESETS.findIndex(
        (candidate) => formatSnapPoints(candidate.snapPoints) === formatted,
      );
    }
  }

  let active = 0;
  const snapParam = params.get('snap');
  if (snapParam !== null && snapParam.trim() !== '') {
    const number = Number(snapParam);
    if (Number.isInteger(number) && number >= 0 && number < snapPoints.length) {
      active = number;
    }
  }

  let backdropOpacity = DEFAULT_BACKDROP_OPACITY;
  const backdropParam = params.get('backdrop');
  if (backdropParam !== null && backdropParam.trim() !== '') {
    const number = Number(backdropParam);
    if (number >= 0 && number <= 1) backdropOpacity = number;
  }

  const springParam = params.get('spring');
  const spring = isSpringPresetName(springParam) ? springParam : 'default';

  return {
    placement,
    preset,
    snapPoints,
    snapPointsText,
    snapPointsError,
    active,
    handleOnly: params.get('handle') === '1',
    tall: params.get('tall') === '1',
    backdropOpacity,
    spring,
  };
}
