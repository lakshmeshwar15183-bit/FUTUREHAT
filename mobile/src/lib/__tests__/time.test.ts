// Real unit tests for time formatting. Dates are built from LOCAL components and
// round-tripped through toISOString(), so assertions hold regardless of the
// machine timezone (the functions format in local time).
import {
  formatTime,
  isSameCalendarDay,
  formatLastSeen,
} from '../time';

const localIso = (y: number, mo: number, d: number, h: number, mi: number) =>
  new Date(y, mo, d, h, mi, 0, 0).toISOString();

describe('formatTime', () => {
  it('formats 12-hour clock with AM/PM', () => {
    expect(formatTime(localIso(2024, 0, 1, 14, 30))).toBe('2:30 PM');
    expect(formatTime(localIso(2024, 0, 1, 0, 5))).toBe('12:05 AM');
    expect(formatTime(localIso(2024, 0, 1, 12, 0))).toBe('12:00 PM');
    expect(formatTime(localIso(2024, 0, 1, 9, 7))).toBe('9:07 AM');
  });

  it('returns empty string for missing input', () => {
    expect(formatTime(null)).toBe('');
    expect(formatTime(undefined)).toBe('');
  });
});

describe('isSameCalendarDay', () => {
  it('is true for two times on the same local day', () => {
    expect(isSameCalendarDay(localIso(2024, 5, 10, 1, 0), localIso(2024, 5, 10, 23, 0))).toBe(true);
  });

  it('is false across days and for missing input', () => {
    expect(isSameCalendarDay(localIso(2024, 5, 10, 1, 0), localIso(2024, 5, 11, 1, 0))).toBe(false);
    expect(isSameCalendarDay(null, localIso(2024, 5, 10, 1, 0))).toBe(false);
    expect(isSameCalendarDay(localIso(2024, 5, 10, 1, 0), null)).toBe(false);
  });
});

describe('formatLastSeen', () => {
  beforeAll(() => {
    jest.useFakeTimers();
    jest.setSystemTime(new Date(2024, 0, 1, 12, 0, 0));
  });
  afterAll(() => {
    jest.useRealTimers();
  });

  it('shows "online" under a minute', () => {
    expect(formatLastSeen(new Date(2024, 0, 1, 11, 59, 30).toISOString())).toBe('online');
  });

  it('shows minutes then hours', () => {
    expect(formatLastSeen(new Date(2024, 0, 1, 11, 30, 0).toISOString())).toBe('last seen 30m ago');
    expect(formatLastSeen(new Date(2024, 0, 1, 9, 0, 0).toISOString())).toBe('last seen 3h ago');
  });

  it('returns empty string for missing input', () => {
    expect(formatLastSeen(null)).toBe('');
  });
});
