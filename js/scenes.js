// ============================================================
// scenes.js — Preset educational scenes
// layout: array of rows, each row is array of letters (null = gap)
// Positions are computed automatically from structure bounding radii.
// ============================================================

export const SCENES = [
  {
    id: 'smallest-vs-largest',
    name: 'Smallest vs Largest',
    description: 'Glycine has just a hydrogen as its sidechain. Tryptophan has a massive double-ring indole. Place them side by side and the size difference is striking.',
    layout: [['G', 'W']],
  },
  {
    id: 'disulfide-bridge',
    name: 'Disulfide Bridge',
    description: 'Two cysteine residues with their thiol (-SH) sidechains can form a covalent disulfide bond (S-S) through oxidation. This cross-link is one of the strongest interactions in protein structure, often stabilizing tertiary and quaternary structure. Disulfide bridges are especially common in extracellular proteins where the oxidizing environment favors their formation.',
    layout: [['C', 'C']],
  },
  {
    id: 'salt-bridge',
    name: 'Salt Bridge',
    description: 'A salt bridge is an electrostatic interaction between oppositely charged sidechains, such as lysine (K, positively charged amine) and glutamate (E, negatively charged carboxylate). These ionic interactions contribute to protein stability by lowering the free energy of the folded state. Salt bridges are particularly important at protein surfaces and subunit interfaces.',
    layout: [['K', 'E']],
  },
  {
    id: 'hydrophobic-core',
    name: 'Hydrophobic Core',
    description: 'Nonpolar residues like valine, leucine, isoleucine, and phenylalanine cluster together in the interior of folded proteins to minimize contact with water. This hydrophobic effect is the primary driving force for protein folding, as burying hydrophobic sidechains releases ordered water molecules and increases entropy. The tightly packed core also provides structural stability through van der Waals interactions.',
    layout: [['V', 'L'], ['I', 'F']],
  },
  {
    id: 'aromatic-stacking',
    name: 'Aromatic Stacking',
    description: 'Aromatic residues (phenylalanine, tyrosine, tryptophan) contain ring systems with delocalized electrons that can interact through pi-pi stacking. These interactions involve favorable electrostatic and dispersion forces between the electron-rich aromatic clouds. Aromatic stacking contributes to protein stability and is especially important in protein-DNA recognition.',
    layout: [['F', 'Y', 'W']],
  },
  {
    id: 'acid-vs-amide',
    name: 'Acid vs Amide',
    description: 'Aspartate and asparagine differ by a single functional group: the charged carboxylate (-COO\u207b) of aspartate becomes the neutral amide (-CONH\u2082) of asparagine. Similarly, glutamate and glutamine are related by the same conversion. This single-atom difference dramatically changes the charge state and hydrogen bonding capacity.',
    layout: [['D', 'N', null, 'E', 'Q']],
  },
  {
    id: 'catalytic-triad',
    name: 'Catalytic Triad',
    description: 'The catalytic triad of serine proteases like chymotrypsin, where Asp-His-Ser residues form a charge relay system. Aspartate orients histidine, which activates serine\'s hydroxyl as a nucleophile to cleave peptide bonds. This elegant mechanism demonstrates how cooperative interactions amplify catalytic power.',
    layout: [['S', 'H'], [null, 'D']],
  },
  {
    id: 'aliphatic-ladder',
    name: 'Aliphatic Ladder',
    description: 'A progression of nonpolar aliphatic amino acids from smallest to largest sidechain. Glycine has only a hydrogen, alanine a methyl group, valine a branched isopropyl, leucine an isobutyl, and isoleucine a sec-butyl chain. This series shows how increasing hydrophobic bulk affects protein packing and stability.',
    layout: [['G', 'A', 'V', 'L', 'I']],
  },
  {
    id: 'branched-chain-aas',
    name: 'Branched-Chain AAs',
    description: 'The three branched-chain amino acids (BCAAs) are essential nutrients that must be obtained from diet. Valine, leucine, and isoleucine are particularly important for muscle protein synthesis and energy metabolism. They are unique in being metabolized primarily in muscle rather than the liver.',
    layout: [['V', 'L', 'I']],
  },
  {
    id: 'phosphorylation-sites',
    name: 'Phosphorylation Sites',
    description: 'Serine, threonine, and tyrosine are the only three amino acids whose hydroxyl groups can be phosphorylated by protein kinases. This reversible post-translational modification is a central regulatory mechanism in cell signaling, controlling everything from metabolism to cell division.',
    layout: [['S', 'T', 'Y']],
  },
  {
    id: 'zinc-finger',
    name: 'Zinc Finger',
    description: 'The Cys2His2 zinc finger is a DNA-binding motif where two cysteines and two histidines coordinate a zinc ion. This tetrahedral coordination creates a compact, stable fold that inserts an alpha helix into the DNA major groove. Zinc fingers are one of the most common motifs in eukaryotic transcription factors.',
    layout: [['C', 'C'], ['H', 'H']],
  },
  {
    id: 'collagen-repeat',
    name: 'Collagen Repeat',
    description: 'Collagen\'s structure relies on a Gly-X-Y triplet repeat where glycine appears at every third position. Only glycine is small enough to fit in the crowded interior of collagen\'s tight triple helix, while proline and other residues occupy the X and Y positions.',
    layout: [['G', 'P', 'A', 'G', 'P', 'A']],
  },
  {
    id: 'proline-the-breaker',
    name: 'Proline the Breaker',
    description: 'Proline is unique because its sidechain forms a five-membered ring that bonds back to the backbone nitrogen, creating a rigid structure. This cyclic constraint introduces a fixed kink in the polypeptide chain, disrupting regular secondary structures like alpha-helices and beta-sheets.',
    layout: [['A', 'A', 'P', 'A', 'A']],
  },
  {
    id: 'methionine-start',
    name: 'Methionine: Start',
    description: 'Methionine is encoded by the codon AUG, which serves as the universal start codon in protein synthesis. Every newly translated protein begins with methionine, though it is often removed post-translationally.',
    layout: [['M']],
  },
  {
    id: 'charge-lineup',
    name: 'Charge Lineup',
    description: 'These five amino acids have ionizable sidechains that carry charge at physiological pH. Aspartate and glutamate are negatively charged (acidic), lysine and arginine are positively charged (basic), and histidine can be either depending on local pH.',
    layout: [['D', 'E', 'H', 'K', 'R']],
  },
  {
    id: 'hydrogen-bond-donors',
    name: 'Hydrogen Bond Donors',
    description: 'These polar uncharged residues contain hydroxyl or amide groups that can both donate and accept hydrogen bonds. They are frequently found at protein surfaces and in active sites, where they mediate interactions with substrates, cofactors, and water molecules.',
    layout: [['S', 'T', 'N', 'Q', 'Y']],
  },
  {
    id: 'sulfur-siblings',
    name: 'Sulfur Siblings',
    description: 'Cysteine and methionine are the only two amino acids containing sulfur, but they use it in completely different ways. Cysteine\'s reactive thiol group (-SH) can form disulfide bonds that stabilize protein structure, while methionine\'s thioether group is flexible, hydrophobic, and often buried in protein cores.',
    layout: [['C', 'M']],
  },
  {
    id: 'identical-backbone',
    name: 'Identical Backbone',
    description: 'Every amino acid shares the exact same backbone structure: an amino group (N), alpha carbon (CA), carboxyl group (C), and oxygen (O). Only the sidechain differs. Three glycines make this obvious since glycine\'s sidechain is just a hydrogen atom \u2014 pure backbone with nothing added.',
    layout: [['G', 'G', 'G']],
  },
  {
    id: 'histidine-the-switch',
    name: 'Histidine the Switch',
    description: 'Histidine\'s imidazole ring has a pKa around 6.0, remarkably close to physiological pH. This makes it the only amino acid that can reversibly switch between protonated (charged) and deprotonated (neutral) states under normal cellular conditions, making it indispensable in enzyme active sites.',
    layout: [['H']],
  },
  {
    id: 'the-complete-set',
    name: 'The Complete Set',
    description: 'These 20 amino acids are the complete alphabet of life \u2014 every protein in every organism is built from just this set. Arranged by chemical properties: small/nonpolar (top), larger hydrophobic (second row), polar uncharged (third), and charged (bottom). Twenty letters, infinite possibilities.',
    layout: [
      ['G', 'A', 'V', 'P', 'F'],
      ['L', 'I', 'M', 'W', 'C'],
      ['S', 'T', 'N', 'Q', 'Y'],
      ['D', 'E', 'H', 'K', 'R'],
    ],
  },
];
