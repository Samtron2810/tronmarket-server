// ─── Pricing: shipping zones + platform commission ─────────────────────────
// Money is calculated ONLY on the server. The checkout UI may ask for a
// shipping quote, but the order itself always recomputes from the delivery
// state and the server-side cart prices.
//
// Shipping is a flat fee per delivery zone (matched on the buyer's state),
// free once the items subtotal reaches SHIPPING_FREE_THRESHOLD. Commission
// is a percentage of each seller's item subtotal; the rest is that seller's
// payout. Both are snapshotted onto the order/fulfilments at purchase time
// so later config changes never rewrite history.

export function money(value) {
  const number = Number(value || 0);
  if (!Number.isFinite(number)) return 0;
  return Math.round(number * 100) / 100;
}

function stateKey(value) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/\s+state$/, "")
    .replace(/[^a-z ]/g, "")
    .replace(/\s+/g, " ");
}

const ZONES = [
  {
    id: "Lagos",
    label: "Lagos",
    fee: 1500,
    states: ["Lagos"],
  },
  {
    id: "south-west",
    label: "South West",
    fee: 2500,
    states: ["Ogun", "Oyo", "Osun", "Ondo", "Ekiti"],
  },
  {
    id: "south-south-east",
    label: "South South / South East",
    fee: 3500,
    states: [
      "Edo",
      "Delta",
      "Bayelsa",
      "Rivers",
      "Akwa Ibom",
      "Cross River",
      "Enugu",
      "Ebonyi",
      "Imo",
      "Abia",
      "Anambra",
    ],
  },
  {
    id: "north",
    label: "Northern Nigeria",
    fee: 4500,
    states: [
      "Kwara",
      "Kogi",
      "Niger",
      "Plateau",
      "Nasarawa",
      "Benue",
      "Taraba",
      "Adamawa",
      "Borno",
      "Yobe",
      "Bauchi",
      "Gombe",
      "Jigawa",
      "Kano",
      "Katsina",
      "Kaduna",
      "Zamfara",
      "Sokoto",
      "Kebbi",
      "FCT",
      "Federal Capital Territory",
      "Abuja",
    ],
  },
];

const ZONE_BY_STATE = new Map();
for (const zone of ZONES) {
  for (const state of zone.states) ZONE_BY_STATE.set(stateKey(state), zone);
}

export function getShippingZone(state) {
  return ZONE_BY_STATE.get(stateKey(state)) || ZONES[ZONES.length - 1];
}

const ZONE_FEE_ENV = {
  Lagos: "SHIPPING_Lagos_FEE",
  "south-west": "SHIPPING_SOUTH_WEST_FEE",
  "south-south-east": "SHIPPING_SOUTH_SOUTH_FEE",
  north: "SHIPPING_NORTH_FEE",
};

export function shippingFeeForZone(zone) {
  const envName = ZONE_FEE_ENV[zone.id];
  const configured = Number(
    process.env[envName] ||
      (zone.id === "south-south-east"
        ? process.env.SHIPPING_SOUTH_EAST_FEE
        : undefined) ||
      (zone.id === "north" ? process.env.SHIPPING_DEFAULT_FEE : undefined),
  );
  return Number.isFinite(configured) && configured >= 0
    ? money(configured)
    : zone.fee;
}

export function getFreeShippingThreshold() {
  const value = Number(process.env.SHIPPING_FREE_THRESHOLD || 100000);
  return Number.isFinite(value) && value > 0 ? value : 0;
}

export function calculateShipping({ state, itemsSubtotal }) {
  const zone = getShippingZone(state);
  const subtotal = money(itemsSubtotal);
  const threshold = getFreeShippingThreshold();
  const free = threshold > 0 && subtotal >= threshold;
  return {
    zoneId: zone.id,
    zoneLabel: zone.label,
    shippingFee: free ? 0 : shippingFeeForZone(zone),
    freeShipping: free,
    freeShippingThreshold: threshold,
  };
}

export function shippingForSubtotal(itemsSubtotal, state) {
  const quote = calculateShipping({ state, itemsSubtotal });
  return {
    ...quote,
    amount: quote.shippingFee,
    zone: quote.zoneLabel,
  };
}

// PLATFORM_COMMISSION_RATE accepts a fraction (0.10) or a percent (10).
export function getCommissionRate() {
  const raw = Number(process.env.PLATFORM_COMMISSION_RATE ?? 0.1);
  if (!Number.isFinite(raw) || raw < 0) return 0.1;
  const fraction = raw > 1 ? raw / 100 : raw;
  return Math.min(0.5, Math.max(0, fraction));
}

export function commissionFor(subtotal, rate = getCommissionRate()) {
  const commissionRate = Math.min(0.5, Math.max(0, Number(rate) || 0));
  const commissionAmount = money(subtotal * commissionRate);
  return {
    commissionRate,
    commissionAmount,
    payoutAmount: money(subtotal - commissionAmount),
  };
}

export function shippingZones() {
  return ZONES.map((zone) => ({
    id: zone.id,
    label: zone.label,
    fee: shippingFeeForZone(zone),
    states: zone.states,
  }));
}
