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
  license_metadata: Record<string, string> | null
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
  | "hazardous_waste"
  | "e_waste"
  | "medical"
  | "septage"

export const SERVICE_TYPE_LABELS: Record<ServiceType, string> = {
  residential:      "Residential Pickup",
  commercial:       "Commercial Pickup",
  roll_off:         "Roll-Off / C&D",
  industrial:       "Industrial Waste",
  recycling:        "Recycling Services",
  composting:       "Composting",
  hazmat:           "Hazardous Waste",
  hazardous_waste:  "Hazardous Waste Transport",
  e_waste:          "E-Waste / Electronics",
  medical:          "Medical Waste",
  septage:          "Septage / Pumping",
}

export const SERVICE_TYPES = Object.keys(SERVICE_TYPE_LABELS) as ServiceType[]

export const STATE_SLUG_TO_CODE: Record<string, string> = {
  connecticut:      "CT",
  maine:            "ME",
  massachusetts:    "MA",
  "new-hampshire":  "NH",
  "new-jersey":     "NJ",
  "new-york":       "NY",
  pennsylvania:     "PA",
  "rhode-island":   "RI",
  vermont:          "VT",
}

export const STATE_CODE_TO_SLUG: Record<string, string> = {
  CT: "connecticut",
  ME: "maine",
  MA: "massachusetts",
  NH: "new-hampshire",
  NJ: "new-jersey",
  NY: "new-york",
  PA: "pennsylvania",
  RI: "rhode-island",
  VT: "vermont",
}

export const STATE_SLUG_TO_NAME: Record<string, string> = {
  connecticut:      "Connecticut",
  maine:            "Maine",
  massachusetts:    "Massachusetts",
  "new-hampshire":  "New Hampshire",
  "new-jersey":     "New Jersey",
  "new-york":       "New York",
  pennsylvania:     "Pennsylvania",
  "rhode-island":   "Rhode Island",
  vermont:          "Vermont",
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

// ── Route Optimizer ────────────────────────────────────────────────────────────

export type RouteStop = {
  id: string
  address: string
  name?: string
  lat?: number
  lng?: number
  geocoded?: boolean
  yards?: number
}

export type SavedRoute = {
  id: string
  user_id: string
  route_name: string
  start_address: string
  end_address: string
  stops: RouteStop[]
  optimized_order: number[] | null
  total_distance_km: number | null
  total_distance_miles: number | null
  road_geometry: { coordinates: [number, number][] } | null
  status: string
  created_at: string
  updated_at: string
}

// ── Diversion Reports ──────────────────────────────────────────────────────────

export type MaterialStream = {
  material: string
  quantity: number
  unit: "tons" | "lbs"
  category: "recycling" | "organics" | "landfill" | "other"
  diverted: boolean
}

export type DiversionReport = {
  id: string
  user_id: string
  report_name: string
  hauler_name: string
  hauler_logo_url: string | null
  customer_name: string
  service_address: string
  service_city: string
  service_state: string
  service_zip: string
  period_start: string
  period_end: string
  material_streams: MaterialStream[]
  notes: string | null
  status: "draft" | "published"
  created_at: string
  updated_at: string
}

// ── Disposal Facilities ────────────────────────────────────────────────────────

export type FacilityType =
  | "landfill"
  | "transfer_station"
  | "mrf"
  | "composting"
  | "anaerobic_digestion"
  | "waste_to_energy"
  | "hazardous_waste"
  | "cd_facility"

export const FACILITY_TYPE_LABELS: Record<FacilityType, string> = {
  landfill:            "Landfill",
  transfer_station:    "Transfer Station",
  mrf:                 "MRF / Recycling Center",
  composting:          "Composting",
  anaerobic_digestion: "Anaerobic Digestion",
  waste_to_energy:     "Waste-to-Energy",
  hazardous_waste:     "Hazardous Waste",
  cd_facility:         "C&D Facility",
}

export const FACILITY_TYPES = Object.keys(FACILITY_TYPE_LABELS) as FacilityType[]

/** Tailwind badge color classes per facility type. */
export const FACILITY_TYPE_COLORS: Record<FacilityType, string> = {
  landfill:            "bg-gray-100 text-gray-700",
  transfer_station:    "bg-blue-100 text-blue-700",
  mrf:                 "bg-purple-100 text-purple-700",
  composting:          "bg-green-100 text-green-700",
  anaerobic_digestion: "bg-teal-100 text-teal-700",
  waste_to_energy:     "bg-orange-100 text-orange-700",
  hazardous_waste:     "bg-red-100 text-red-700",
  cd_facility:         "bg-yellow-100 text-yellow-700",
}

export type DisposalFacility = {
  id: string
  name: string
  slug: string
  facility_type: string
  address: string | null
  city: string | null
  state: string | null
  zip: string | null
  lat: number | null
  lng: number | null
  phone: string | null
  email: string | null
  website: string | null
  operator_name: string | null
  permit_number: string | null
  permit_status: string | null
  permitted_capacity_tons_per_day: number | null
  accepts_msw: boolean
  accepts_recycling: boolean
  accepts_cd: boolean
  accepts_organics: boolean
  accepts_hazardous: boolean
  accepts_special_waste: boolean
  tipping_fee_per_ton: number | null
  hours_of_operation: string | null
  data_source: string | null
  service_area_states: string[] | null
  notes: string | null
  verified: boolean
  active: boolean
  created_at: string
  updated_at: string
}
