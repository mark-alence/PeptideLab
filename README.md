# PeptideLab

An interactive 3D amino acid and peptide builder that runs in your browser. Drag residues onto a grid, watch them form peptide bonds, and explore the molecular forces that drive protein folding.

![PeptideLab demo](demo.gif)

## Try It

**[Launch PeptideLab](https://mark-alence.github.io/PeptideLab/)** — nothing to install, works on desktop and mobile.

## Features

- **Drag-and-drop building** — pick from all 20 standard amino acids grouped by chemical property and place them on a 3D grid
- **Real atomic geometry** — atom positions sourced from the [PDB Chemical Component Dictionary](https://www.wwpdb.org/data/ccd), scaled and aligned per residue
- **Automatic peptide bonds** — adjacent residues link backbone C to N with proper bond geometry
- **Sidechain rotamers** — cycle through Dunbrack rotamer conformations with arrow keys
- **Water shells** — crystallographic hydration sites rendered around hydrophilic residues
- **20 preset lessons** covering key biochemistry concepts:

  | Lesson | Concept |
  |---|---|
  | Smallest vs Largest | Glycine vs tryptophan size comparison |
  | Disulfide Bridge | Cysteine S-S covalent cross-links |
  | Salt Bridge | Lysine-glutamate electrostatic pairing |
  | Hydrophobic Core | Nonpolar residue clustering |
  | Aromatic Stacking | Pi-pi interactions between ring systems |
  | Acid vs Amide | Asp/Asn and Glu/Gln functional group comparison |
  | Catalytic Triad | Ser-His-Asp charge relay in serine proteases |
  | Aliphatic Ladder | Hydrocarbon sidechain progression |
  | Branched-Chain AAs | Val, Leu, Ile structural comparison |
  | Phosphorylation Sites | Ser, Thr, Tyr as kinase targets |
  | Zinc Finger | Cys/His coordination motif |
  | Collagen Repeat | Gly-Pro-Hyp triple helix unit |
  | Proline the Breaker | Proline's rigid ring and helix disruption |
  | Methionine: Start | The universal start codon residue |
  | Charge Lineup | All charged residues at pH 7 |
  | Hydrogen Bond Donors | Polar residue H-bond network |
  | Sulfur Siblings | Cysteine vs methionine |
  | Hydrophilic Surface | Polar residues on protein surfaces |
  | Histidine the Switch | pH-dependent charge switching |
  | The Complete Set | All 20 amino acids at once |

- **Responsive design** — unified codebase for desktop and mobile with touch-optimized controls
- **Installable PWA** — works offline via service worker

## Controls

### Desktop
| Input | Action |
|---|---|
| Drag from palette | Place amino acid on grid |
| Right-click drag | Rotate camera |
| Scroll wheel | Zoom |
| Middle-click drag | Pan |
| Left/Right arrows | Cycle sidechain rotamers |
| Ctrl+Z | Undo last placement |
| Escape | Deselect |

### Mobile
| Input | Action |
|---|---|
| Tap palette, tap grid | Place amino acid |
| One-finger drag | Orbit camera |
| Two-finger pinch | Zoom |
| Two-finger drag | Pan |

## Running Locally

No build step required. Serve the files with any static server:

```bash
# Using the included dev server
node server.js
# → http://localhost:3000

# Or any static server
npx serve .
python3 -m http.server
```

## Tech Stack

- **Three.js** — WebGL rendering with CSS2D label overlays
- **React 18** — UI components (palette, info panel, lessons)
- **Vanilla ES modules** — no bundler, no build step, all dependencies via CDN

## License

MIT
