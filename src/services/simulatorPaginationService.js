/**
 * Read every RLS-visible row without assuming the server's row cap. Each request
 * uses the same filters/order and asks for an exact count of visible rows.
 * Short pages are NOT end-of-data: advance by the number actually returned.
 * This checks completeness of visible records, not records hidden by RLS.
 */
export async function readSimulatorRows(client, table, configureQuery, columns = '*') {
  const keys = {
    segment_dependencies: ['prerequisite_segment_id', 'dependent_segment_id'],
    segment_facility_bookings: ['segment_id', 'booking_id']
  }[table] || ['id']
  const rows = []
  const seen = new Set()
  let expected = null
  // Bound work so an unexpectedly huge response fails visibly instead of hanging.
  const maxPages = 10000
  for (let page = 0; page < maxPages; page++) {
    let query = client.from(table).select(columns, { count: 'exact' })
    if (configureQuery) query = configureQuery(query)
    for (const key of keys) query = query.order(key, { ascending: true })
    const { data, error, count } = await query.range(rows.length, rows.length + 199)
    if (error) throw new Error('Could not load ' + table + ': ' + error.message)
    if (!Array.isArray(data) || !Number.isSafeInteger(count) || count < 0) {
      throw new Error('Cannot verify complete ' + table + ' data: exact count or rows missing')
    }
    if (expected === null) expected = count
    if (count !== expected) throw new Error(table + ' changed during loading; refresh and try again')
    for (const row of data) {
      if (keys.some(key => row[key] == null)) throw new Error('Missing pagination key in ' + table)
      const identity = JSON.stringify(keys.map(key => String(row[key])))
      if (seen.has(identity)) throw new Error('Duplicate pagination row in ' + table + '; refresh and try again')
      seen.add(identity)
      rows.push(row)
    }
    if (rows.length > expected) throw new Error('Inconsistent row count in ' + table)
    if (rows.length === expected) return rows
    if (data.length === 0) throw new Error('Incomplete ' + table + ' data: server stopped before exact count')
  }
  throw new Error('Pagination safety limit reached for ' + table + '; data is incomplete')
}
