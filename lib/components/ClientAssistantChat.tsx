// lib/components/ClientAssistantChat.tsx
import { useEffect, useRef, useState } from 'react';
import {
  View,
  Text,
  TextInput,
  Pressable,
  Image,
  Modal,
  ScrollView,
  KeyboardAvoidingView,
  Platform,
  Animated,
  PanResponder,
  useWindowDimensions,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import * as Speech from 'expo-speech';
import { useAuthStore } from '../hooks/useAuth';
import { useSupabaseQuery } from '../hooks/useSupabase';
import { useClientAssistant, type ClientChatTurnResult } from '../hooks/useClientAssistant';

function clamp(value: number, min: number, max: number) {
  return Math.min(Math.max(value, min), max);
}

const BUTTON_SIZE = 52;

/** The customer-facing counterpart to FloatingAssistantChat: same photo,
 * same drag-anywhere bubble, same talk-or-type conversation pattern - but
 * for describing a problem and booking a service request instead of a
 * Finance entry. Never submits the request itself; "Open Form" hands off
 * to the real request-details screen, pre-filled, for the client to review
 * and submit. */
export function ClientAssistantChat({ basePath }: { basePath: string }) {
  const insets = useSafeAreaInsets();
  const { width: screenWidth, height: screenHeight } = useWindowDimensions();
  const profile = useAuthStore((state) => state.profile);
  const assistantName = profile?.full_name
    ? `${profile.full_name.split(' ')[0]}'s Assistant`
    : 'Jageer Assistant';

  const { data: categoryRows } = useSupabaseQuery('service_categories', {
    filters: { is_active: true },
    orderBy: { column: 'sort_order' },
  });
  const categories = (categoryRows ?? []).map((c) => c.label);

  const { messages, recording, sending, sendText, startRecording, stopRecordingAndSend, reset, greet } =
    useClientAssistant(categories);
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState('');
  const [lastResult, setLastResult] = useState<ClientChatTurnResult | null>(null);
  const [speakEnabled, setSpeakEnabled] = useState(true);

  // A soft, continuously pulsing glow ring behind the photo - purely
  // decorative, so it loops for as long as the component is mounted (the
  // whole time the app is open) rather than tying it to any interaction.
  const glowPulse = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(glowPulse, { toValue: 1, duration: 1300, useNativeDriver: true }),
        Animated.timing(glowPulse, { toValue: 0, duration: 1300, useNativeDriver: true }),
      ])
    );
    loop.start();
    return () => loop.stop();
  }, [glowPulse]);
  const glowScale = glowPulse.interpolate({ inputRange: [0, 1], outputRange: [1, 1.06] });
  const glowOpacity = glowPulse.interpolate({ inputRange: [0, 1], outputRange: [0.55, 0.9] });

  const [basePos, setBasePos] = useState(() => ({
    x: 20,
    y: screenHeight - 28 - BUTTON_SIZE - insets.bottom,
  }));
  const drag = useRef(new Animated.ValueXY({ x: 0, y: 0 })).current;
  const dragged = useRef(false);
  const panResponder = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onPanResponderGrant: () => {
        dragged.current = false;
        drag.setValue({ x: 0, y: 0 });
      },
      onPanResponderMove: (_evt, gesture) => {
        if (Math.abs(gesture.dx) > 4 || Math.abs(gesture.dy) > 4) dragged.current = true;
        drag.setValue({ x: gesture.dx, y: gesture.dy });
      },
      onPanResponderRelease: (_evt, gesture) => {
        drag.setValue({ x: 0, y: 0 });
        if (!dragged.current) {
          handleOpen();
          return;
        }
        setBasePos((prev) => ({
          x: clamp(prev.x + gesture.dx, 0, screenWidth - BUTTON_SIZE),
          y: clamp(prev.y + gesture.dy, insets.top, screenHeight - BUTTON_SIZE - insets.bottom),
        }));
      },
    })
  ).current;

  function close() {
    Speech.stop();
    setOpen(false);
    setLastResult(null);
    reset();
  }

  // Greets out loud the moment the chat opens, instead of leaving the
  // customer looking at an empty panel wondering if anything is there -
  // greet() only actually seeds the message on a genuinely fresh
  // conversation, so reopening mid-chat won't repeat it.
  function handleOpen() {
    setOpen(true);
    const greeting = "Namaste! How can I help you today?";
    greet(greeting);
    if (speakEnabled) Speech.speak(greeting, { pitch: 0.5, rate: 0.9 });
  }

  // Searching the device's voice list for one explicitly labeled "male"
  // turned out unreliable in practice - most Nepali TTS voices aren't
  // gender-labeled at all, and even when a match was found, the OS
  // sometimes silently ignored it (wrong language) and fell back to its
  // own default anyway. A pitch this low always has an audible effect
  // regardless of which voice actually ends up speaking, so it no longer
  // depends on finding a specific voice at all.
  async function speakReply(result: ClientChatTurnResult) {
    if (!speakEnabled || !result.reply) return;
    Speech.speak(result.reply, { pitch: 0.5, rate: 0.9 });
  }

  async function handleSendText() {
    const text = draft.trim();
    if (!text) return;
    setDraft('');
    const result = await sendText(text);
    if (result) {
      setLastResult(result);
      speakReply(result);
    }
  }

  async function handleMicPress() {
    if (recording) {
      const result = await stopRecordingAndSend();
      if (result) {
        setLastResult(result);
        speakReply(result);
      }
      return;
    }
    Speech.stop();
    await startRecording();
  }

  function handleOpenForm() {
    if (!lastResult?.category || !lastResult.action) return;
    const extra: string[] = [];
    if (lastResult.notes) extra.push(`assistantNotes=${encodeURIComponent(lastResult.notes)}`);
    if (lastResult.date) extra.push(`assistantDate=${encodeURIComponent(lastResult.date)}`);
    if (lastResult.time) extra.push(`assistantTime=${encodeURIComponent(lastResult.time)}`);
    if (lastResult.address) extra.push(`assistantAddress=${encodeURIComponent(lastResult.address)}`);
    const query = extra.length ? `&${extra.join('&')}` : '';
    close();
    router.push(
      `${basePath}/request-details?category=${encodeURIComponent(lastResult.category)}&action=${encodeURIComponent(lastResult.action)}&n=${Date.now()}${query}` as any
    );
  }

  return (
    <>
      <Animated.View
        {...panResponder.panHandlers}
        style={{
          position: 'absolute',
          left: basePos.x,
          top: basePos.y,
          transform: drag.getTranslateTransform(),
          width: BUTTON_SIZE,
          height: BUTTON_SIZE,
        }}
      >
        <Animated.View
          style={{
            position: 'absolute',
            top: -8,
            left: -8,
            right: -8,
            bottom: -8,
            borderRadius: 999,
            opacity: glowOpacity,
            transform: [{ scale: glowScale }],
          }}
        >
          <LinearGradient
            colors={['#60A5FA', '#34D399']}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 1 }}
            style={{ width: '100%', height: '100%', borderRadius: 999 }}
          />
        </Animated.View>

        {/* No clipping wrapper: a View combining overflow:hidden, a radius and
            elevation left the photo invisible on Android (only the ring and
            glow showed). The photo rounds itself instead, on a white disc so
            its transparent background doesn't show the glow through it. */}
        <View
          style={{
            width: BUTTON_SIZE,
            height: BUTTON_SIZE,
            borderRadius: BUTTON_SIZE / 2,
            backgroundColor: '#FFFFFF',
            shadowColor: '#2563EB',
            shadowOpacity: 0.45,
            shadowRadius: 10,
            shadowOffset: { width: 0, height: 5 },
            elevation: 8,
          }}
        >
          <Image
            source={require('../../assets/sagar-assistant.png')}
            style={{
              width: BUTTON_SIZE,
              height: BUTTON_SIZE,
              borderRadius: BUTTON_SIZE / 2,
              borderWidth: 2,
              borderColor: '#FFFFFF',
            }}
            resizeMode="cover"
          />
        </View>

        <View
          style={{
            position: 'absolute',
            top: 0,
            right: 0,
            width: 8,
            height: 8,
            borderRadius: 999,
            backgroundColor: '#34D399',
            borderWidth: 1.5,
            borderColor: '#fff',
          }}
        />

        <View
          className="items-center justify-center rounded-full bg-white"
          style={{
            position: 'absolute',
            bottom: -2,
            right: -2,
            width: 18,
            height: 18,
            shadowColor: '#101828',
            shadowOpacity: 0.18,
            shadowRadius: 5,
            shadowOffset: { width: 0, height: 2 },
            elevation: 4,
          }}
        >
          <Ionicons name="chatbubble-ellipses-outline" size={9} color="#2563EB" />
        </View>
      </Animated.View>

      <Modal visible={open} transparent animationType="slide" onRequestClose={close}>
        <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={{ flex: 1 }}>
          <Pressable className="flex-1 justify-end bg-black/40" onPress={close}>
            <Pressable onPress={() => {}} className="rounded-t-2xl bg-white" style={{ height: '75%' }}>
              <View className="flex-row items-center justify-between border-b border-gray-100 px-4 py-3">
                <Text className="text-base font-bold text-gray-900">{assistantName}</Text>
                <View className="flex-row items-center gap-4">
                  <Pressable
                    onPress={() => {
                      if (speakEnabled) Speech.stop();
                      setSpeakEnabled((v) => !v);
                    }}
                    hitSlop={8}
                  >
                    <Ionicons name={speakEnabled ? 'volume-high' : 'volume-mute'} size={20} color="#6B7280" />
                  </Pressable>
                  <Pressable onPress={close} hitSlop={8}>
                    <Ionicons name="close" size={22} color="#6B7280" />
                  </Pressable>
                </View>
              </View>

              <ScrollView className="flex-1 px-4 py-3" keyboardShouldPersistTaps="handled">
                {messages.length === 0 && (
                  <Text className="mt-6 text-center text-sm text-gray-400">
                    Tell me what's wrong, like "my water purifier isn't working" - or tap the mic and just say it.
                  </Text>
                )}
                {messages.map((m, i) => (
                  <View
                    key={i}
                    className={`mb-2.5 max-w-[85%] rounded-2xl px-3.5 py-2.5 ${
                      m.role === 'user' ? 'self-end bg-blue-600' : 'self-start bg-gray-100'
                    }`}
                  >
                    <Text className={m.role === 'user' ? 'text-sm text-white' : 'text-sm text-gray-900'}>{m.text}</Text>
                  </View>
                ))}
                {sending && <Text className="text-xs text-gray-400">Thinking…</Text>}
              </ScrollView>

              {lastResult?.ready && lastResult.category && lastResult.action && (
                <View className="mx-4 mb-2 flex-row items-center justify-between rounded-xl bg-emerald-50 px-3.5 py-2.5">
                  <Text className="flex-1 text-xs font-semibold text-emerald-700" numberOfLines={1}>
                    Ready: {lastResult.category} · {lastResult.action}
                  </Text>
                  <Pressable onPress={handleOpenForm} className="rounded-full bg-emerald-600 px-3 py-1.5">
                    <Text className="text-xs font-semibold text-white">Open Form</Text>
                  </Pressable>
                </View>
              )}

              <View
                className="flex-row items-center gap-2 border-t border-gray-100 px-3 pt-2.5"
                style={{ paddingBottom: Math.max(insets.bottom, 12) }}
              >
                <Pressable
                  onPress={handleMicPress}
                  className="h-10 w-10 items-center justify-center rounded-full"
                  style={{ backgroundColor: recording ? '#FEF2F2' : '#EFF6FF' }}
                >
                  <Ionicons name={recording ? 'stop-circle' : 'mic-outline'} size={20} color={recording ? '#DC2626' : '#2563EB'} />
                </Pressable>
                <TextInput
                  value={draft}
                  onChangeText={setDraft}
                  placeholder={recording ? 'Listening…' : 'Type a message'}
                  placeholderTextColor="#9CA3AF"
                  editable={!recording}
                  className="flex-1 rounded-full border border-gray-300 bg-white px-4 py-2.5 text-sm text-gray-900"
                  onSubmitEditing={handleSendText}
                />
                <Pressable
                  onPress={handleSendText}
                  disabled={!draft.trim() || sending}
                  className="h-10 w-10 items-center justify-center rounded-full bg-blue-600 disabled:opacity-40"
                >
                  <Ionicons name="send" size={16} color="white" />
                </Pressable>
              </View>
            </Pressable>
          </Pressable>
        </KeyboardAvoidingView>
      </Modal>
    </>
  );
}
