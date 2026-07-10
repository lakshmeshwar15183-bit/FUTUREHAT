// Lumixo mobile — Jest test environment setup

// Mock react-native
jest.mock('react-native', () => ({
  Platform: {
    OS: 'android',
    select: jest.fn((obj) => obj.android),
  },
  Alert: {
    alert: jest.fn(),
  },
  Animated: {
    Value: jest.fn(() => ({
      setValue: jest.fn(),
      addListener: jest.fn(),
      removeListener: jest.fn(),
    })),
    createValue: jest.fn(() => ({ setValue: jest.fn() })),
  },
  StyleSheet: {
    create: jest.fn((x) => x),
  },
}));

// Mock Expo modules
jest.mock('expo', () => ({
  Constants: {
    expoConfig: { version: '4.1.5' },
  },
}));

jest.mock('expo-notifications', () => ({
  getPermissionsAsync: jest.fn(async () => ({ status: 'granted' })),
  requestPermissionsAsync: jest.fn(async () => ({ status: 'granted' })),
  scheduleNotificationAsync: jest.fn(async () => 'notification-id'),
  dismissNotificationAsync: jest.fn(async () => {}),
  setNotificationHandler: jest.fn(),
  addNotificationResponseReceivedListener: jest.fn(() => ({ remove: jest.fn() })),
}));

jest.mock('expo-file-system', () => ({
  EncodingType: { Base64: 'base64' },
  readAsStringAsync: jest.fn(async () => 'base64-data'),
}));

jest.mock('expo-image-picker', () => ({
  requestMediaLibraryPermissionsAsync: jest.fn(async () => ({ granted: true })),
  launchImageLibraryAsync: jest.fn(async () => ({
    canceled: false,
    assets: [{ uri: 'file:///image.jpg' }],
  })),
}));

// Mock Supabase
jest.mock('@supabase/supabase-js', () => ({
  createClient: jest.fn(() => ({
    auth: {
      getSession: jest.fn(async () => ({ data: { session: { access_token: 'mock-token' } } })),
      onAuthStateChange: jest.fn(() => ({ data: { subscription: { unsubscribe: jest.fn() } } })),
    },
    from: jest.fn(() => ({
      select: jest.fn().mockReturnThis(),
      insert: jest.fn().mockReturnThis(),
      update: jest.fn().mockReturnThis(),
      delete: jest.fn().mockReturnThis(),
      eq: jest.fn().mockReturnThis(),
      single: jest.fn(async () => ({ data: {}, error: null })),
    })),
    storage: {
      from: jest.fn(() => ({
        upload: jest.fn(async () => ({ data: { path: 'file.jpg' }, error: null })),
        getPublicUrl: jest.fn(() => ({ data: { publicUrl: 'https://example.com/file.jpg' } })),
      })),
    },
    realtime: {
      on: jest.fn(),
    },
  })),
}));

jest.mock('@react-native-async-storage/async-storage', () => ({
  getItem: jest.fn(async () => null),
  setItem: jest.fn(async () => {}),
  removeItem: jest.fn(async () => {}),
}));

jest.mock('react-native-reanimated', () => ({
  Value: jest.fn(() => ({ setValue: jest.fn() })),
  event: jest.fn((e) => e),
  add: jest.fn((a, b) => a),
  multiply: jest.fn((a, b) => a),
  sub: jest.fn((a, b) => a),
  div: jest.fn((a, b) => a),
  abs: jest.fn((v) => v),
  max: jest.fn((a, b) => a),
  min: jest.fn((a, b) => a),
  cond: jest.fn((c, t, f) => t),
  useAnimatedStyle: jest.fn(() => ({ opacity: 1 })),
  useSharedValue: jest.fn((v) => v),
  useAnimatedReaction: jest.fn(),
  runOnJS: jest.fn((f) => f),
  withTiming: jest.fn((v) => v),
  Easing: { ease: jest.fn(() => 0.5) },
}));

jest.mock('react-native-gesture-handler', () => ({
  GestureHandler: jest.fn(),
  TapGestureHandler: jest.fn(),
  PanGestureHandler: jest.fn(),
  PinchGestureHandler: jest.fn(),
  LongPressGestureHandler: jest.fn(),
  GestureHandlerRootView: jest.fn(({ children }) => children),
}));

jest.mock('@react-navigation/native', () => ({
  useNavigation: jest.fn(() => ({
    navigate: jest.fn(),
    goBack: jest.fn(),
  })),
  useRoute: jest.fn(() => ({ params: {} })),
  useIsFocused: jest.fn(() => true),
}));

jest.mock('@react-navigation/native-stack', () => ({
  createNativeStackNavigator: jest.fn(() => ({
    Navigator: jest.fn(),
    Screen: jest.fn(),
  })),
}));

// Global test utilities
global.fetch = jest.fn();

// Suppress console warnings in tests
const originalError = console.error;
beforeAll(() => {
  console.error = (...args) => {
    if (
      typeof args[0] === 'string' &&
      (args[0].includes('Non-serializable values') ||
        args[0].includes('componentWillReceiveProps'))
    ) {
      return;
    }
    originalError.call(console, ...args);
  };
});

afterAll(() => {
  console.error = originalError;
});
