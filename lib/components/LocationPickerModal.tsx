// lib/components/LocationPickerModal.tsx
import { useEffect, useRef, useState } from 'react';
import {
  View,
  Text,
  TextInput,
  Pressable,
  Modal,
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import * as Location from 'expo-location';
import { showAlert, getErrorMessage } from '../utils/alert';
import { LocationMapPicker, type LocationMapPickerHandle, type Coords } from './LocationMapPicker';

export type { Coords };

const MAP_HEIGHT = 220;

type SearchResult = { place_id: number; display_name: string; lat: string; lon: string; isCoordinate?: boolean };

// Nominatim (OpenStreetMap) is free and keyless, so this reuses it for both
// directions instead of adding a Google Places dependency - reverse lookup
// (coords -> address) already worked this way elsewhere; this adds forward
// search (typed place/landmark -> coords) the same way.
async function searchPlaces(query: string): Promise<SearchResult[]> {
  const res = await fetch(
    `https://nominatim.openstreetmap.org/search?format=json&limit=6&q=${encodeURIComponent(query)}`,
    { headers: { Accept: 'application/json' } }
  );
  return res.json();
}

// Lets someone paste/type exact coordinates (e.g. "27.7172, 85.3240", the
// format Google Maps' own long-press copy uses) instead of only being able
// to find places Nominatim happens to know by name - handled locally, no
// network round-trip needed since the numbers are already precise.
function parseCoordinateInput(text: string): Coords | null {
  const match = text.match(/^(-?\d{1,3}(?:\.\d+)?)\s*[,\s]\s*(-?\d{1,3}(?:\.\d+)?)$/);
  if (!match) return null;
  const latitude = Number(match[1]);
  const longitude = Number(match[2]);
  if (Number.isNaN(latitude) || Number.isNaN(longitude)) return null;
  if (latitude < -90 || latitude > 90 || longitude < -180 || longitude > 180) return null;
  return { latitude, longitude };
}

async function reverseGeocode(coords: Coords): Promise<string | null> {
  const res = await fetch(
    `https://nominatim.openstreetmap.org/reverse?format=json&lat=${coords.latitude}&lon=${coords.longitude}`,
    { headers: { Accept: 'application/json' } }
  );
  const data = await res.json();
  return data?.display_name ?? null;
}

/** Lets the person confirm the device's current position or search for a
 * different place/landmark (e.g. to simulate an order coming from elsewhere)
 * before it's attached to the request. Selection is drag-the-map: a fixed
 * pin sits at the center of the view and whatever the map is centered on
 * is the chosen point, rather than a marker dropped on a static preview -
 * "Use my current location" and picking a search result both just move the
 * map underneath the same fixed pin. */
export function LocationPickerModal({
  visible,
  initialCoords,
  onConfirm,
  onClose,
}: {
  visible: boolean;
  initialCoords: Coords | null;
  onConfirm: (coords: Coords, address: string) => void;
  onClose: () => void;
}) {
  const [coords, setCoords] = useState<Coords | null>(initialCoords);
  const [address, setAddress] = useState('');
  const [addressLoading, setAddressLoading] = useState(false);
  const [locating, setLocating] = useState(false);
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<SearchResult[]>([]);
  const [searching, setSearching] = useState(false);
  const [mapMountKey, setMapMountKey] = useState(0);
  const searchSeq = useRef(0);
  const geocodeSeq = useRef(0);
  const lastGeocodedKey = useRef<string | null>(null);
  const mapRef = useRef<LocationMapPickerHandle>(null);

  // Applies a new center everywhere it needs to land: the coords the
  // confirm button will submit, and (deduped, so panning back over the
  // same spot doesn't re-fetch) the address shown in the pin's popup.
  function syncCenter(next: Coords) {
    setCoords(next);
    const key = `${next.latitude.toFixed(5)},${next.longitude.toFixed(5)}`;
    if (lastGeocodedKey.current === key) return;
    lastGeocodedKey.current = key;
    const seq = ++geocodeSeq.current;
    setAddressLoading(true);
    reverseGeocode(next)
      .then((display) => {
        if (geocodeSeq.current !== seq) return;
        if (display) setAddress(display);
      })
      .catch(() => {})
      .finally(() => {
        if (geocodeSeq.current === seq) setAddressLoading(false);
      });
  }

  useEffect(() => {
    if (!visible) return;
    setQuery('');
    setResults([]);
    lastGeocodedKey.current = null;
    setMapMountKey((k) => k + 1);
    if (initialCoords) {
      syncCenter(initialCoords);
    } else {
      setCoords(null);
      locateDevice();
    }
    // Only re-run when the modal opens, not on every initialCoords change
    // from the parent (which would fight the map's own state below).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible]);

  useEffect(() => {
    const trimmed = query.trim();

    const asCoordinate = parseCoordinateInput(trimmed);
    if (asCoordinate) {
      // No network round-trip needed - an exact coordinate doesn't need to
      // be "found", so this shows instantly instead of waiting on the same
      // debounce as a place-name search.
      setSearching(false);
      setResults([
        {
          place_id: -1,
          display_name: `Pin at ${asCoordinate.latitude.toFixed(5)}, ${asCoordinate.longitude.toFixed(5)}`,
          lat: String(asCoordinate.latitude),
          lon: String(asCoordinate.longitude),
          isCoordinate: true,
        },
      ]);
      return;
    }

    if (!trimmed || trimmed.length < 3) {
      // Invalidate any search still in flight and stop its spinner -
      // shortening the query below 3 letters used to leave it spinning.
      searchSeq.current += 1;
      setSearching(false);
      setResults([]);
      return;
    }
    const seq = ++searchSeq.current;
    setSearching(true);
    const timer = setTimeout(async () => {
      try {
        const found = await searchPlaces(trimmed);
        if (searchSeq.current === seq) setResults(found);
      } catch {
        if (searchSeq.current === seq) setResults([]);
      } finally {
        if (searchSeq.current === seq) setSearching(false);
      }
    }, 450);
    return () => clearTimeout(timer);
  }, [query]);

  async function locateDevice() {
    setLocating(true);
    try {
      const { status } = await Location.requestForegroundPermissionsAsync();
      if (status !== 'granted') {
        showAlert('Location permission needed', 'Allow location access to use your current position.');
        return;
      }
      const position = await Location.getCurrentPositionAsync({});
      const next = { latitude: position.coords.latitude, longitude: position.coords.longitude };
      if (mapRef.current) {
        // Map's already up (this was a manual re-tap) - pan it and let the
        // map's own moveend -> onCenterChange call syncCenter.
        mapRef.current.recenterTo(next);
      } else {
        // First open, before the map has mounted - this coords value
        // becomes its initial center directly.
        syncCenter(next);
      }
    } catch (err) {
      showAlert('Could not get location', getErrorMessage(err));
    } finally {
      setLocating(false);
    }
  }

  function selectResult(result: SearchResult) {
    const next = { latitude: Number(result.lat), longitude: Number(result.lon) };
    setQuery('');
    setResults([]);
    if (mapRef.current) {
      mapRef.current.recenterTo(next);
    } else {
      syncCenter(next);
    }
  }

  function confirm() {
    if (!coords) return;
    onConfirm(coords, address);
  }

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : 'height'} style={{ flex: 1 }}>
        <Pressable className="flex-1 items-center justify-center bg-black/40 px-6" onPress={onClose}>
          <Pressable onPress={() => {}} className="w-full max-w-sm rounded-xl bg-white p-4" style={{ maxHeight: '85%' }}>
            <View className="mb-3 flex-row items-center justify-between">
              <Text className="text-base font-semibold text-gray-900">Set location</Text>
              <Pressable onPress={onClose} hitSlop={8}>
                <Ionicons name="close" size={20} color="#6B7280" />
              </Pressable>
            </View>

            <View className="mb-2.5 flex-row items-center rounded-lg border border-gray-300 bg-white px-3">
              <Ionicons name="search" size={16} color="#9CA3AF" />
              <TextInput
                value={query}
                onChangeText={setQuery}
                placeholder="Search a place, or enter lat, lng"
                className="flex-1 px-2 py-2.5 text-sm"
              />
              {searching && <ActivityIndicator size="small" color="#9CA3AF" />}
            </View>

            {results.length > 0 && (
              <View className="mb-2.5 overflow-hidden rounded-lg border border-gray-200" style={{ maxHeight: 180 }}>
                {results.map((r) => (
                  <Pressable
                    key={r.place_id}
                    onPress={() => selectResult(r)}
                    className="flex-row items-center gap-2 border-b border-gray-100 px-3 py-2.5"
                  >
                    <Ionicons
                      name={r.isCoordinate ? 'locate' : 'location-outline'}
                      size={14}
                      color={r.isCoordinate ? '#1D4ED8' : '#9CA3AF'}
                    />
                    <Text className="flex-1 text-sm text-gray-800" numberOfLines={2}>
                      {r.display_name}
                    </Text>
                  </Pressable>
                ))}
              </View>
            )}

            <Pressable
              onPress={locateDevice}
              disabled={locating}
              className="mb-2.5 flex-row items-center justify-center gap-2 rounded-lg border border-blue-700 bg-blue-50 py-2.5 disabled:opacity-50"
            >
              <Ionicons name="locate" size={16} color="#1D4ED8" />
              <Text className="text-sm font-semibold text-blue-700">
                {locating ? 'Locating…' : 'Use my current location'}
              </Text>
            </Pressable>

            {coords ? (
              <LocationMapPicker
                key={mapMountKey}
                ref={mapRef}
                initialCoords={coords}
                onCenterChange={syncCenter}
                height={MAP_HEIGHT}
                address={address}
                addressLoading={addressLoading}
              />
            ) : (
              <View
                className="items-center justify-center rounded-lg border border-gray-200 bg-gray-50"
                style={{ height: MAP_HEIGHT }}
              >
                <ActivityIndicator color="#9CA3AF" />
                <Text className="mt-2 text-xs text-gray-400">Getting your location…</Text>
              </View>
            )}
            <Text className="mb-3 mt-1.5 text-center text-[11px] text-gray-400">Drag the map to move the pin</Text>

            <View className="flex-row gap-2">
              <Pressable onPress={onClose} className="flex-1 items-center rounded-lg border border-gray-300 py-2.5">
                <Text className="text-sm font-semibold text-gray-600">Cancel</Text>
              </Pressable>
              <Pressable
                onPress={confirm}
                disabled={!coords}
                className="flex-1 items-center rounded-lg bg-blue-600 py-2.5 disabled:opacity-40"
              >
                <Text className="text-sm font-semibold text-white">Use this location</Text>
              </Pressable>
            </View>
          </Pressable>
        </Pressable>
      </KeyboardAvoidingView>
    </Modal>
  );
}
