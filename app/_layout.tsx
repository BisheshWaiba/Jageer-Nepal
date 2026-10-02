// app/_layout.tsx
import { useEffect, useState } from 'react';
import { Stack } from 'expo-router';
import { ActivityIndicator, Keyboard, KeyboardAvoidingView, Platform, View } from 'react-native';
import { StatusBar } from 'expo-status-bar';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { QueryProvider } from '../lib/providers/QueryProvider';
import { useAuthListener, useAuthStore } from '../lib/hooks/useAuth';
import { useBiometricLockBootstrap, useBiometricLockStore } from '../lib/hooks/useBiometricLock';
import { useContactsSyncBootstrap } from '../lib/hooks/useContactsSyncBootstrap';
import { useLiveUpdates } from '../lib/hooks/useLiveUpdates';
import { BiometricLockScreen } from '../lib/components/BiometricLockScreen';
import { FloatingAssistantChat } from '../lib/components/FloatingAssistantChat';
import { ClientAssistantChat } from '../lib/components/ClientAssistantChat';
import { AppAlertHost } from '../lib/components/AppAlertHost';
import '../global.css';

// Pre-login screens (login/register) are still a bare mobile-first form
// with no width cap, so on a laptop browser it'd stretch edge-to-edge - a
// full-viewport-wide email box, buttons a foot long. This letterboxes just
// those into a fixed-width column on wide viewports (a phone-app look, like
// WhatsApp Web). Once signed in, each role's own layout takes over width
// management via WebSidebarShell instead (a real sidebar + content column,
// not a centered phone screen), so this only wraps the pre-login state -
// see RootLayout. Native mobile is untouched either way - the cap only
// ever matters when the viewport is wider than it, which never happens on
// an actual phone.
const WEB_MAX_WIDTH = 640;

function WebFrame({ children }: { children: React.ReactNode }) {
  if (Platform.OS !== 'web') return <>{children}</>;
  return (
    <View style={{ flex: 1, backgroundColor: '#E5E7EB', alignItems: 'center' }}>
      <View
        style={{
          flex: 1,
          width: '100%',
          maxWidth: WEB_MAX_WIDTH,
          backgroundColor: '#fff',
          boxShadow: '0 0 24px rgba(0,0,0,0.08)',
        }}
      >
        {children}
      </View>
    </View>
  );
}

// Most authenticated screens are a plain ScrollView with no keyboard
// handling of their own, so the keyboard just overlaid the screen with
// nothing shrinking to scroll a bottom field (or a fixed footer bar) into
// view. KeyboardAvoidingView's own auto-resize measurement (behavior=
// "height"/"padding") is what login.tsx's screen already found unreliable
// on some Android devices - same reasoning as that screen's own fix:
// track the keyboard's real height directly via Keyboard events and apply
// it as bottom padding instead of trusting the built-in component's
// internal Android measurement. iOS's "padding" behavior isn't known to
// have that problem, so it keeps using the plain component there.
function KeyboardSafeArea({ children }: { children: React.ReactNode }) {
  const [androidKeyboardHeight, setAndroidKeyboardHeight] = useState(0);

  useEffect(() => {
    if (Platform.OS !== 'android') return;
    const showSub = Keyboard.addListener('keyboardDidShow', (e) => setAndroidKeyboardHeight(e.endCoordinates.height));
    const hideSub = Keyboard.addListener('keyboardDidHide', () => setAndroidKeyboardHeight(0));
    return () => {
      showSub.remove();
      hideSub.remove();
    };
  }, []);

  if (Platform.OS === 'android') {
    return <View style={{ flex: 1, paddingBottom: androidKeyboardHeight }}>{children}</View>;
  }
  return (
    <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      {children}
    </KeyboardAvoidingView>
  );
}

function AuthGate({ children }: { children: React.ReactNode }) {
  useAuthListener();
  const isLoading = useAuthStore((state) => state.isLoading);
  const userId = useAuthStore((state) => state.session?.user.id);

  useBiometricLockBootstrap(userId);
  const role = useAuthStore((state) => state.profile?.role);
  useContactsSyncBootstrap(role === 'reseller' || role === 'wholesaler' ? userId : undefined);
  const biometricEnabled = useBiometricLockStore((state) => state.enabled);
  const biometricLocked = useBiometricLockStore((state) => state.locked);
  const biometricChecked = useBiometricLockStore((state) => state.checked);

  if (isLoading || (userId && !biometricChecked)) {
    return (
      <View className="flex-1 items-center justify-center bg-white">
        <ActivityIndicator size="large" color="#1d4ed8" />
      </View>
    );
  }

  if (userId && biometricEnabled && biometricLocked) {
    return <BiometricLockScreen />;
  }

  // Floats over every screen - Finance actions for reseller/wholesaler
  // accounts, booking a service request for client accounts. Same "Sagar"
  // photo/branding either way, just a different conversation and a
  // different form it hands off to.
  const showFinanceAssistant = userId && (role === 'reseller' || role === 'wholesaler');
  const showClientAssistant = userId && role === 'client';

  // Signed-in role layouts manage their own web width (WebSidebarShell);
  // only the pre-login state gets the generic centered letterbox. See
  // KeyboardSafeArea above for why authenticated screens need this at all.
  // Login/register already manage their own keyboard handling and aren't
  // wrapped here to avoid double padding; screens rendered inside a
  // <Modal> (chat, pickers, etc.) are also unaffected since Modal portals
  // outside this tree.
  const content = userId ? <KeyboardSafeArea>{children}</KeyboardSafeArea> : <WebFrame>{children}</WebFrame>;

  return (
    <>
      {content}
      {showFinanceAssistant && <FloatingAssistantChat basePath={`/(${role})`} />}
      {showClientAssistant && <ClientAssistantChat basePath="/(client)" />}
    </>
  );
}

export default function RootLayout() {
  useLiveUpdates();

  return (
    <SafeAreaProvider>
      <StatusBar style="dark" />
      <QueryProvider>
        <AuthGate>
          <Stack screenOptions={{ headerShown: false }}>
            <Stack.Screen name="index" />
            <Stack.Screen name="(auth)" />
            <Stack.Screen name="(client)" />
            <Stack.Screen name="(technician)" />
            <Stack.Screen name="(reseller)" />
            <Stack.Screen name="(wholesaler)" />
            <Stack.Screen name="(admin)" />
          </Stack>
        </AuthGate>
      </QueryProvider>
      <AppAlertHost />
    </SafeAreaProvider>
  );
}
