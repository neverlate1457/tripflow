import { describe, expect, it } from 'vitest';
import type { TripItem } from './models';
import { editTripItem, itemsForDate, minutesOfDay, minutesToPosition, moveItem, overlappingIds, positionToMinutes, resizeItem, snapMinutes } from './time';

const base: TripItem = {
  id: 'a', tripId: 'trip', type: 'place', title: 'A', description: null,
  startAt: '2026-10-24T00:00:00.000Z', endAt: '2026-10-24T02:00:00.000Z',
  latitude: null, longitude: null, address: null, placeId: null, notes: null,
  sortOrder: 0, createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z',
  flexibility: 'flexible', schedulingConstraint: null, reservation: null,
};
const timezone = 'Asia/Tokyo';

describe('timeline conversions', () => {
  it('converts time to position', () => expect(minutesToPosition(9 * 60, 64)).toBe(192));
  it('converts position to snapped time', () => expect(positionToMinutes(202, 64)).toBe(555));
  it('snaps to 15 minutes', () => { expect(snapMinutes(548)).toBe(555); expect(snapMinutes(546)).toBe(540); });
});

describe('item edits', () => {
  it('moves while preserving duration', () => {
    const moved = moveItem(base, '2026-10-24', 12 * 60 + 7, timezone);
    expect(minutesOfDay(moved.startAt, timezone)).toBe(12 * 60);
    expect(new Date(moved.endAt).getTime() - new Date(moved.startAt).getTime()).toBe(120 * 60_000);
  });

  it('resizes to a snapped end', () => {
    const resized = resizeItem(base, 11 * 60 + 8, timezone);
    expect(minutesOfDay(resized.endAt, timezone)).toBe(11 * 60 + 15);
  });

  it('enforces a 15 minute minimum duration', () => {
    const resized = resizeItem(base, 8 * 60, timezone);
    expect(new Date(resized.endAt).getTime() - new Date(resized.startAt).getTime()).toBe(15 * 60_000);
  });

  it('validates manual item edits using the same snap and minimum rules', () => {
    const edited = editTripItem(base, { title: ' Updated ', startMinutes: 601, endMinutes: 603 }, timezone);
    expect(edited.title).toBe('Updated');
    expect(minutesOfDay(edited.startAt, timezone)).toBe(600);
    expect(minutesOfDay(edited.endAt, timezone)).toBe(615);
  });
});

describe('itinerary queries', () => {
  it('filters by local date', () => {
    const next = { ...base, id: 'b', startAt: '2026-10-24T16:00:00.000Z', endAt: '2026-10-24T17:00:00.000Z' };
    expect(itemsForDate([base, next], '2026-10-24', timezone).map((item) => item.id)).toEqual(['a']);
  });

  it('detects each overlapping item', () => {
    const overlap = { ...base, id: 'b', startAt: '2026-10-24T01:30:00.000Z', endAt: '2026-10-24T02:30:00.000Z' };
    const adjacent = { ...base, id: 'c', startAt: '2026-10-24T02:00:00.000Z', endAt: '2026-10-24T03:00:00.000Z' };
    expect([...overlappingIds([base, overlap, adjacent])].sort()).toEqual(['a', 'b', 'c']);
    expect([...overlappingIds([base, adjacent])]).toEqual([]);
  });
});
