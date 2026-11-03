import { supabase } from '../supabase'

const coordCache = new Map()
const walkCache = new Map()

// Official SMU Campus Geocoded Coordinates (Primary High-Accuracy Fallback)
const SMU_BUILDING_COORDS = {
  'smu school of computing and information systems 1': { lat: 1.29743, lng: 103.8496 },
  'li ka shing library': { lat: 1.2966, lng: 103.8502 },
  'smu connexion': { lat: 1.2961, lng: 103.8515 },
  'smu school of economics / school of social sciences': { lat: 1.2982, lng: 103.8488 },
  'smu yong pung how school of law': { lat: 1.2948, lng: 103.8502 },
  'lee kong chian school of business': { lat: 1.2952, lng: 103.8510 },
  'smu administration building': { lat: 1.2969, lng: 103.8522 }
}

// 1. Geocode venue string to lat/lng
async function getCoordsForVenue(venueName) {
  if (!venueName) return null
  const query = venueName.trim().toLowerCase()

  if (coordCache.has(query)) {
    return coordCache.get(query)
  }

  // Check static SMU map lookup first
  for (const [key, coords] of Object.entries(SMU_BUILDING_COORDS)) {
    if (query.includes(key) || key.includes(query)) {
      coordCache.set(query, coords)
      return coords
    }
  }

  // Fetch from OneMap Elastic Search API
  try {
    const searchParam = encodeURIComponent(venueName.trim())
    const res = await fetch(`https://www.onemap.gov.sg/api/common/elastic/search?searchVal=${searchParam}&returnGeom=Y&getAddrDetails=Y&pageNum=1`)
    const json = await res.json()

    if (json.results && json.results.length > 0) {
      const top = json.results[0]
      const coords = { lat: parseFloat(top.LATITUDE), lng: parseFloat(top.LONGITUDE) }
      coordCache.set(query, coords)
      return coords
    }
  } catch (err) {
    console.warn('OneMap geocoding fallback for:', venueName, err)
  }

  return null
}

// Calculate straight-line campus walking distance (Haversine formula)
function calculateCampusWalk(lat1, lon1, lat2, lon2) {
  const R = 6371e3 // Earth radius in metres
  const phi1 = (lat1 * Math.PI) / 180
  const phi2 = (lat2 * Math.PI) / 180
  const deltaPhi = ((lat2 - lat1) * Math.PI) / 180
  const deltaLambda = ((lon2 - lon1) * Math.PI) / 180

  const a =
    Math.sin(deltaPhi / 2) * Math.sin(deltaPhi / 2) +
    Math.cos(phi1) * Math.cos(phi2) * Math.sin(deltaLambda / 2) * Math.sin(deltaLambda / 2)

  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))
  const straightMetres = R * c

  // Account for pedestrian concourse paths (~1.3x straight-line distance)
  const metres = Math.round(straightMetres * 1.3)
  // Average campus walking speed: 80 metres per minute
  const minutes = Math.max(1, Math.round(metres / 80))

  return { minutes, metres }
}

// 2. Main exported walk time calculator
export async function getWalkTime(fromVenue, toVenue) {
  if (!fromVenue || !toVenue) return null

  const normFrom = fromVenue.trim().toLowerCase()
  const normTo = toVenue.trim().toLowerCase()

  if (normFrom === normTo) {
    return { minutes: 0, metres: 0 }
  }

  const [a, b] = await Promise.all([
    getCoordsForVenue(fromVenue),
    getCoordsForVenue(toVenue)
  ])

  if (!a || !b) return null

  if (a.lat === b.lat && a.lng === b.lng) {
    return { minutes: 0, metres: 0 }
  }

  const routeKey = `${a.lat},${a.lng}|${b.lat},${b.lng}`
  if (walkCache.has(routeKey)) {
    return walkCache.get(routeKey)
  }

  // Attempt Supabase Edge Function invocation
  try {
    const { data, error } = await supabase.functions.invoke('onemap-walk', {
      body: { from: `${a.lat},${a.lng}`, to: `${b.lat},${b.lng}` }
    })

    if (!error && data && data.metres !== undefined) {
      walkCache.set(routeKey, data)
      return data
    }
  } catch (e) {
    // Edge function unreachable
  }

  // Fallback to SMU Geocoded Campus Distance Calculation
  const calculatedWalk = calculateCampusWalk(a.lat, a.lng, b.lat, b.lng)
  walkCache.set(routeKey, calculatedWalk)
  return calculatedWalk
}