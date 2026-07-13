// Pure helper tests — avoid importing expo-file-system (Jest ESM).
function isDirectlyLoadableUri(uri: string | null | undefined): boolean {
  if (!uri) return false;
  return (
    uri.startsWith('file://') ||
    uri.startsWith('data:') ||
    uri.startsWith('http://') ||
    uri.startsWith('https://') ||
    uri.startsWith('asset:/') ||
    uri.startsWith('assets-library:')
  );
}

describe('isDirectlyLoadableUri', () => {
  it('accepts file/data/http', () => {
    expect(isDirectlyLoadableUri('file:///data/user/0/x/cache/a.jpg')).toBe(true);
    expect(isDirectlyLoadableUri('data:image/jpeg;base64,xx')).toBe(true);
    expect(isDirectlyLoadableUri('https://cdn.example/a.jpg')).toBe(true);
  });

  it('rejects content:// and empty (need materialize)', () => {
    expect(isDirectlyLoadableUri('content://media/external/images/media/1')).toBe(false);
    expect(isDirectlyLoadableUri('')).toBe(false);
    expect(isDirectlyLoadableUri(null)).toBe(false);
    expect(isDirectlyLoadableUri(undefined)).toBe(false);
  });
});
