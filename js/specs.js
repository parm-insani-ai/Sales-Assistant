// Built-in spec library for feature-by-feature comparisons — the Nissan lineup
// and its most common cross-shops, Canadian market, 2026 model year. Values
// are approximate (MSRPs move, trims differ) and every rendering of them
// carries a "verify current specs" disclaimer; they exist to frame the
// conversation, not to be a contract.
//
// 2026 notes baked in: Sentra is the new generation, Rogue adds a Plug-in
// Hybrid, the Leaf is the all-new crossover EV, Altima ended after 2025 (so
// it's not listed), and Toyota's RAV4 is all-new and hybrid-only.
//
// Fields: msrp (CAD, from), engine, hp, fuel (combined L/100km), drive,
// seats, cargo (litres behind rear seats), tow (lb), warranty, features.

export const SPEC_LIBRARY = [
  // --- Nissan ---
  { id: "kicks26", make: "Nissan", label: "2026 Nissan Kicks", msrp: 28000, engine: "2.0L 4-cyl", hp: 141, fuel: 7.7, drive: "FWD (AWD avail.)", seats: 5, cargo: 850, tow: null, warranty: "3 yr/60,000 km (5/100 powertrain)", features: "Safety Shield 360, dual 12.3\" displays, wireless CarPlay" },
  { id: "sentra26", make: "Nissan", label: "2026 Nissan Sentra", msrp: 25000, engine: "2.0L 4-cyl", hp: 149, fuel: 7.0, drive: "FWD", seats: 5, cargo: 405, tow: null, warranty: "3 yr/60,000 km (5/100 powertrain)", features: "All-new generation, Safety Shield 360, big dual displays" },
  { id: "rogue26", make: "Nissan", label: "2026 Nissan Rogue", msrp: 35000, engine: "1.5L VC-Turbo", hp: 201, fuel: 7.3, drive: "AWD avail.", seats: 5, cargo: 1030, tow: 1350, warranty: "3 yr/60,000 km (5/100 powertrain)", features: "ProPILOT Assist, Google built-in, Safety Shield 360" },
  { id: "roguephev26", make: "Nissan", label: "2026 Nissan Rogue Plug-in Hybrid", msrp: 46000, engine: "2.4L PHEV", hp: 248, fuel: 3.3, drive: "AWD standard", seats: 5, cargo: 950, tow: 1500, warranty: "3 yr/60,000 km (8/160 battery)", features: "~60 km electric range, AWD standard" },
  { id: "murano26", make: "Nissan", label: "2026 Nissan Murano", msrp: 44000, engine: "2.0L VC-Turbo", hp: 241, fuel: 9.5, drive: "AWD", seats: 5, cargo: 900, tow: 1500, warranty: "3 yr/60,000 km (5/100 powertrain)", features: "Premium interior, massaging seats avail." },
  { id: "pathfinder26", make: "Nissan", label: "2026 Nissan Pathfinder", msrp: 48000, engine: "3.5L V6", hp: 284, fuel: 10.2, drive: "4WD", seats: 8, cargo: 470, tow: 6000, warranty: "3 yr/60,000 km (5/100 powertrain)", features: "Refreshed for 2026, 6,000 lb towing, 8 seats" },
  { id: "frontier26", make: "Nissan", label: "2026 Nissan Frontier", msrp: 45000, engine: "3.8L V6", hp: 310, fuel: 11.6, drive: "4x4", seats: 5, cargo: null, tow: 6720, warranty: "3 yr/60,000 km (5/100 powertrain)", features: "310 hp standard V6, 6,720 lb towing" },
  { id: "leaf26", make: "Nissan", label: "2026 Nissan Leaf (EV)", msrp: 42000, engine: "Electric", hp: 214, fuel: 2.0, drive: "FWD", seats: 5, cargo: 668, tow: null, warranty: "3 yr/60,000 km (8/160 battery)", features: "All-new crossover design, up to ~488 km range, NACS port" },
  { id: "ariya26", make: "Nissan", label: "2026 Nissan Ariya (EV)", msrp: 48000, engine: "Electric (single/dual motor)", hp: 389, fuel: 2.2, drive: "AWD avail. (e-4ORCE)", seats: 5, cargo: 646, tow: null, warranty: "3 yr/60,000 km (8/160 battery)", features: "Up to ~465 km range, e-4ORCE AWD" },

  // --- Compact SUVs (Rogue cross-shops) ---
  { id: "rav426", make: "Toyota", label: "2026 Toyota RAV4", msrp: 38000, engine: "2.5L hybrid (hybrid-only lineup)", hp: 236, fuel: 5.8, drive: "AWD avail.", seats: 5, cargo: 1059, tow: 1750, warranty: "3 yr/60,000 km (5/100 powertrain)", features: "All-new generation, hybrid only, TSS 4.0" },
  { id: "crv26", make: "Honda", label: "2026 Honda CR-V", msrp: 39000, engine: "1.5L turbo (hybrid avail.)", hp: 190, fuel: 7.9, drive: "AWD", seats: 5, cargo: 1113, tow: 1500, warranty: "3 yr/60,000 km (5/100 powertrain)", features: "Honda Sensing" },
  { id: "tucson26", make: "Hyundai", label: "2026 Hyundai Tucson", msrp: 34000, engine: "2.5L 4-cyl", hp: 187, fuel: 8.1, drive: "AWD avail.", seats: 5, cargo: 1095, tow: 2000, warranty: "5 yr/100,000 km comprehensive", features: "SmartSense, 5-yr warranty" },
  { id: "cx526", make: "Mazda", label: "2026 Mazda CX-5", msrp: 35000, engine: "2.5L 4-cyl", hp: 187, fuel: 8.8, drive: "AWD standard", seats: 5, cargo: 900, tow: 2000, warranty: "3 yr unlimited km (5 unlimited powertrain)", features: "All-new generation, standard AWD, bigger cabin" },
  { id: "equinox26", make: "Chevrolet", label: "2026 Chevrolet Equinox", msrp: 34000, engine: "1.5L turbo", hp: 175, fuel: 8.3, drive: "AWD avail.", seats: 5, cargo: 845, tow: 1500, warranty: "3 yr/60,000 km (5/100 powertrain)", features: "Chevy Safety Assist" },

  // --- Compact cars (Sentra cross-shops) ---
  { id: "corolla26", make: "Toyota", label: "2026 Toyota Corolla", msrp: 26000, engine: "2.0L 4-cyl", hp: 169, fuel: 6.7, drive: "FWD", seats: 5, cargo: 371, tow: null, warranty: "3 yr/60,000 km (5/100 powertrain)", features: "Toyota Safety Sense 3.0" },
  { id: "civic26", make: "Honda", label: "2026 Honda Civic", msrp: 29000, engine: "2.0L 4-cyl (hybrid avail.)", hp: 150, fuel: 7.0, drive: "FWD", seats: 5, cargo: 419, tow: null, warranty: "3 yr/60,000 km (5/100 powertrain)", features: "Honda Sensing" },
  { id: "elantra26", make: "Hyundai", label: "2026 Hyundai Elantra", msrp: 25000, engine: "2.0L 4-cyl", hp: 147, fuel: 6.8, drive: "FWD", seats: 5, cargo: 402, tow: null, warranty: "5 yr/100,000 km comprehensive", features: "SmartSense, 5-yr warranty" },
  { id: "mazda326", make: "Mazda", label: "2026 Mazda3", msrp: 27000, engine: "2.5L 4-cyl", hp: 191, fuel: 7.9, drive: "FWD (AWD avail.)", seats: 5, cargo: 374, tow: null, warranty: "3 yr unlimited km (5 unlimited powertrain)", features: "Upscale cabin, AWD available" },

  // --- Subcompact SUVs (Kicks cross-shops) ---
  { id: "hrv26", make: "Honda", label: "2026 Honda HR-V", msrp: 32000, engine: "2.0L 4-cyl", hp: 158, fuel: 8.0, drive: "AWD avail.", seats: 5, cargo: 691, tow: null, warranty: "3 yr/60,000 km (5/100 powertrain)", features: "Honda Sensing" },
  { id: "kona26", make: "Hyundai", label: "2026 Hyundai Kona", msrp: 28000, engine: "2.0L 4-cyl", hp: 147, fuel: 7.4, drive: "AWD avail.", seats: 5, cargo: 723, tow: null, warranty: "5 yr/100,000 km comprehensive", features: "SmartSense, 5-yr warranty" },

  // --- 3-row SUVs (Pathfinder cross-shops) ---
  { id: "highlander26", make: "Toyota", label: "2026 Toyota Highlander", msrp: 49000, engine: "2.4L turbo", hp: 265, fuel: 9.8, drive: "AWD", seats: 8, cargo: 456, tow: 5000, warranty: "3 yr/60,000 km (5/100 powertrain)", features: "Toyota Safety Sense 2.5+" },
  { id: "pilot26", make: "Honda", label: "2026 Honda Pilot", msrp: 52000, engine: "3.5L V6", hp: 285, fuel: 11.0, drive: "AWD", seats: 8, cargo: 527, tow: 5000, warranty: "3 yr/60,000 km (5/100 powertrain)", features: "Honda Sensing" },

  // --- Midsize trucks (Frontier cross-shops) ---
  { id: "tacoma26", make: "Toyota", label: "2026 Toyota Tacoma", msrp: 47000, engine: "2.4L turbo", hp: 278, fuel: 10.5, drive: "4x4", seats: 5, cargo: null, tow: 6500, warranty: "3 yr/60,000 km (5/100 powertrain)", features: "Toyota Safety Sense 3.0" },
];

export const SPEC_DISCLAIMER = "2026 model year, base trims, Canadian market — specs and pricing are approximate; confirm current details at the dealership.";
