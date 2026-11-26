/** Every color in the game (SPEC section 12). */
export const COLORS = {
  background: '#12161F',
  panel: '#1B2130',
  path: '#2A3347',
  text: '#E8ECF4',
  muted: '#9AA6BD',
  bolt: '#F4C95D',
  cannon: '#F2845C',
  frost: '#6EC5FF',
  beam: '#E06CF0',
  tesla: '#8C8CFF',
  enemy: '#E5566D',
  boss: '#FF2E55',
  gold: '#FFD66B',
  cores: '#57E0B5',
  success: '#6BD68A',
  /** The Warden uses the success green, so it stands apart from every tower. */
  warden: '#6BD68A',
} as const;

/** Shades for the drawn art (SPEC section 22): darker and lighter tones of the colors above, and the scenery. */
export const SHADES = {
  ground: '#161B26',
  meadow: '#13201C',
  meadowLight: '#162420',
  ruins: '#191B24',
  ruinsLight: '#1D2029',
  canyon: '#211A1B',
  canyonLight: '#261E1F',
  forest: '#0F1D17',
  forestLight: '#13221B',
  roadEdge: '#222A3B',
  roadLine: '#36415A',
  stone: '#3A4560',
  stoneLight: '#4E5B7A',
  leaf: '#2E6650',
  leafLight: '#3E8668',
  bark: '#4A3A30',
  crystal: '#34507E',
  boltDark: '#B8923A',
  cannonDark: '#B35E40',
  frostDark: '#3C88B8',
  beamDark: '#9E46AD',
  teslaDark: '#5C5CB8',
  wardenDark: '#3F8C58',
  enemyDark: '#A33A4D',
  enemyLight: '#F28A9B',
  bossDark: '#B01F3B',
} as const;

/** Every color the map is drawn with. */
export const ALL_COLORS = [...new Set([...Object.values(COLORS), ...Object.values(SHADES)])];
