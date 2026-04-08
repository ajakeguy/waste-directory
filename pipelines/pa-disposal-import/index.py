#!/usr/bin/env python3
"""
pipelines/pa-disposal-import/index.py

Imports PA DEP solid waste facility records.

TODO: PA DEP does not expose a publicly accessible ArcGIS REST API or
      open data download for solid waste facilities. Manual steps required:

  1. Navigate to the PA DEP eFACTS facility search:
       https://www.ahs.dep.pa.gov/eFACTSWeb/
     OR the PA DEP Open Data portal (if available):
       https://data.pa.gov/browse?tags=solid+waste

  2. Request or download the Municipal Waste Facility Permits list.
     Contact: PA DEP Bureau of Waste Management
       Phone: 717-787-7382
       Email: ra-epbwm@pa.gov

  3. Export as CSV or Excel, save to pipelines/pa-disposal-import/data/
     with filename: pa_dep_solid_waste_facilities.csv

  4. Implement the CSV reader below, following the same pattern as the
     MA disposal import (pipelines/ma-disposal-import/index.py).

Expected fields in the PA DEP export (verify against actual file):
    FACILITY_NAME, PERMIT_NUMBER, PERMIT_TYPE, FACILITY_STATUS,
    ADDRESS, MUNICIPALITY, COUNTY, STATE, ZIP

Facility type mapping (TBD — confirm against actual permit type values):
    Municipal Waste Landfill     → landfill
    Construction/Demolition      → cd_facility
    Transfer Facility            → transfer_station
    Resource Recovery Facility   → waste_to_energy
    Composting Facility          → composting
    Recycling Facility           → recycling_center

Required env vars:
    SUPABASE_URL
    SUPABASE_SERVICE_ROLE_KEY
"""

import sys

print("PA DEP disposal facility pipeline is not yet implemented.")
print("See the TODO comments in this file for manual data acquisition steps.")
sys.exit(1)
