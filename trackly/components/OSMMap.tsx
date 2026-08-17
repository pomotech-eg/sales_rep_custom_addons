import React, { useRef, useEffect } from 'react';
import { View, StyleSheet, ActivityIndicator, DimensionValue } from 'react-native';
import { WebView } from 'react-native-webview';

interface OSMMapProps {
    latitude?: number;
    longitude?: number;
    isStatic?: boolean;
    onRegionChange?: (region: { latitude: number; longitude: number }) => void;
    height?: DimensionValue;
    zoom?: number;
    radius?: number;
    userLocation?: { latitude: number; longitude: number } | null;
    onMapTouchStart?: () => void;
    onMapTouchEnd?: () => void;
}

const OSMMap: React.FC<OSMMapProps> = ({
    latitude,
    longitude,
    isStatic = false,
    onRegionChange,
    height = 200,
    zoom = 15,
    radius = 0,
    userLocation = null, // { latitude, longitude }
    onMapTouchStart,
    onMapTouchEnd
}) => {
    const webViewRef = useRef<WebView>(null);

    // Default to Cairo if no coordinates provided
    const initialLat = latitude || 30.0444;
    const initialLng = longitude || 31.2357;
    const initialRadius = radius || 0;

    // User location defaults
    const userLat = userLocation?.latitude || 0;
    const userLng = userLocation?.longitude || 0;
    const hasUserLocation = !!userLocation;

    useEffect(() => {
        if (webViewRef.current) {
            // Send update to the WebView when props change
            const message = JSON.stringify({
                type: 'UPDATE_LOCATION',
                payload: {
                    lat: initialLat,
                    lng: initialLng,
                    radius: initialRadius,
                    userLat: userLat,
                    userLng: userLng,
                    hasUserLocation: hasUserLocation
                }
            });
            webViewRef.current.postMessage(message);
        }
    }, [latitude, longitude, radius, userLocation]);

    const htmlContent = `
    <!DOCTYPE html>
    <html>
      <head>
        <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no" />
        <link rel="stylesheet" href="https://unpkg.com/leaflet@1.9.4/dist/leaflet.css" integrity="sha256-p4NxAoJBhIIN+hmNHrzRCf9tD/miZyoHS5obTRR9BMY=" crossorigin=""/>
        <script src="https://unpkg.com/leaflet@1.9.4/dist/leaflet.js" integrity="sha256-20nQCchB9co0qIjJZRGuk2/Z9VM+kNiyxNV1lvTlZBo=" crossorigin=""></script>
        <style>
          body { margin: 0; padding: 0; }
          #map { width: 100%; height: 100vh; }
          .user-marker-dot {
              background-color: #4285F4;
              border: 3px solid white;
              border-radius: 50%;
              width: 18px;
              height: 18px;
              box-shadow: 0 0 0 4px rgba(66,133,244,0.3), 0 2px 8px rgba(0,0,0,0.4);
          }
        </style>
      </head>
      <body>
        <div id="map"></div>
        <script>
          var mapOptions = {
            dragging: ${!isStatic},
            touchZoom: ${!isStatic},
            doubleClickZoom: ${!isStatic},
            scrollWheelZoom: ${!isStatic},
            boxZoom: ${!isStatic},
            keyboard: ${!isStatic},
            zoomControl: ${!isStatic},
            tap: ${!isStatic}
          };
          var map = L.map('map', mapOptions).setView([${initialLat}, ${initialLng}], ${zoom});
          
          L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
            maxZoom: 19,
            attribution: '&copy; <a href="http://www.openstreetmap.org/copyright">OpenStreetMap</a>'
          }).addTo(map);

          var marker = L.marker([${initialLat}, ${initialLng}], {
            draggable: ${!isStatic}
          }).addTo(map).bindPopup('<b>Customer</b>');

          var circle = null;
          var radius = ${initialRadius};

          if (radius > 0) {
              circle = L.circle([${initialLat}, ${initialLng}], {
                  color: 'rgba(61, 59, 243, 0.5)',
                  fillColor: 'rgba(61, 59, 243, 0.2)',
                  fillOpacity: 0.5,
                  radius: radius
              }).addTo(map);
          }
          
          // User Location Marker
          var userMarker = null;
          var hasUserLoc = ${hasUserLocation};
          var userLat = ${userLat};
          var userLng = ${userLng};
          
          var userIcon = L.divIcon({
              className: 'user-marker-dot',
              iconSize: [20, 20],
              iconAnchor: [10, 10]
          });

          function fitBothMarkers() {
              if (hasUserLoc && userMarker) {
                  var bounds = L.latLngBounds(
                      [${initialLat}, ${initialLng}],
                      [userLat, userLng]
                  );
                  map.fitBounds(bounds, { padding: [50, 50], maxZoom: 17 });
              }
          }

          if (hasUserLoc) {
              userMarker = L.marker([userLat, userLng], {icon: userIcon})
                  .addTo(map)
                  .bindPopup('<b>You</b>');
              // Open the 'You' popup by default so the user sees themselves
              setTimeout(function() { userMarker.openPopup(); }, 800);
              fitBothMarkers();
          }

          // Touch handling to prevent parent scroll
          var mapDiv = document.getElementById('map');
          
          mapDiv.addEventListener('touchstart', function(e) {
             window.ReactNativeWebView.postMessage(JSON.stringify({
                 type: 'MAP_TOUCH_START'
             }));
          });

          mapDiv.addEventListener('touchend', function(e) {
             window.ReactNativeWebView.postMessage(JSON.stringify({
                 type: 'MAP_TOUCH_END'
             }));
          });

          // Handle messages from React Native
          document.addEventListener('message', function(event) {
             handleMessage(event);
          });
          window.addEventListener('message', function(event) {
             handleMessage(event);
          });

          function handleMessage(event) {
            try {
                var data = JSON.parse(event.data);
                if (data.type === 'UPDATE_LOCATION') {
                    var lat = data.payload.lat;
                    var lng = data.payload.lng;
                    var rad = data.payload.radius;
                    
                    var uLat = data.payload.userLat;
                    var uLng = data.payload.userLng;
                    var hasU = data.payload.hasUserLocation;

                    var newLatLng = new L.LatLng(lat, lng);
                    marker.setLatLng(newLatLng);

                    // Update Circle
                    if (rad > 0) {
                        if (circle) {
                            circle.setLatLng(newLatLng);
                            circle.setRadius(rad);
                        } else {
                             circle = L.circle(newLatLng, {
                                color: 'rgba(61, 59, 243, 0.5)',
                                fillColor: 'rgba(61, 59, 243, 0.2)',
                                fillOpacity: 0.5,
                                radius: rad
                            }).addTo(map);
                        }
                    } else if (circle) {
                        map.removeLayer(circle);
                        circle = null;
                    }
                    
                    // Update User Marker
                    hasUserLoc = hasU;
                    userLat = uLat;
                    userLng = uLng;
                    if (hasU) {
                         if (userMarker) {
                             userMarker.setLatLng([uLat, uLng]);
                         } else {
                             userMarker = L.marker([uLat, uLng], {icon: userIcon})
                                 .addTo(map)
                                 .bindPopup('<b>You</b>');
                         }
                         // Refit to show both
                         var bounds = L.latLngBounds(newLatLng, [uLat, uLng]);
                         map.fitBounds(bounds, { padding: [50, 50], maxZoom: 17 });
                    } else if (userMarker) {
                        map.removeLayer(userMarker);
                        userMarker = null;
                    }
                }
            } catch (e) {
                // Ignore errors
            }
          }

          // Send updates to React Native
          if (!${isStatic}) {
              marker.on('dragend', function(e) {
                var position = marker.getLatLng();
                
                // Update circle position if it exists
                if (circle) {
                    circle.setLatLng(position);
                }

                window.ReactNativeWebView.postMessage(JSON.stringify({
                    type: 'REGION_CHANGE',
                    payload: {
                        latitude: position.lat,
                        longitude: position.lng
                    }
                }));
              });
          }
        </script>
      </body>
    </html>
  `;


    return (
        <View style={[styles.container, { height }]} pointerEvents={isStatic ? 'none' : 'auto'}>
            <WebView
                ref={webViewRef}
                originWhitelist={['*']}
                source={{ html: htmlContent }}
                style={styles.webview}
                scrollEnabled={false}
                onMessage={(event) => {
                    try {
                        const data = JSON.parse(event.nativeEvent.data);
                        if (data.type === 'REGION_CHANGE' && onRegionChange) {
                            onRegionChange(data.payload);
                        } else if (data.type === 'MAP_TOUCH_START' && onMapTouchStart) {
                            onMapTouchStart();
                        } else if (data.type === 'MAP_TOUCH_END' && onMapTouchEnd) {
                            onMapTouchEnd();
                        }
                    } catch (e) {
                        console.warn("Failed to parse WebView message", e);
                    }
                }}
                // Android-specific for better performance
                androidLayerType="hardware"
            />
        </View>
    );
};

const styles = StyleSheet.create({
    container: {
        width: '100%',
        overflow: 'hidden',
        backgroundColor: '#f0f0f0',
    },
    webview: {
        flex: 1,
    },
});

export default OSMMap;
