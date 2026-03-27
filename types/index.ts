export type Organization = {
  id: string
  name: string
  slug: string
  org_type: string
  website: string | null
  phone: string | null
  email: string | null
  description: string | null
  logo_url: string | null
  address: string | null
  city: string | null
  state: string
  zip: string | null
  county: string | null
  lat: number | null
  lng: number | null
  service_types: string[] | null
  service_area_states: string[] | null
  verified: boolean
  active: boolean
  data_source: string | null
  created_at: string
  updated_at: string
}

export type ServiceType =
  | "residential"
  | "commercial"
  | "roll_off"
  | "industrial"
  | "recycling"
  | "composting"
  | "hazmat"
  | "e_waste"
  | "medical"

export const SERVICE_TYPE_LABELS: Record<ServiceType, string> = {
  residential: "Residential Pickup",
  commercial: "Commercial Pickup",
  roll_off: "Roll-Off Containers",
  industrial: "Industrial Waste",
  recycling: "Recycling Services",
  composting: "Composting",
  hazmat: "Hazardous Waste",
  e_waste: "E-Waste / Electronics",
  medical: "Medical Waste",
}

export const SERVICE_TYPES = Object.keys(SERVICE_TYPE_LABELS) as ServiceType[]

export const STATE_SLUG_TO_CODE: Record<string, string> = {
  vermont: "VT",
  "new-york": "NY",
  massachusetts: "MA",
}

export const STATE_CODE_TO_SLUG: Record<string, string> = {
  VT: "vermont",
  NY: "new-york",
  MA: "massachusetts",
}

export const STATE_SLUG_TO_NAME: Record<string, string> = {
  vermont: "Vermont",
  "new-york": "New York",
  massachusetts: "Massachusetts",
}

export const VALID_STATE_SLUGS = Object.keys(STATE_SLUG_TO_CODE)

// ── User lists & saved items ───────────────────────────────────────────────────

export type UserList = {
  id: string
  user_id: string
  name: string
  description: string | null
  color: string
  created_at: string
  updated_at: string
}

export type SavedItem = {
  id: string
  user_id: string
  item_type: string
  item_id: string
  list_id: string | null
  notes: string | null
  created_at: string
}

/** A saved item with its org and (optional) list data joined in. */
export type SavedItemWithOrg = {
  id: string
  item_id: string
  list_id: string | null
  notes: string | null
  org: Organization
  list: Pick<UserList, "id" | "name" | "color"> | null
}

// ── Equipment Marketplace ──────────────────────────────────────────────────────

export type EquipmentCategory =
  | "trucks_vehicles"
  | "containers_dumpsters"
  | "compactors"
  | "balers_shredders"
  | "parts_attachments"
  | "other_equipment"

export const EQUIPMENT_CATEGORY_LABELS: Record<EquipmentCategory, string> = {
  trucks_vehicles: "Trucks & Vehicles",
  containers_dumpsters: "Containers & Dumpsters",
  compactors: "Compactors",
  balers_shredders: "Balers & Shredders",
  parts_attachments: "Parts & Attachments",
  other_equipment: "Other Equipment",
}

export const EQUIPMENT_CATEGORIES = Object.keys(
  EQUIPMENT_CATEGORY_LABELS
) as EquipmentCategory[]

export type EquipmentCondition = "new" | "used" | "refurbished"

export const EQUIPMENT_CONDITION_LABELS: Record<EquipmentCondition, string> = {
  new: "New",
  used: "Used",
  refurbished: "Refurbished",
}

export type EquipmentListingStatus = "active" | "sold" | "draft" | "expired"

export type EquipmentListing = {
  id: string
  user_id: string
  title: string
  description: string
  category: EquipmentCategory
  condition: EquipmentCondition
  price: number | null
  price_negotiable: boolean
  quantity: number
  location_city: string | null
  location_state: string | null
  photos: string[]
  contact_name: string | null
  contact_email: string | null
  contact_phone: string | null
  status: EquipmentListingStatus
  expires_at: string
  created_at: string
  updated_at: string
}
