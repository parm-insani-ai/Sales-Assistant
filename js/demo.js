// Sample data loader — populates realistic demo records (tagged demo:true) so
// every feature (Deal Radar, call list, goals, calendar) lights up instantly.
// Everything it adds can be removed in one tap without touching real data.

import * as store from "./store.js";

const COLLECTIONS = ["leads", "vehicles", "tasks", "appointments", "sales", "deliveries"];

function iso(offsetDays) {
  const d = new Date();
  d.setDate(d.getDate() + offsetDays);
  return d.toISOString().slice(0, 10);
}
function isoYearsAgo(years, extraDays = 0) {
  const d = new Date();
  d.setFullYear(d.getFullYear() - years);
  d.setDate(d.getDate() + extraDays);
  return d.toISOString().slice(0, 10);
}
function todayAt(hour, min = 0) {
  const d = new Date();
  d.setHours(hour, min, 0, 0);
  const pad = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(hour)}:${pad(min)}`;
}
// A birthday MM-DD a few days out (any year).
function birthdaySoon(days) {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return `1988-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

export function hasSampleData() {
  return COLLECTIONS.some((n) => store.all(n).some((x) => x.demo));
}

export function removeSampleData() {
  COLLECTIONS.forEach((name) => {
    store.all(name).filter((x) => x.demo).forEach((x) => store.remove(name, x.id));
  });
}

export function loadSampleData() {
  removeSampleData(); // avoid duplicates if run twice

  const V = (o) => store.create("vehicles", { status: "available", condition: "New", demo: true, ...o });
  V({ year: 2024, make: "Nissan", model: "Rogue", trim: "SV", price: 33995, stock: "D100", color: "Gun Metallic", bodyStyle: "SUV", fuelType: "Gasoline", transmission: "Automatic" });
  V({ year: 2024, make: "Nissan", model: "Altima", trim: "SR", price: 31995, stock: "D200", color: "Pearl White", bodyStyle: "Sedan", fuelType: "Gasoline", transmission: "Automatic" });
  V({ year: 2024, make: "Nissan", model: "Sentra", trim: "SV", price: 24995, stock: "D300", color: "Blue", bodyStyle: "Sedan", fuelType: "Gasoline", transmission: "Automatic" });
  V({ year: 2024, make: "Nissan", model: "Kicks", trim: "SR", price: 27995, stock: "D400", color: "Red", bodyStyle: "SUV", fuelType: "Gasoline", transmission: "Automatic" });
  V({ year: 2023, make: "Nissan", model: "Frontier", trim: "PRO-4X", price: 44250, stock: "D500", color: "Tactical Green", bodyStyle: "Truck", fuelType: "Gasoline", transmission: "Automatic" });

  // Past customers with equity data → feed the Deal Radar
  const C = (o) => store.create("leads", { stage: "delivered", source: "Import", demo: true, ...o });
  C({ name: "Ken Adams", phone: "9025557001", vehicleInterest: "2021 Rogue SL", currentPayment: 485, payoff: 14500, currentValue: 17800, currentApr: 5.9, purchaseDate: isoYearsAgo(3, -20) });
  C({ name: "Lena Park", phone: "9025557002", vehicleInterest: "2021 Altima SV", currentPayment: 610, payoff: 9200, currentValue: 11000, currentApr: 9.9, leaseEnd: iso(45) });
  C({ name: "Moe Diaz", phone: "9025557003", vehicleInterest: "2019 Sentra S", currentPayment: 360, payoff: 6000, currentValue: 8000, currentApr: 6.0, purchaseDate: isoYearsAgo(4) });
  C({ name: "Sara Chen", phone: "9025557004", vehicleInterest: "2022 Kicks SV", currentPayment: 540, payoff: 12000, currentValue: 15500, currentApr: 4.9, purchaseDate: isoYearsAgo(2, -10), dob: birthdaySoon(4) });
  C({ name: "Dave Wong", phone: "9025557005", vehicleInterest: "2020 Frontier SV", currentPayment: 700, payoff: 22000, currentValue: 19000, currentApr: 7.5, purchaseDate: isoYearsAgo(3, 10) });

  // Active pipeline leads (follow-ups + speed-to-lead)
  store.create("leads", { name: "Priya Sharma", phone: "9025557010", vehicleInterest: "Used Pathfinder", stage: "appointment", source: "Walk-in", followUp: iso(0), demo: true });
  store.create("leads", { name: "Marcus Bennett", phone: "9025557011", vehicleInterest: "2024 Rogue SV", stage: "negotiating", source: "Internet", followUp: iso(-1), lastContacted: new Date(Date.now() - 9 * 86400000).toISOString(), demo: true });
  store.create("leads", { name: "Tanya Boyd", phone: "9025557012", vehicleInterest: "Kicks", stage: "new", source: "Internet", demo: true });

  // To-dos, an appointment, and a logged sale (dashboard + goals)
  store.create("tasks", { title: "Call bank about Marcus approval", due: iso(0), priority: "high", done: false, demo: true });
  store.create("tasks", { title: "Order all-weather mats for delivery", due: iso(1), priority: "normal", done: false, demo: true });
  store.create("appointments", { type: "testdrive", title: "Test drive", customerName: "Priya Sharma", vehicle: "Used Pathfinder", when: todayAt(15), status: "scheduled", demo: true });
  store.create("sales", { customerName: "Sara Chen", vehicle: "2024 Altima SR", saleDate: iso(-2), frontGross: 1800, backGross: 900, commission: 720, demo: true });
}
