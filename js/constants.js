// ============================================================
// constants.js — Grid + biome definitions for sandbox builder
// ============================================================

// --- Tick ---
export const TICK_RATE = 1 / 60;

// --- Grid ---
export const GRID_COLS = 20;
export const GRID_ROWS = 20;
export const CELL_SIZE = 3;           // 3D units per cell
export const GRID_W = GRID_COLS * CELL_SIZE;
export const GRID_H = GRID_ROWS * CELL_SIZE;

// --- Biome categories ---
export const CAT = {
  POSITIVE:    'positive',
  NEGATIVE:    'negative',
  HYDROPHOBIC: 'hydrophobic',
  AROMATIC:    'aromatic',
  POLAR:       'polar',
  SPECIAL:     'special',
};

export const CAT_COLORS = {
  [CAT.POSITIVE]:    '#5599ff',
  [CAT.NEGATIVE]:    '#ff5566',
  [CAT.HYDROPHOBIC]: '#88aa44',
  [CAT.AROMATIC]:    '#cc77dd',
  [CAT.POLAR]:       '#44ccaa',
  [CAT.SPECIAL]:     '#ddaa33',
};

// --- Station order (simplest → most complex, by molecular weight) ---
export const STATION_ORDER = [
  'G','A','S','P','V','T','C','L','I','N','D','Q','K','E','M','H','F','R','Y','W',
];

// --- 20 Amino Acid Biomes ---
export const BIOMES = [
  // ---- Row 0: Charged ----
  {
    name: 'Arginine', letter: 'R', code3: 'Arg', category: CAT.POSITIVE,
    x: 100, y: 90, radius: 60,
    ground: ['#3366aa', '#2a5a9e', '#3d72b8'],
    accent: '#5599ff',
    decorations: ['crystal', 'geyser'],
    particleType: 'electric',
    particleColor: '#88bbff',
    description: 'A windswept plateau crackling with positive charge. Guanidinium crystals hum with distributed resonance.',
    properties: { charge: '+1', pI: '10.76', mw: '174.2', hydropathy: '-4.5' },
    codons: ['CGU', 'CGC', 'CGA', 'CGG', 'AGA', 'AGG'],
    oneLiner: 'The most positive — its guanidinium group stays charged at almost any pH.',
  },
  {
    name: 'Lysine', letter: 'K', code3: 'Lys', category: CAT.POSITIVE,
    x: 240, y: 90, radius: 60,
    ground: ['#2255aa', '#1e4d9a', '#2960b4'],
    accent: '#4488ee',
    decorations: ['crystal', 'pillar'],
    particleType: 'electric',
    particleColor: '#6699ee',
    description: 'Tall amino pillars reach skyward, their tips sparking with charge. The long flexible chain sways in the breeze.',
    properties: { charge: '+1', pI: '9.74', mw: '146.2', hydropathy: '-3.9' },
    codons: ['AAA', 'AAG'],
    oneLiner: 'A long flexible arm ending in a positive charge — nature\'s tether.',
  },
  {
    name: 'Histidine', letter: 'H', code3: 'His', category: CAT.POSITIVE,
    x: 380, y: 90, radius: 60,
    ground: ['#445588', '#3d4e7e', '#4c5f96'],
    accent: '#7788bb',
    decorations: ['crystal', 'pool'],
    particleType: 'sparkle',
    particleColor: '#99aadd',
    description: 'A twilight zone flickering between states. The imidazole pools shift color as pH drifts near 6.',
    properties: { charge: '+0.1 (pH 7)', pI: '7.59', mw: '155.2', hydropathy: '-3.2' },
    codons: ['CAU', 'CAC'],
    oneLiner: 'The pH switch — protonated or not right at physiological pH.',
  },
  {
    name: 'Aspartate', letter: 'D', code3: 'Asp', category: CAT.NEGATIVE,
    x: 520, y: 90, radius: 60,
    ground: ['#993344', '#8a2d3d', '#a63b4e'],
    accent: '#ff5566',
    decorations: ['pool', 'rock'],
    particleType: 'rain',
    particleColor: '#ff8899',
    description: 'Acidic rain pools collect in shallow depressions. The short side chain keeps things compact and intense.',
    properties: { charge: '-1', pI: '2.77', mw: '133.1', hydropathy: '-3.5' },
    codons: ['GAU', 'GAC'],
    oneLiner: 'Short and sour — a compact negative charge close to the backbone.',
  },
  {
    name: 'Glutamate', letter: 'E', code3: 'Glu', category: CAT.NEGATIVE,
    x: 660, y: 90, radius: 60,
    ground: ['#884433', '#7c3d2e', '#954d3b'],
    accent: '#ee6644',
    decorations: ['pool', 'rock'],
    particleType: 'rain',
    particleColor: '#ffaa88',
    description: 'Wider acid lakes with a longer reach. Glutamate stretches further than aspartate, tasting like umami.',
    properties: { charge: '-1', pI: '3.22', mw: '147.1', hydropathy: '-3.5' },
    codons: ['GAA', 'GAG'],
    oneLiner: 'The flavor of umami — a negative charge on a longer leash.',
  },

  // ---- Row 1: Aromatic + Special ----
  {
    name: 'Tryptophan', letter: 'W', code3: 'Trp', category: CAT.AROMATIC,
    x: 100, y: 230, radius: 60,
    ground: ['#332255', '#2d1e4d', '#3b285f'],
    accent: '#8844bb',
    decorations: ['tree', 'mushroom'],
    particleType: 'spore',
    particleColor: '#aa66dd',
    description: 'The rarest amino acid\'s domain — a deep violet forest. Indole rings glow faintly in the dark canopy.',
    properties: { charge: '0', pI: '5.89', mw: '204.2', hydropathy: '-0.9' },
    codons: ['UGG'],
    oneLiner: 'The biggest and rarest — its indole ring absorbs UV and glows.',
  },
  {
    name: 'Tyrosine', letter: 'Y', code3: 'Tyr', category: CAT.AROMATIC,
    x: 240, y: 230, radius: 60,
    ground: ['#554466', '#4d3e5e', '#5e4c72'],
    accent: '#aa77cc',
    decorations: ['tree', 'pool'],
    particleType: 'spore',
    particleColor: '#cc99ee',
    description: 'A lavender grove with reflecting pools. The phenol hydroxyl makes tyrosine polar enough to sit at surfaces.',
    properties: { charge: '0', pI: '5.66', mw: '181.2', hydropathy: '-1.3' },
    codons: ['UAU', 'UAC'],
    oneLiner: 'Aromatic with a hydroxyl twist — phosphorylation\'s favorite target.',
  },
  {
    name: 'Phenylalanine', letter: 'F', code3: 'Phe', category: CAT.AROMATIC,
    x: 380, y: 230, radius: 60,
    ground: ['#443355', '#3d2e4d', '#4c3a5f'],
    accent: '#9966bb',
    decorations: ['tree', 'rock'],
    particleType: 'float',
    particleColor: '#bb88dd',
    description: 'Dense aromatic thickets. Benzene rings stack in the shadows, repelling water with quiet hydrophobic force.',
    properties: { charge: '0', pI: '5.48', mw: '165.2', hydropathy: '2.8' },
    codons: ['UUU', 'UUC'],
    oneLiner: 'Pure hydrophobic aromatic — a benzene ring on a stick.',
  },
  {
    name: 'Glycine', letter: 'G', code3: 'Gly', category: CAT.SPECIAL,
    x: 520, y: 230, radius: 60,
    ground: ['#aaaaaa', '#9e9e9e', '#b5b5b5'],
    accent: '#cccccc',
    decorations: ['pebble'],
    particleType: 'mist',
    particleColor: '#dddddd',
    description: 'A vast open plain with nothing but sky. No side chain at all — glycine is pure flexibility.',
    properties: { charge: '0', pI: '5.97', mw: '75.0', hydropathy: '-0.4' },
    codons: ['GGU', 'GGC', 'GGA', 'GGG'],
    oneLiner: 'The smallest — no side chain, maximum backbone flexibility.',
  },
  {
    name: 'Proline', letter: 'P', code3: 'Pro', category: CAT.SPECIAL,
    x: 660, y: 230, radius: 60,
    ground: ['#887744', '#7c6d3d', '#96834c'],
    accent: '#bbaa66',
    decorations: ['ring', 'rock'],
    particleType: 'mist',
    particleColor: '#ccbb88',
    description: 'Constrained canyon paths loop back on themselves. Proline\'s ring locks the backbone into a kink.',
    properties: { charge: '0', pI: '6.30', mw: '115.1', hydropathy: '-1.6' },
    codons: ['CCU', 'CCC', 'CCA', 'CCG'],
    oneLiner: 'The helix breaker — its cyclic ring forces a kink in the backbone.',
  },

  // ---- Row 2: Polar + Cysteine ----
  {
    name: 'Serine', letter: 'S', code3: 'Ser', category: CAT.POLAR,
    x: 100, y: 370, radius: 60,
    ground: ['#338877', '#2e7c6d', '#3b9683'],
    accent: '#55bbaa',
    decorations: ['pool', 'grass'],
    particleType: 'bubble',
    particleColor: '#77ddcc',
    description: 'Gentle springs and streams. Serine\'s hydroxyl group hydrogen-bonds with water and neighbors alike.',
    properties: { charge: '0', pI: '5.68', mw: '105.1', hydropathy: '-0.8' },
    codons: ['UCU', 'UCC', 'UCA', 'UCG', 'AGU', 'AGC'],
    oneLiner: 'Small and polar — a hydrogen-bonding hydroxyl, phosphorylation site.',
  },
  {
    name: 'Threonine', letter: 'T', code3: 'Thr', category: CAT.POLAR,
    x: 240, y: 370, radius: 60,
    ground: ['#2a7766', '#266d5e', '#308370'],
    accent: '#44aa99',
    decorations: ['pool', 'bush'],
    particleType: 'bubble',
    particleColor: '#66ccbb',
    description: 'Terraced pools cascade down hillsides. Like serine but with an extra methyl — beta-branched and polar.',
    properties: { charge: '0', pI: '5.60', mw: '119.1', hydropathy: '-0.7' },
    codons: ['ACU', 'ACC', 'ACA', 'ACG'],
    oneLiner: 'Serine\'s bulkier sibling — beta-branched with a hydroxyl.',
  },
  {
    name: 'Asparagine', letter: 'N', code3: 'Asn', category: CAT.POLAR,
    x: 380, y: 370, radius: 60,
    ground: ['#337766', '#2e6d5e', '#3b8370'],
    accent: '#55aa88',
    decorations: ['pool', 'pebble'],
    particleType: 'bubble',
    particleColor: '#77cc99',
    description: 'Misty wetlands with sugar-decorated stones. Asparagine is the primary site for N-linked glycosylation.',
    properties: { charge: '0', pI: '5.41', mw: '132.1', hydropathy: '-3.5' },
    codons: ['AAU', 'AAC'],
    oneLiner: 'The sugar hook — N-linked glycosylation happens here.',
  },
  {
    name: 'Glutamine', letter: 'Q', code3: 'Gln', category: CAT.POLAR,
    x: 520, y: 370, radius: 60,
    ground: ['#2a6655', '#266050', '#30725e'],
    accent: '#44aa77',
    decorations: ['pool', 'grass'],
    particleType: 'bubble',
    particleColor: '#66cc88',
    description: 'Expansive marshlands. Glutamine\'s longer arm reaches further for hydrogen bonds and nitrogen transport.',
    properties: { charge: '0', pI: '5.65', mw: '146.1', hydropathy: '-3.5' },
    codons: ['CAA', 'CAG'],
    oneLiner: 'Nitrogen shuttle — amide group carries and donates nitrogen.',
  },
  {
    name: 'Cysteine', letter: 'C', code3: 'Cys', category: CAT.SPECIAL,
    x: 660, y: 370, radius: 60,
    ground: ['#888833', '#7c7c2e', '#96963b'],
    accent: '#bbbb44',
    decorations: ['bridge', 'crystal'],
    particleType: 'sparkle',
    particleColor: '#dddd66',
    description: 'Sulfur bridges span deep ravines. Disulfide bonds crosslink here, stabilizing distant parts of proteins.',
    properties: { charge: '0', pI: '5.07', mw: '121.2', hydropathy: '2.5' },
    codons: ['UGU', 'UGC'],
    oneLiner: 'The bridge builder — disulfide bonds link distant cysteines together.',
  },

  // ---- Row 3: Hydrophobic + Methionine ----
  {
    name: 'Alanine', letter: 'A', code3: 'Ala', category: CAT.HYDROPHOBIC,
    x: 100, y: 510, radius: 60,
    ground: ['#556633', '#4d5e2e', '#5f6f3a'],
    accent: '#88aa44',
    decorations: ['grass', 'rock'],
    particleType: 'float',
    particleColor: '#aabb66',
    description: 'Simple rolling grasslands. Just a methyl group — the most basic hydrophobic side chain.',
    properties: { charge: '0', pI: '6.00', mw: '89.1', hydropathy: '1.8' },
    codons: ['GCU', 'GCC', 'GCA', 'GCG'],
    oneLiner: 'The simplest — just a methyl group. The vanilla of amino acids.',
  },
  {
    name: 'Valine', letter: 'V', code3: 'Val', category: CAT.HYDROPHOBIC,
    x: 240, y: 510, radius: 60,
    ground: ['#556622', '#4d5e1e', '#607028'],
    accent: '#779933',
    decorations: ['rock', 'bush'],
    particleType: 'float',
    particleColor: '#99aa44',
    description: 'Forked paths through dense brush. Valine\'s branched chain fills space efficiently in protein cores.',
    properties: { charge: '0', pI: '5.96', mw: '117.1', hydropathy: '4.2' },
    codons: ['GUU', 'GUC', 'GUA', 'GUG'],
    oneLiner: 'Beta-branched and bulky — loves the hydrophobic core.',
  },
  {
    name: 'Leucine', letter: 'L', code3: 'Leu', category: CAT.HYDROPHOBIC,
    x: 380, y: 510, radius: 60,
    ground: ['#445511', '#3d4e0e', '#4e5f18'],
    accent: '#668822',
    decorations: ['bush', 'rock'],
    particleType: 'float',
    particleColor: '#88aa33',
    description: 'Thick waxy foliage. The most common amino acid — leucine zippers hold proteins together.',
    properties: { charge: '0', pI: '5.98', mw: '131.2', hydropathy: '3.8' },
    codons: ['UUA', 'UUG', 'CUU', 'CUC', 'CUA', 'CUG'],
    oneLiner: 'The most abundant — forms leucine zippers and fills hydrophobic cores.',
  },
  {
    name: 'Isoleucine', letter: 'I', code3: 'Ile', category: CAT.HYDROPHOBIC,
    x: 520, y: 510, radius: 60,
    ground: ['#4a5a11', '#43520e', '#536418'],
    accent: '#6e8822',
    decorations: ['rock', 'bush'],
    particleType: 'float',
    particleColor: '#8ea833',
    description: 'Rugged terrain with branching canyons. An isomer of leucine with its branch in a different spot.',
    properties: { charge: '0', pI: '6.02', mw: '131.2', hydropathy: '4.5' },
    codons: ['AUU', 'AUC', 'AUA'],
    oneLiner: 'Leucine\'s isomer — same atoms, different branch point, highest hydropathy.',
  },
  {
    name: 'Methionine', letter: 'M', code3: 'Met', category: CAT.SPECIAL,
    x: 660, y: 510, radius: 60,
    ground: ['#aa8822', '#9c7c1e', '#b89428'],
    accent: '#ddaa33',
    decorations: ['gate', 'crystal'],
    particleType: 'ember',
    particleColor: '#ffcc44',
    description: 'The Golden Gate — where all proteins begin. Sulfur-laced amber fields glow with the warmth of initiation.',
    properties: { charge: '0', pI: '5.74', mw: '149.2', hydropathy: '1.9' },
    codons: ['AUG'],
    oneLiner: 'The start codon — every protein begins here. Contains sulfur.',
  },
];

// Build lookup helpers
export const BIOME_BY_LETTER = {};
BIOMES.forEach(b => { BIOME_BY_LETTER[b.letter] = b; });

// --- Category groups for palette display ---
export const CATEGORIES = [
  { key: CAT.HYDROPHOBIC, label: 'Hydrophobic' },
  { key: CAT.AROMATIC,    label: 'Aromatic' },
  { key: CAT.POLAR,       label: 'Polar' },
  { key: CAT.POSITIVE,    label: 'Positive' },
  { key: CAT.NEGATIVE,    label: 'Negative' },
  { key: CAT.SPECIAL,     label: 'Special' },
];

export const BIOMES_BY_CATEGORY = {};
for (const cat of CATEGORIES) {
  BIOMES_BY_CATEGORY[cat.key] = BIOMES.filter(b => b.category === cat.key);
}
