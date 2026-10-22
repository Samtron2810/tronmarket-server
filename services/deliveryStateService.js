import DeliveryState, { NIGERIAN_STATES } from "../models/DeliveryState.js";

// Normalises "Lagos", "lagos state", " LAGOS " etc. to one comparison key.
export function stateKey(value) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/\s+state$/, "")
    .replace(/[^a-z ]/g, "")
    .replace(/\s+/g, " ");
}

// The canonical list spells the state "Lagos" (matching the pricing
// service's shipping zones), NOT "Lagos". Resolution order:
//   1. exact full spelling, or the name with " State" appended
//      ("lagos" -> Lagos, "Ogun State" -> Ogun, "Ogun state" -> Lagos);
//   2. suffix-stripped key ("Ogun" -> Ogun, "lagos" -> Lagos);
// so "Ogun" (stripped: Ogun) never shadow-captures Kano-State queries.
const CANONICAL_BY_FULL = new Map();
for (const raw of NIGERIAN_STATES) {
  const name = raw.trim();
  CANONICAL_BY_FULL.set(name.toLowerCase(), name);
}
// "Name + State" spellings ("Ogun State", "Oyo State") — but never let an
// expansion overwrite a real name: "Ogun state" would otherwise steal
// "Lagos"'s own key.
for (const raw of NIGERIAN_STATES) {
  const name = raw.trim();
  const expanded = `${name.toLowerCase()} state`;
  if (!CANONICAL_BY_FULL.has(expanded)) CANONICAL_BY_FULL.set(expanded, name);
}
const CANONICAL_BY_STRIPPED = new Map(
  NIGERIAN_STATES.map((s) => [stateKey(s), s.trim()]),
);

// Common spellings of the capital territory that don't key-match "FCT".
const STATE_ALIASES = new Map([
  ["federal capital territory", "FCT"],
  ["fct abuja", "FCT"],
  ["abuja fct", "FCT"],
  ["abuja", "FCT"],
]);

// The canonical spelling for a user-supplied state, or null if it is not
// a Nigerian state we recognise at all.
export function canonicalStateName(value) {
  const full = String(value || "").trim().toLowerCase().replace(/\s+/g, " ");
  const key = stateKey(value);
  return (
    CANONICAL_BY_FULL.get(full) ||
    CANONICAL_BY_STRIPPED.get(key) ||
    STATE_ALIASES.get(key) ||
    null
  );
}

let seeded = false;

// Idempotently make sure all 37 rows exist (new states default to
// INACTIVE — an admin must explicitly switch delivery on per state).
export async function ensureDeliveryStates() {
  if (seeded) return;
  const existing = await DeliveryState.find({}, { name: 1 }).lean();
  const have = new Set(existing.map((d) => canonicalStateName(d.name) || d.name));
  const missing = NIGERIAN_STATES.filter((s) => !have.has(s)).map(
    (name) => ({ name, isActive: false }),
  );
  if (missing.length) {
    await DeliveryState.insertMany(missing, { ordered: false }).catch(() => {});
  }
  seeded = true;
}

export async function listDeliveryStates() {
  await ensureDeliveryStates();
  const docs = await DeliveryState.find({}).lean();
  const byKey = new Map(
    docs.map((d) => [canonicalStateName(d.name) || d.name, d]),
  );
  // Always answer in the canonical order, even if rows were edited.
  return NIGERIAN_STATES.map((name) => {
    const doc = byKey.get(name);
    return {
      _id: doc?._id || null,
      name,
      isActive: Boolean(doc?.isActive),
      updatedAt: doc?.updatedAt || null,
    };
  });
}

export async function listActiveStateNames() {
  const all = await listDeliveryStates();
  return all.filter((s) => s.isActive).map((s) => s.name);
}

export async function setDeliveryStateActive(name, isActive) {
  await ensureDeliveryStates();
  const canonical = canonicalStateName(name);
  if (!canonical) return null;
  return DeliveryState.findOneAndUpdate(
    { name: canonical },
    { $set: { isActive: Boolean(isActive) } },
    { new: true, upsert: true },
  );
}

// Used by checkout/order creation and saved-address writes: delivery is
// only possible to states an admin has activated.
export async function isStateDeliverable(value) {
  const canonical = canonicalStateName(value);
  if (!canonical) return false;
  await ensureDeliveryStates();
  const doc = await DeliveryState.findOne({ name: canonical })
    .select("isActive")
    .lean();
  return Boolean(doc?.isActive);
}
