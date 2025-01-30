import React, { useEffect, useRef, useState } from 'react';
import { SafeAreaView, StyleSheet, Text, View, Alert, Button, BackHandler } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import NetInfo from '@react-native-community/netinfo';
import { WebView } from 'react-native-webview';

const BASE_URL = 'https://v1-base.appizap.com/apps/6736efb976f2383639476046/view';
const CACHE_KEY_PREFIX = 'webview_cache_';
const LAST_URL_KEY = 'last_visited_url';
const CHUNK_SIZE = 400 * 1024; // Reduced to 400KB chunks to avoid storage issues
const CACHE_EXPIRY = 7 * 24 * 60 * 60 * 1000; // 7 days cache expiry

const App = () => {
  const [cachedPage, setCachedPage] = useState<{
    html: string;
    resources: Record<string, string>;
    timestamp: number;
  } | null>(null);
  const [isOnline, setIsOnline] = useState(true);
  const [isInitialLoad, setIsInitialLoad] = useState(true);
  const [shouldUseCache, setShouldUseCache] = useState(false);
  const [currentUrl, setCurrentUrl] = useState(BASE_URL);
  const webViewRef = useRef<WebView | null>(null);
  const [hasError, setHasError] = useState(false);
  const lastNavigationRef = useRef<string>('');

   // Load last URL on startup and monitor changes
   useEffect(() => {
    const loadLastUrl = async () => {
      try {
        console.log('Loading last URL from storage');
        const savedUrl = await AsyncStorage.getItem(LAST_URL_KEY);
        console.log('Saved URL:', savedUrl);
        if (savedUrl && savedUrl !== BASE_URL) {
          setCurrentUrl(savedUrl);
        }
      } catch (error) {
        console.error('Error loading last URL:', error);
      }
    };
    loadLastUrl();
  }, []);

  // Update WebView source when currentUrl changes
  useEffect(() => {
    console.log('Current URL changed:', currentUrl);
  }, [currentUrl]);

  useEffect(() => {
    const unsubscribe = NetInfo.addEventListener(state => {
      const newIsOnline = state.isConnected ?? false;
      setIsOnline(newIsOnline);
      if (!newIsOnline && cachedPage) {
        setShouldUseCache(true);
      }
      if (newIsOnline && shouldUseCache) {
        setShouldUseCache(false);
        refreshContent();
      }
    });
    return () => unsubscribe();
  }, [cachedPage, shouldUseCache]);

  useEffect(() => {
    const initializeApp = async () => {
      const networkState = await NetInfo.fetch();
      setIsOnline(networkState.isConnected ?? false);
      await loadCachedContent();
      setIsInitialLoad(false);
    };
    initializeApp();
    const backHandler = BackHandler.addEventListener('hardwareBackPress', handleBackButton);
    return () => backHandler.remove();
  }, []);

  // Enhanced cache management
  const manageCacheStorage = async () => {
    try {
      const keys = await AsyncStorage.getAllKeys();
      const cacheKeys = keys.filter(key => key.startsWith(CACHE_KEY_PREFIX));

      if (cacheKeys.length > 10) { // Keep only last 10 cached pages
        const sortedKeys = cacheKeys.sort();
        const keysToRemove = sortedKeys.slice(0, -10);
        await AsyncStorage.multiRemove(keysToRemove);
      }
    } catch (error) {
      console.error('Cache management error:', error);
    }
  };

  // Split string into chunks
  const chunkString = (str: string, size: number): string[] => {
    const chunks: string[] = [];
    for (let i = 0; i < str.length; i += size) {
      chunks.push(str.slice(i, i + size));
    }
    return chunks;
  };

  // Store data in chunks
  const storeDataInChunks = async (key: string, value: string) => {
    try {
      // Basic compression by removing unnecessary whitespace
      const compressedValue = value.replace(/\s+/g, ' ');
      const chunks = chunkString(compressedValue, CHUNK_SIZE);

      // Clear existing chunks before storing new ones
      await clearCache(key);

      await AsyncStorage.setItem(`${key}_chunks`, chunks.length.toString());
      for (let i = 0; i < chunks.length; i++) {
        await AsyncStorage.setItem(`${key}_chunk_${i}`, chunks[i]);
      }
    } catch (error) {
      if (error instanceof Error && error.toString().includes('SQLITE_FULL')) {
        await manageCacheStorage();
        // Retry storage after clearing
        const chunks = chunkString(value, CHUNK_SIZE);
        await AsyncStorage.setItem(`${key}_chunks`, chunks.length.toString());
        for (let i = 0; i < chunks.length; i++) {
          await AsyncStorage.setItem(`${key}_chunk_${i}`, chunks[i]);
        }
      } else {
        console.error('Error storing chunks:', error);
        throw error;
      }
    }
  };

  // Load data from chunks
  const loadDataFromChunks = async (key: string): Promise<string | null> => {
    try {
      const numChunks = await AsyncStorage.getItem(`${key}_chunks`);
      if (!numChunks) return null;

      const chunks: string[] = [];
      for (let i = 0; i < parseInt(numChunks, 10); i++) {
        const chunk = await AsyncStorage.getItem(`${key}_chunk_${i}`);
        if (chunk) chunks.push(chunk);
      }

      return chunks.join('');
    } catch (error) {
      console.error('Error loading chunks:', error);
      return null;
    }
  };

  const handleBackButton = () => {
    // if (webViewRef.current) {
    //   webViewRef.current.goBack();
    //   return true;
    // }
    Alert.alert(
      'Exit App',
      'Are you sure you want to exit?',
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'OK', onPress: () => BackHandler.exitApp() }
      ],
      { cancelable: false }
    );
    return true;
  };

  const refreshContent = async () => {
    if (webViewRef.current && isOnline) {
      setHasError(false);
      setShouldUseCache(false);
      webViewRef.current.reload();
    }
  };

  const loadCachedContent = async () => {
    try {
      const cachedData = await loadDataFromChunks(CACHE_KEY_PREFIX + 'full_page');
      if (cachedData) {
        const parsed = JSON.parse(cachedData);
        if (Date.now() - parsed.timestamp < 24 * 60 * 60 * 1000) {
          setCachedPage(parsed);
          if (!isOnline) {
            setShouldUseCache(true);
          }
        } else {
          // Clear expired cache
          await clearCache(CACHE_KEY_PREFIX + 'full_page');
        }
      }
    } catch (error) {
      console.error('Cache loading error:', error);
    }
  };

  const clearCache = async (key: string) => {
    try {
      const numChunks = await AsyncStorage.getItem(`${key}_chunks`);
      if (numChunks) {
        for (let i = 0; i < parseInt(numChunks, 10); i++) {
          await AsyncStorage.removeItem(`${key}_chunk_${i}`);
        }
        await AsyncStorage.removeItem(`${key}_chunks`);
      }
    } catch (error) {
      console.error('Error clearing cache:', error);
    }
  };

  const handleMessage = async (event: { nativeEvent: { data: string; }; }) => {
    try {
      const message = JSON.parse(event.nativeEvent.data);
      if (message.type === 'cachePage') {
        await cachePageContent(message);
      } else if (message.type === 'updateUrl') {
        console.log('Received URL update:', message.url);
        if (message.url && message.url !== BASE_URL) {
          setCurrentUrl(message.url);
          await AsyncStorage.setItem(LAST_URL_KEY, message.url);
        }
      }
    } catch (error) {
      console.error('Error processing message:', error);
    }
  };

  const cachePageContent = async (message: any) => {
    try {
      let modifiedHtml = message.html;

      // Ensure all resources are embedded inline
      modifiedHtml = modifiedHtml.replace(
        /<link[^>]+href="([^"]+)"[^>]*>/g,
        (match: any, href: string | number) => {
          const cssContent = message.resources[href];
          return cssContent ? `<style>${cssContent}</style>` : '';
        }
      );

      modifiedHtml = modifiedHtml.replace(
        /src="(https?:\/\/[^"]+)"/g,
        (match: any, resourceUrl: string) => {
          const base64Resource = message.resources[resourceUrl];
          return base64Resource ?
            `src="data:image/png;base64,${base64Resource}"` :
            'src="data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII="'; // 1px placeholder
        }
      );

      const pageCache = {
        html: modifiedHtml,
        resources: message.resources,
        timestamp: Date.now()
      };

      await storeDataInChunks(
        CACHE_KEY_PREFIX + 'full_page',
        JSON.stringify(pageCache)
      );
      setCachedPage(pageCache);
    } catch (error) {
      console.error('Error caching page:', error);
    }
  };

  const injectedJavaScript = `
    (function() {
      let lastUrl = '';

      function checkAndUpdateUrl() {
        const currentUrl = window.location.href;
        if (currentUrl && currentUrl !== lastUrl) {
          lastUrl = currentUrl;
          window.ReactNativeWebView.postMessage(JSON.stringify({
            type: 'updateUrl',
            url: currentUrl
          }));
        }
      }

      // Enhance page caching
      async function cachePage() {
        const resources = {};
        const promises = [];

        // Cache images with size limit
        const images = Array.from(document.getElementsByTagName('img'))
          .filter(img => img.src && img.src.startsWith('http'));

        for (let img of images) {
          if (img.complete && img.naturalWidth < 1000 && img.naturalHeight < 1000) {
            promises.push(
              fetch(img.src)
                .then(response => response.blob())
                .then(blob => new Promise((resolve, reject) => {
                  const reader = new FileReader();
                  reader.onloadend = () => {
                    const base64data = reader.result?.toString() || '';
                    resources[img.src] = base64data.split(',')[1];
                    resolve();
                  };
                  reader.onerror = reject;
                  reader.readAsDataURL(blob);
                }))
                .catch(error => console.error('Image cache error:', error))
            );
          }
        }

        // Cache stylesheets
        const styles = Array.from(document.getElementsByTagName('link'))
          .filter(link => link.rel === 'stylesheet' && link.href.startsWith('http'));

        for (let style of styles) {
          promises.push(
            fetch(style.href)
              .then(response => response.text())
              .then(cssText => {
                resources[style.href] = cssText;
              })
              .catch(error => console.error('Stylesheet cache error:', error))
          );
        }

        await Promise.all(promises);

        window.ReactNativeWebView.postMessage(JSON.stringify({
          type: 'cachePage',
          html: document.documentElement.outerHTML,
          resources: resources
        }));
      }

      window.addEventListener('load', () => {
        setTimeout(() => {
          checkAndUpdateUrl();
          cachePage();
        }, 1000);
      });

      // Reduced frequency of cache updates
      setInterval(cachePage, 600000); // 10 minutes
      setInterval(checkAndUpdateUrl, 2000); // 2 seconds
    })();
    true;
  `;

  const getWebViewSource = () => {
    if (!shouldUseCache && isOnline) {
      console.log('inside webview source:', currentUrl);
      const urlToUse = (currentUrl && currentUrl !== 'about:blank') ? currentUrl : BASE_URL;
      console.log('Using URL:', urlToUse);
      return { uri: urlToUse };
    }
    console.log('cached kssk:', cachedPage)
    if (cachedPage?.html) {
      return {
        html: cachedPage.html,
        baseUrl: BASE_URL
      };
    }
    return {
      html: `
        <div style="display:flex;justify-content:center;align-items:center;height:100vh;font-family:sans-serif;">
          <h2>No cached content available</h2>
        </div>
      `
    };
  };

  const handleNavigationStateChange = async (navState: { url: string }) => {
    console.log('Navigation state changed:', navState.url);
    if (navState.url && navState.url !== BASE_URL) {
      setCurrentUrl(navState.url);
      try {
        await AsyncStorage.setItem(LAST_URL_KEY, navState.url);
      } catch (error) {
        console.error('Error saving URL:', error);
      }
    }
  };

  const handleWebViewError = (syntheticEvent: any) => {
    const { nativeEvent } = syntheticEvent;
    console.error('WebView error:', nativeEvent);
    if (cachedPage && nativeEvent.code === -2) {
      setShouldUseCache(true);
      setHasError(false);
    } else {
      setHasError(true);
    }
  };

  return (
    <SafeAreaView style={styles.container}>
      {hasError && (!cachedPage || !shouldUseCache) ? (
        <View style={styles.errorContainer}>
          <Text style={styles.errorText}>
            {isInitialLoad ?
              'Loading...' :
              'Unable to load content. Please check your connection.'}
          </Text>
          <Button title="Retry" onPress={refreshContent} />
        </View>
      ) : (
        <WebView
          ref={webViewRef}
          source={getWebViewSource()}
          onMessage={handleMessage}
          injectedJavaScript={injectedJavaScript}
          javaScriptEnabled={true}
          domStorageEnabled={true}
          style={styles.webview}
          allowFileAccess={true}
          allowUniversalAccessFromFileURLs={true}
          startInLoadingState={true}
          onError={handleWebViewError}
          onNavigationStateChange={handleNavigationStateChange}
          onHttpError={(syntheticEvent) => {
            const { nativeEvent } = syntheticEvent;
            console.error('HTTP error:', nativeEvent);
          }}
          onLoadEnd={() => {
            if (isOnline && !shouldUseCache) {
              setHasError(false);
            }
          }}
        />
      )}
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1
  },
  webview: {
    flex: 1
  },
  errorContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 20,
    backgroundColor: '#F8F9FA'
  },
  errorText: {
    fontSize: 16,
    marginBottom: 20,
    textAlign: 'center',
    color: '#6C757D'
  }
});

export default App;