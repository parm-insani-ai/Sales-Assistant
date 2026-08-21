// Built-in spec library for feature-by-feature comparisons — the Nissan lineup
// and its most common cross-shops, Canadian market, 2025 model year. Values
// are approximate (MSRPs move, trims differ) and every rendering of them
// carries a "verify current specs" disclaimer; they exist to frame the
// conversation, not to be a contract.
//
// Fields: msrp (CAD, from), engine, hp, fuel (combined L/100km), drive,
// seats, cargo (litres behind rear seats), tow (lb), warranty, features.

export const SPEC_LIBRARY = [
  // --- Nissan ---
  { id: "kicks25", make: "Nissan", label: "2025 Nissan Kicks", msrp: 27000, engine: "2.0L 4-cyl", hp: 141, fuel: 7.7, drive: "FWD (AWD avail.)", seats: 5, cargo: 850, tow: null, warranty: "3 yr/60,000 km (5/100 powertrain)", features: "Safety Shield 360, dual 12.3\" displays, wireless CarPlay" },
  { id: "sentra25", make: "Nissan", label: "2025 Nissan Sentra", msrp: 24000, engine: "2.0L 4-cyl", hp: 149, fuel: 7.0, drive: "FWD", seats: 5, cargo: 405, tow: null, warranty: "3 yr/60,000 km (5/100 powertrain)", features: "Safety Shield 360, CarPlay/Android Auto" },
  { id: "altima25", make: "Nissan", label: "2025 Nissan Altima", msrp: 32000, engine: "2.5L 4-cyl", hp: 188, fuel: 7.5, drive: "AWD standard (Canada)", seats: 5, cargo: 436, tow: null, warranty: "3 yr/60,000 km (5/100 powertrain)", features: "Standard AWD, ProPILOT Assist avail." },
  { id: "rogue25", make: "Nissan", label: "2025 Nissan Rogue", msrp: 34000, engine: "1.5L VC-Turbo", hp: 201, fuel: 7.3, drive: "AWD avail.", seats: 5, cargo: 1030, tow: 1350, warranty: "3 yr/60,000 km (5/100 powertrain)", features: "ProPILOT Assist, Google built-in, Safety Shield 360" },
  { id: "murano25", make: "Nissan", label: "2025 Nissan Murano", msrp: 43000, engine: "2.0L VC-Turbo", hp: 241, fuel: 9.5, drive: "AWD", seats: 5, cargo: 900, tow: 1500, warranty: "3 yr/60,000 km (5/100 powertrain)", features: "Premium interior, massaging seats avail." },
  { id: "pathfinder25", make: "Nissan", label: "2025 Nissan Pathfinder", msrp: 47000, engine: "3.5L V6", hp: 284, fuel: 10.2, drive: "4WD", seats: 8, cargo: 470, tow: 6000, warranty: "3 yr/60,000 km (5/100 powertrain)", features: "6,000 lb towing, 7 drive modes, 8 seats" },
  { id: "frontier25", make: "Nissan", label: "2025 Nissan Frontier", msrp: 44000, engine: "3.8L V6", hp: 310, fuel: 11.6, drive: "4x4", seats: 5, cargo: null, tow: 6720, warranty: "3 yr/60,000 km (5/100 powertrain)", features: "310 hp standard V6, 6,720 lb towing" },
  { id: "ariya25", make: "Nissan", label: "2025 Nissan Ariya (EV)", msrp: 48000, engine: "Electric (single/dual motor)", hp: 389, fuel: 2.2, drive: "AWD avail. (e-4ORCE)", seats: 5, cargo: 646, tow: null, warranty: "3 yr/60,000 km (8/160 battery)", features: "Up to ~465 km range, e-4ORCE AWD" },

  // --- Compact SUVs (Rogue cross-shops) ---
  { id: "rav425", make: "Toyota", label: "2025 Toyota RAV4", msrp: 36000, engine: "2.5L 4-cyl", hp: 203, fuel: 7.9, drive: "AWD", seats: 5, cargo: 1065, tow: 1500, warranty: "3 yr/60,000 km (5/100 powertrain)", features: "Toyota Safety Sense 2.5" },
  { id: "crv25", make: "Honda", label: "2025 Honda CR-V", msrp: 38000, engine: "1.5L turbo", hp: 190, fuel: 7.9, drive: "AWD", seats: 5, cargo: 1113, tow: 1500, warranty: "3 yr/60,000 km (5/100 powertrain)", features: "Honda Sensing" },
  { id: "tucson25", make: "Hyundai", label: "2025 Hyundai Tucson", msrp: 33000, engine: "2.5L 4-cyl", hp: 187, fuel: 8.1, drive: "AWD avail.", seats: 5, cargo: 1095, tow: 2000, warranty: "5 yr/100,000 km comprehensive", features: "SmartSense, 5-yr warranty" },
  { id: "cx525", make: "Mazda", label: "2025 Mazda CX-5", msrp: 33000, engine: "2.5L 4-cyl", hp: 187, fuel: 8.9, drive: "AWD standard", seats: 5, cargo: 871, tow: 2000, warranty: "3 yr unlimited km (5 unlimited powertrain)", features: "Standard AWD, upscale cabin" },
  { id: "equinox25", make: "Chevrolet", label: "2025 Chevrolet Equinox", msrp: 33000, engine: "1.5L turbo", hp: 175, fuel: 8.3, drive: "AWD avail.", seats: 5, cargo: 845, tow: 1500, warranty: "3 yr/60,000 km (5/100 powertrain)", features: "Chevy Safety Assist" },

  // --- Compact cars (Sentra cross-shops) ---
  { id: "corolla25", make: "Toyota", label: "2025 Toyota Corolla", msrp: 25000, engine: "2.0L 4-cyl", hp: 169, fuel: 6.7, drive: "FWD", seats: 5, cargo: 371, tow: null, warranty: "3 yr/60,000 km (5/100 powertrain)", features: "Toyota Safety Sense 3.0" },
  { id: "civic25", make: "Honda", label: "2025 Honda Civic", msrp: 28000, engine: "2.0L 4-cyl", hp: 150, fuel: 7.0, drive: "FWD", seats: 5, cargo: 419, tow: null, warranty: "3 yr/60,000 km (5/100 powertrain)", features: "Honda Sensing" },
  { id: "elantra25", make: "Hyundai", label: "2025 Hyundai Elantra", msrp: 24000, engine: "2.0L 4-cyl", hp: 147, fuel: 6.8, drive: "FWD", seats: 5, cargo: 402, tow: null, warranty: "5 yr/100,000 km comprehensive", features: "SmartSense, 5-yr warranty" },
  { id: "mazda325", make: "Mazda", label: "2025 Mazda3", msrp: 26000, engine: "2.5L 4-cyl", hp: 191, fuel: 7.9, drive: "FWD (AWD avail.)", seats: 5, cargo: 374, tow: null, warranty: "3 yr unlimited km (5 unlimited powertrain)", features: "Upscale cabin, AWD available" },

  // --- Subcompact SUVs (Kicks cross-shops) ---
  { id: "hrv25", make: "Honda", label: "2025 Honda HR-V", msrp: 31000, engine: "2.0L 4-cyl", hp: 158, fuel: 8.0, drive: "AWD avail.", seats: 5, cargo: 691, tow: null, warranty: "3 yr/60,000 km (5/100 powertrain)", features: "Honda Sensing" },
  { id: "kona25", make: "Hyundai", label: "2025 Hyundai Kona", msrp: 27000, engine: "2.0L 4-cyl", hp: 147, fuel: 7.4, drive: "AWD avail.", seats: 5, cargo: 723, tow: null, warranty: "5 yr/100,000 km comprehensive", features: "SmartSense, 5-yr warranty" },

  // --- 3-row SUVs (Pathfinder cross-shops) ---
  { id: "highlander25", make: "Toyota", label: "2025 Toyota Highlander", msrp: 48000, engine: "2.4L turbo", hp: 265, fuel: 9.8, drive: "AWD", seats: 8, cargo: 456, tow: 5000, warranty: "3 yr/60,000 km (5/100 powertrain)", features: "Toyota Safety Sense 2.5+" },
  { id: "pilot25", make: "Honda", label: "2025 Honda Pilot", msrp: 51000, engine: "3.5L V6", hp: 285, fuel: 11.0, drive: "AWD", seats: 8, cargo: 527, tow: 5000, warranty: "3 yr/60,000 km (5/100 powertrain)", features: "Honda Sensing" },

  // --- Midsize trucks (Frontier cross-shops) ---
  { id: "tacoma25", make: "Toyota", label: "2025 Toyota Tacoma", msrp: 46000, engine: "2.4L turbo", hp: 278, fuel: 10.5, drive: "4x4", seats: 5, cargo: null, tow: 6500, warranty: "3 yr/60,000 km (5/100 powertrain)", features: "Toyota Safety Sense 3.0" },
];

export const SPEC_DISCLAIMER = "Specs and pricing are approximate (base trims, Canadian market) — confirm current details at the dealership.";
