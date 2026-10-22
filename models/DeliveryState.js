import mongoose from "mongoose";

// The 36 Nigerian states + FCT, spelled to match the shipping-zone table
// in services/pricingService.js so zone lookup keeps working.
export const NIGERIAN_STATES = [
  "Abia", "Adamawa", "Akwa Ibom", "Anambra", "Bauchi", "Bayelsa", "Benue",
  "Borno", "Cross River", "Delta", "Ebonyi", "Edo", "Ekiti", "Enugu",
  "Gombe", "Imo", "Jigawa", "Kaduna", "Kano", "Katsina", "Kebbi", "Kogi",
  "Kwara", "Lagos", "Nasarawa", "Niger", "Ogun", "Ondo", "Osun", "Oyo",
  "Plateau", "Rivers", "Sokoto", "Taraba", "Yobe", "Zamfara", "FCT",
];

// Admin-controlled deliverable locations. A state only becomes orderable
// when an admin activates it; checkout and saved addresses may only use
// active states.
const deliveryStateSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, unique: true, trim: true },
    isActive: { type: Boolean, default: false },
  },
  { timestamps: true },
);

export default mongoose.model("DeliveryState", deliveryStateSchema);
