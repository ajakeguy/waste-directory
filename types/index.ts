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
