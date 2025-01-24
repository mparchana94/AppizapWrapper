import React, { useEffect, useRef, useState } from 'react';
import { SafeAreaView, StyleSheet, Text, View, Alert, Button, BackHandler} from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import NetInfo from '@react-native-community/netinfo';
import { WebView } from 'react-native-webview';

const BASE_URL = 'https://v1-base.appizap.com/apps/6736efb976f2383639476046/view';
const CACHE_KEY_PREFIX = 'webview_cache_';

const App = () => {
  const [cachedPage, setCachedPage] = useState<{
    html: string;
    resources: Record<string, string>;
  } | null>(null);
  const [isOnline, setIsOnline] = useState(true);
  const webViewRef = useRef(null);
  const [hasError, setHasError] = useState(false); // Track if there's an error
  const [reloadKey, setReloadKey] = useState(0); // Force reload with a unique key

  const handleBackButton = () => {
    Alert.alert(
      'Exit App',
      'Are you sure you want to exit?',
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'OK', onPress: () => BackHandler.exitApp() },
      ],
      { cancelable: false }
    );
    return true;
  };

  const clearAsyncStorage = async () => {
    try {
      await AsyncStorage.clear();
    } catch (error) {
      console.error('Error clearing AsyncStorage:', error);
    }
  };

  useEffect(() => {
    checkNetworkStatus();
    loadCachedContent();
    // clearAsyncStorage();
    const interval = setInterval(checkNetworkStatus, 5000);
    const backHandler = BackHandler.addEventListener('hardwareBackPress', handleBackButton);
   
    return () => {
      clearInterval(interval);
      backHandler.remove();
    };
  }, []);

  const checkNetworkStatus = () => {
    NetInfo.fetch().then((state) => {
      setIsOnline(state.isConnected ?? false);
    }).catch((error) => {
      console.error('Network check error:', error);
      setIsOnline(false); // Set offline if there's an error
    });
  };

  const loadCachedContent = async () => {
    try {
      const cachedData = await AsyncStorage.getItem(CACHE_KEY_PREFIX + 'full_page');
      if (cachedData) {
        setCachedPage(JSON.parse(cachedData));
      }
    } catch (error) {
      console.error('Cache loading error:', error);
    }
  };

  const handleMessage = async (event: { nativeEvent: { data: string; }; }) => {
    try {
      const message = JSON.parse(event.nativeEvent.data);
      if (message.type === 'cachePage') {
        let modifiedHtml = message.html;

        // Replace image URLs with Base64 data
        modifiedHtml = modifiedHtml.replace(
          /src="(https?:\/\/[^"]+)"/g,
          (match: any, resourceUrl: string | number) => {
            const base64Resource = message.resources[resourceUrl];
            if (base64Resource) {
              return `src="data:image/png;base64,${base64Resource}"`;
            }
            console.warn(`Image not cached: ${resourceUrl}`);
            return match; // Keep the original URL if not cached
          }
        );

        // Inline CSS content
        const cssResources = Object.entries(message.resources)
          .filter(([url]) => url.endsWith('.css'))
          .map(([url, content]) => `<style>${content}</style>`);
        modifiedHtml = modifiedHtml.replace(
          '</head>',
          cssResources.join('\n') + '</head>'
        );

        // Save the modified page to cache
        const pageCache = { html: modifiedHtml, resources: message.resources };
        await AsyncStorage.setItem(CACHE_KEY_PREFIX + 'full_page', JSON.stringify(pageCache));
        setCachedPage(pageCache);

        console.log('Cached page successfully:', pageCache);
      }
    } catch (error) {
      console.error('Error processing cached page:', error);
    }
  };

  const injectedJavaScript = `
    (function() {
      function getBase64Image(url) {
        return new Promise((resolve, reject) => {
          const img = new Image();
          img.crossOrigin = 'Anonymous';
          img.onload = function() {
            const canvas = document.createElement('canvas');
            canvas.width = img.width;
            canvas.height = img.height;
            const ctx = canvas.getContext('2d');
            ctx.drawImage(img, 0, 0);
            const dataURL = canvas.toDataURL('image/png');
            resolve(dataURL.replace(/^data:image\\/png;base64,/, ''));
          };
          img.onerror = reject;
          img.src = url;
        });
      }

      async function cachePage() {
        const resources = {};

        const images = document.getElementsByTagName('img');
        for (let img of images) {
          if (img.src && img.src.startsWith('http')) {
            try {
              const base64 = await getBase64Image(img.src);
              resources[img.src] = base64;
            } catch (error) {
              console.error('Failed to cache image:', img.src);
            }
          }
        }

        const styles = document.getElementsByTagName('link');
        for (let style of styles) {
          if (style.rel === 'stylesheet' && style.href.startsWith('http')) {
            try {
              const response = await fetch(style.href);
              const cssText = await response.text();
              resources[style.href] = cssText;
            } catch (error) {
              console.error('Failed to cache stylesheet:', style.href);
            }
          }
        }

        window.ReactNativeWebView.postMessage(JSON.stringify({
          type: 'cachePage',
          html: document.documentElement.outerHTML,
          resources: resources
        }));
      }

      if (document.readyState === 'complete') {
        setTimeout(cachePage, 1000);
      } else {
        window.addEventListener('load', () => setTimeout(cachePage, 1000));
      }
    })();
    true;
  `;

  const getWebViewSource = () => {
    if (isOnline) {
      return { uri: BASE_URL };
    } else if (cachedPage){
      console.log('I have cached Page here')
      return {
        html: cachedPage.html,
        baseUrl: BASE_URL,
      };
    }
    console.log('CAChed is empty/null just check')
    return { html: '<h1>No cached content available</h1>' };
  };

  console.log('Is Online:', isOnline);
  console.log('Cached Page:', cachedPage);

  const handleWebViewError = (syntheticEvent: any) => {
    const { nativeEvent } = syntheticEvent;
    console.error('WebView error: ', nativeEvent);
    setHasError(true);
    Alert.alert('Error', 'Failed to load the content. Please check your network.');
    // Alert.alert('Error', `Failed to load content: ${nativeEvent.description}`);
  };

  const reloadWebView = () => {
    setHasError(false);
    setReloadKey((prevKey) => prevKey + 1); // Increment key to reload WebView
  };

  return (
    <SafeAreaView style={styles.container}>
      {hasError || (!isOnline && !cachedPage) ? (
        <View style={styles.errorContainer}>
          <Text style={styles.errorText}>Failed to load content. Please check your internet connection or try again later.</Text>
          <Button title="Reload" onPress={reloadWebView} />
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
        onError={handleWebViewError} // Handle load errors
        onHttpError={(syntheticEvent) => {
          const { nativeEvent } = syntheticEvent;
          console.error('HTTP error: ', nativeEvent);
        }}
      />
      )}
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  container: { flex: 1 },
  webview: { flex: 1 },
  cacheInfo: {
    padding: 10,
    backgroundColor: 'lightgreen',
  },
  errorContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: '#F8D7DA',
  },
  errorText: {
    fontSize: 16,
    marginBottom: 10,
    color: '#721C24',
  },
});

export default App;