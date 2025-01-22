import React, { useState, useEffect, useRef } from 'react';
import { StyleSheet, SafeAreaView, ActivityIndicator, BackHandler, Alert } from 'react-native';
import { WebView } from 'react-native-webview';
import AsyncStorage from '@react-native-async-storage/async-storage';
import NetInfo from '@react-native-community/netinfo'; // Import NetInfo

const CACHE_KEY = 'webviewCache';
const JWT_TOKEN_KEY = 'jwtToken';
const BASE_URL = 'https://v1-base.appizap.com/apps/6736efb976f2383639476046/view';

const App = () => {
  const [loading, setLoading] = useState(true);
  const [cachedContent, setCachedContent] = useState('');
  const [isOnline, setIsOnline] = useState(true);
  const [jwtToken, setJwtToken] = useState<string | null>(null);
  const webViewRef = useRef<WebView | null>(null);

  useEffect(() => {
    loadStoredData();
    const unsubscribeNetworkListener = setupNetworkListener();
    const unsubscribeBackHandler = setupBackHandler();

    return () => {
      // Cleanup listeners on unmount
      unsubscribeNetworkListener();
      unsubscribeBackHandler();
    };
  }, []);

  const loadStoredData = async () => {
    try {
      const [cached, token] = await Promise.all([
        AsyncStorage.getItem(CACHE_KEY),
        AsyncStorage.getItem(JWT_TOKEN_KEY),
      ]);

      if (cached) setCachedContent(cached);
      if (token) {
        setJwtToken(token);
        // Inject token into localStorage when WebView loads
        injectToken(token);
      }
    } catch (error) {
      console.error('Error loading stored data:', error);
    }
  };

  const clearToken = async () => {
    try {
      await AsyncStorage.removeItem(JWT_TOKEN_KEY);
      setJwtToken(null);

      const clearScript = `
        localStorage.removeItem('token');
        sessionStorage.removeItem('token');
        true;
      `;
      webViewRef.current?.injectJavaScript(clearScript);

      webViewRef.current?.reload();
    } catch (error) {
      console.error('Error clearing token:', error);
    }
  };

  const injectToken = (token: string) => {
    const tokenInjectionScript = `
      localStorage.setItem('token', '${token}');
      window.originalFetch = window.fetch;
      window.fetch = function(url, options = {}) {
        options.headers = options.headers || {};
        options.headers['Authorization'] = 'Bearer ${token}';
        return window.originalFetch(url, options);
      };

      var originalXHROpen = XMLHttpRequest.prototype.open;
      XMLHttpRequest.prototype.open = function() {
        this.addEventListener('load', function() {
          try {
            const responseData = JSON.parse(this.responseText);
            if (responseData.token || responseData.access_token) {
              window.ReactNativeWebView.postMessage(JSON.stringify({
                type: 'token',
                data: responseData.token || responseData.access_token,
              }));
            }
          } catch (e) {}
        });
        originalXHROpen.apply(this, arguments);
        this.setRequestHeader('Authorization', 'Bearer ${token}');
      };
      true;
    `;
    webViewRef.current?.injectJavaScript(tokenInjectionScript);
  };

  const setupNetworkListener = () => {
    // Listen for network state changes
    const unsubscribe = NetInfo.addEventListener(state => {
      setIsOnline(state.isConnected ?? false);
    });

    return unsubscribe; // Return the unsubscribe function for cleanup
  };

  const setupBackHandler = () => {
    const backAction = () => {
      Alert.alert('Hold on!', 'Are you sure you want to exit the app?', [
        { text: 'Cancel', onPress: () => null, style: 'cancel' },
        { text: 'YES', onPress: () => BackHandler.exitApp() },
      ]);
      return true;
    };

    const backHandler = BackHandler.addEventListener(
      'hardwareBackPress',
      backAction,
    );

    return () => backHandler.remove();
  };

  const handleLoadEnd = () => {
    setLoading(false);
    if (jwtToken) {
      injectToken(jwtToken);
    }
  };

  const cacheContent = async (content: string) => {
    try {
      await AsyncStorage.setItem(CACHE_KEY, content);
    } catch (error) {
      console.error('Caching error:', error);
    }
  };

  const handleMessage = async (event: any) => {
    try {
      const message = JSON.parse(event.nativeEvent.data);

      switch (message.type) {
        case 'token':
          const newToken = message.data;
          setJwtToken(newToken);
          await AsyncStorage.setItem(JWT_TOKEN_KEY, newToken);
          injectToken(newToken);
          break;
        case 'logout':
          await clearToken();
          break;
        default:
          await cacheContent(event.nativeEvent.data);
      }
    } catch (error) {
      await cacheContent(event.nativeEvent.data);
    }
  };

  const injectedJavaScript = `
    (function() {
      function cachePage() {
        window.ReactNativeWebView.postMessage(document.documentElement.outerHTML);
      }

      window.addEventListener('load', () => {
        cachePage();
        const token = localStorage.getItem('token');
        if (token) {
          window.ReactNativeWebView.postMessage(JSON.stringify({
            type: 'token',
            data: token,
          }));
        }
      });

      new MutationObserver(cachePage).observe(
        document.documentElement,
        { childList: true, subtree: true },
      );
    })();
    true;
  `;

  return (
    <SafeAreaView style={styles.container}>
      {loading && (
        <ActivityIndicator
          style={styles.loading}
          size="large"
          color="#0000ff"
        />
      )}
      <WebView
        ref={webViewRef}
        source={
          isOnline
            ? { uri: BASE_URL }
            : { html: cachedContent || '<h1>No cached content available</h1>' }
        }
        onLoadEnd={handleLoadEnd}
        onMessage={handleMessage}
        injectedJavaScript={injectedJavaScript}
        javaScriptEnabled={true}
        domStorageEnabled={true}
        style={styles.webview}
      />
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    marginTop: 20,
  },
  webview: {
    flex: 1,
  },
  loading: {
    position: 'absolute',
    top: '50%',
    left: '50%',
    transform: [{ translateX: -25 }, { translateY: -25 }],
  },
});

export default App;
