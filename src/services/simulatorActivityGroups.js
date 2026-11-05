// Purpose: Show each Day Ops activity once on screen, even though Day Ops saves one task per crew member.
/** Display only. "Show" with 6 crew is 6 ops_tasks rows, each its own engine
 * segment so Apply/Undo can write back to the exact task. Tasks with the same
 * title and the same times are one activity for the person reading the page. */

// Only Day Ops tasks are grouped; other events already store one row per activity.
export function activityKey(segment) {
  if (segment?.source_table !== 'ops_tasks') return 'segment|' + segment?.id
  return [segment.event_id, segment.title, Date.parse(segment.starts_at), Date.parse(segment.ends_at)].join('|')
}

/** Group segments (or anything carrying their fields) in their original order.
 * keepApart(segment) = true leaves that one ungrouped, e.g. a node with a drawn dependency. */
export function groupActivities(segments = [], keepApart = () => false) {
  const groups = new Map()
  for (const segment of segments) {
    const key = keepApart(segment) ? 'segment|' + segment.id : activityKey(segment)
    if (!groups.has(key)) groups.set(key, { key, id: segment.id, title: segment.title, starts_at: segment.starts_at, ends_at: segment.ends_at, is_fixed: false, ids: [], items: [] })
    const group = groups.get(key)
    group.ids.push(segment.id)
    group.items.push(segment)
    if (segment.is_fixed) group.is_fixed = true
  }
  return [...groups.values()]
}
