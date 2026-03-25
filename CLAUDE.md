\# CLAUDE.md — Waste Industry Directory



\## Project Overview

This is a waste industry directory and news aggregation platform.

MVP scope: Waste hauler directory for Vermont, New York, and Massachusetts,

plus an industry news feed aggregated from RSS sources.

The goal is to be the definitive resource for waste industry professionals.



\## Owner Context

The project owner is non-technical. Claude Code is the primary developer.

When given instructions in plain English, Claude Code should:

\- Make all necessary code changes autonomously

\- Create migration files for any schema changes

\- Commit changes with descriptive commit messages

\- Never ask for clarification on technical implementation details — make the best decision and proceed

\- Always ask before making changes that affect URL structure or database schema



\## Tech Stack

\- Framework: Next.js 14 with App Router, TypeScript (strict)

\- Database: PostgreSQL via Supabase

\- Auth: Supabase Auth

\- UI: Tailwind CSS + shadcn/ui

\- Hosting: Vercel (auto-deploys from main branch)

\- Package manager: pnpm

\- Background jobs: GitHub Actions



\## Brand

\- Primary color: Forest green (#2D6A4F or similar deep forest green)

\- Accent: Silver/gray (#94A3B8)

\- Style: Modern, clean, professional

\- Font: Inter (system default via Tailwind)

\- Tailwind config: extend with `brand` color tokens



\## Repository Structure

```

/app                     # Next.js App Router

&#x20; /(public)/             # Public pages

&#x20;   page.tsx             # Homepage

&#x20;   /directory/          # Hauler search/filter page

&#x20;   /haulers/\[state]/    # State landing pages

&#x20;   /haulers/\[state]/\[slug]/  # Hauler profile pages

&#x20;   /news/               # News page

&#x20; /(auth)/               # Login/register

&#x20; /(dashboard)/          # Authenticated user area

&#x20; /admin/                # Admin panel

&#x20; /api/                  # API routes

/components

&#x20; /ui/                   # shadcn primitives (do not edit)

&#x20; /directory/            # Directory-specific components

&#x20; /layout/               # Header, footer, nav

/lib

&#x20; /supabase/             # Supabase clients

&#x20; /data/                 # Data fetching functions

/pipelines               # GitHub Actions pipeline scripts

/supabase/migrations     # SQL migrations (sequential)

/types                   # TypeScript types

```



\## Database Schema (MVP)



\### organizations

```sql

id uuid primary key default gen\_random\_uuid()

name text not null

slug text unique not null

org\_type text default 'hauler'

website text

phone text

email text

description text

logo\_url text

address text

city text

state text not null  -- 2-letter code: VT, NY, MA

zip text

county text

lat numeric

lng numeric

service\_types text\[]  -- e.g. \['residential','commercial','roll\_off']

service\_area\_states text\[]  -- states they serve, e.g. \['VT','NY']

verified boolean default false

active boolean default true

data\_source text

created\_at timestamptz default now()

updated\_at timestamptz default now()

search\_vector tsvector  -- for full-text search

```



\### news\_sources

```sql

id uuid primary key default gen\_random\_uuid()

name text not null

url text

rss\_url text not null unique

category text

active boolean default true

last\_fetched\_at timestamptz

```



\### news\_articles

```sql

id uuid primary key default gen\_random\_uuid()

source\_id uuid references news\_sources(id)

title text not null

url text unique not null

summary text

published\_at timestamptz

fetched\_at timestamptz default now()

image\_url text

```



\### users (mirrors Supabase auth)

```sql

id uuid primary key references auth.users(id)

email text

name text

user\_type text

created\_at timestamptz default now()

```



\### saved\_items

```sql

id uuid primary key default gen\_random\_uuid()

user\_id uuid references users(id) on delete cascade

item\_type text  -- 'organization'

item\_id uuid

created\_at timestamptz default now()

unique(user\_id, item\_id)

```



\## URL Structure

\- `/` — Homepage

\- `/directory` — Main hauler search (all states)

\- `/directory?state=NY\&service=roll\_off` — Filtered search

\- `/haulers/vermont` — Vermont haulers landing page

\- `/haulers/new-york` — New York haulers landing page

\- `/haulers/massachusetts` — Massachusetts haulers landing page

\- `/haulers/\[slug]` — Individual hauler profile (slug-only, supports multi-state haulers)

\- `/haulers/\[state]/\[slug]` — Legacy redirect → `/haulers/\[slug]`

\- `/news` — News aggregation page

\- `/dashboard` — User dashboard (saved haulers)



\## Business Rules

1\. NEVER hard-delete organization records. Set active=false.

2\. Slugs are permanent once created. Never change them.

3\. Always tag records with data\_source field.

4\. State codes are always uppercase 2-letter (VT, NY, MA).

5\. State URL slugs are lowercase full name (vermont, new-york, massachusetts).

6\. service\_types valid values: residential, commercial, roll\_off, industrial, recycling, composting, hazmat, e\_waste, medical

7\. Never reproduce full news article text. Title, summary, URL only.



\## Service Type Display Names

residential → Residential Pickup

commercial → Commercial Pickup

roll\_off → Roll-Off Containers

industrial → Industrial Waste

recycling → Recycling Services

composting → Composting

hazmat → Hazardous Waste

e\_waste → E-Waste / Electronics

medical → Medical Waste



\## Environment Variables Required

NEXT\_PUBLIC\_SUPABASE\_URL

NEXT\_PUBLIC\_SUPABASE\_ANON\_KEY

SUPABASE\_SERVICE\_ROLE\_KEY

NEXT\_PUBLIC\_SITE\_URL

NEXT\_PUBLIC\_SITE\_NAME



\## shadcn/ui Components Installed

(Update this list as components are added)

\- button

\- input

\- card

\- badge

\- select

\- dialog

\- sheet

\- navigation-menu

\- separator

\- skeleton

\- toast



\## Commit Convention

feat: new feature

fix: bug fix

data: data/content changes

style: visual/UI changes

pipeline: data pipeline changes

chore: dependencies, config



\## MVP Build Order (Current Phase: M1)

\- \[x] M0: Project setup

\- \[ ] M1: Database schema + Supabase setup + basic site scaffold

\- \[ ] M2: Directory search page + hauler profiles + state landing pages

\- \[ ] M3: News aggregation pipeline + news page

\- \[ ] M4: User accounts + saved haulers + dashboard

\- \[ ] M5: Seed data (VT, NY, MA haulers) + launch prep



\## When Uncertain

\- Make the simplest implementation that works

\- Prefer server components over client components unless interactivity requires it

\- Prefer Supabase data fetching over external APIs

\- Ask before: changing URL patterns, modifying existing migrations, adding paid services

