// Lumixo mobile — root entry. Polyfills must load before anything touches
// Supabase realtime / fetch URL parsing on React Native.
import 'react-native-gesture-handler';
import 'react-native-url-polyfill/auto';
import { registerRootComponent } from 'expo';

import App from './App';

registerRootComponent(App);
