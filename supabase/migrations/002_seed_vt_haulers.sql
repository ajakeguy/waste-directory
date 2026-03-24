-- 002_seed_vt_haulers.sql
-- Seed data: 5 Vermont waste haulers for initial directory population

insert into organizations (
  name, slug, org_type,
  website, phone, email, description,
  address, city, state, zip, county,
  service_types, service_area_states,
  verified, active, data_source
) values

(
  'Green Mountain Waste Solutions',
  'green-mountain-waste-solutions',
  'hauler',
  'https://www.greenmountainwaste.com',
  '(802) 555-0142',
  'info@greenmountainwaste.com',
  'Family-owned waste management company serving central Vermont since 1987. We offer residential and commercial pickup, roll-off container rentals, and full recycling services.',
  '145 Industrial Park Dr',
  'Barre',
  'VT',
  '05641',
  'Washington',
  ARRAY['residential','commercial','roll_off','recycling'],
  ARRAY['VT'],
  true,
  true,
  'seed'
),

(
  'Champlain Valley Disposal',
  'champlain-valley-disposal',
  'hauler',
  'https://www.cvdisposal.com',
  '(802) 555-0198',
  'service@cvdisposal.com',
  'Northwest Vermont''s most trusted waste hauler. Serving Burlington, Chittenden County, and surrounding areas with residential curbside pickup, commercial dumpster service, and composting pickup.',
  '88 Commerce Way',
  'Burlington',
  'VT',
  '05401',
  'Chittenden',
  ARRAY['residential','commercial','recycling','composting'],
  ARRAY['VT'],
  true,
  true,
  'seed'
),

(
  'Northeast Kingdom Rubbish',
  'northeast-kingdom-rubbish',
  'hauler',
  null,
  '(802) 555-0237',
  null,
  'Reliable waste removal for homes and businesses across Orleans, Essex, and Caledonia counties. Locally owned and operated with flexible pickup schedules.',
  '12 Maple St',
  'Newport',
  'VT',
  '05855',
  'Orleans',
  ARRAY['residential','commercial','roll_off'],
  ARRAY['VT'],
  false,
  true,
  'seed'
),

(
  'Green Up Vermont Recycling',
  'green-up-vermont-recycling',
  'hauler',
  'https://www.greenupvtrecycling.com',
  '(802) 555-0311',
  'hello@greenupvtrecycling.com',
  'Specializing in recycling and e-waste collection across central Vermont and southern New Hampshire. We divert electronics, appliances, and all standard recyclables from the landfill.',
  '300 River Rd',
  'Montpelier',
  'VT',
  '05602',
  'Washington',
  ARRAY['recycling','e_waste','composting'],
  ARRAY['VT','NH'],
  true,
  true,
  'seed'
),

(
  'Southern Vermont Hauling',
  'southern-vermont-hauling',
  'hauler',
  'https://www.svhauling.com',
  '(802) 555-0476',
  'dispatch@svhauling.com',
  'Full-service waste removal for Windham and Bennington counties. Residential, commercial, and industrial waste handled with care. Roll-off containers available for renovation, construction, and cleanup projects.',
  '54 Route 9',
  'Brattleboro',
  'VT',
  '05301',
  'Windham',
  ARRAY['residential','commercial','industrial','roll_off'],
  ARRAY['VT','MA','NH'],
  false,
  true,
  'seed'
);
