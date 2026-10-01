// app/(technician)/_layout.tsx
import { Platform, View, useWindowDimensions } from 'react-native';
import { Tabs } from 'expo-router';
import { RoleGuard } from '../../lib/components/RoleGuard';
import { TabIcon } from '../../lib/components/TabIcon';
import { PortalHeaderBar } from '../../lib/components/PortalHeaderBar';
import { ROLE_ACCENT } from '../../lib/constants/roleColors';
import { WebSidebarShell, WEB_SIDEBAR_MIN_WIDTH, type WebNavItem } from '../../lib/components/web/WebSidebarShell';
import { IncomingJobOffer } from '../../lib/components/IncomingJobOffer';
import { TechnicianHoldNotice } from '../../lib/components/HoldNotice';
import { TechnicianLeaveNotice } from '../../lib/components/LeaveRequestNotice';
import { useAuthStore } from '../../lib/hooks/useAuth';
import { useMyStaffRole } from '../../lib/hooks/useTechnicianEmployment';
import { useShareLiveLocation } from '../../lib/hooks/useShareLiveLocation';

const NAV_ITEMS: WebNavItem[] = [
  { href: '/(technician)/dashboard', label: 'Home', icon: 'home' },
  { href: '/(technician)/jobs', label: 'My Jobs', icon: 'briefcase' },
  { href: '/(technician)/earnings', label: 'Earnings', icon: 'wallet' },
];

// A supervisor gets one extra place: their employer's work, to hand out.
const SUPERVISOR_NAV: WebNavItem[] = [
  ...NAV_ITEMS.slice(0, 2),
  { href: '/(technician)/workhub', label: 'Work Hub', icon: 'grid' },
  ...NAV_ITEMS.slice(2),
];

export default function TechnicianLayout() {
  const { width } = useWindowDimensions();
  const userId = useAuthStore((state) => state.session?.user.id);
  const isSupervisor = useMyStaffRole(userId) === 'supervisor';
  useShareLiveLocation(userId);
  const isWideWeb = Platform.OS === 'web' && width >= WEB_SIDEBAR_MIN_WIDTH;
  const tabs = (
    <Tabs
      backBehavior="history"
      screenOptions={{
        header: ({ options }) => <PortalHeaderBar title={options.title} />,
        tabBarActiveTintColor: ROLE_ACCENT.technician,
        ...(isWideWeb ? { tabBarStyle: { display: 'none' } } : null),
      }}
    >
      <Tabs.Screen
        name="dashboard"
        options={{
          title: 'Home',
          // Only the dashboard's own header gets the availability toggle -
          // every other tab keeps the plain header from screenOptions above.
          header: () => <PortalHeaderBar title="Home" showAvailabilityToggle />,
          tabBarIcon: ({ color, focused }) => <TabIcon name="home" color={color} focused={focused} />,
        }}
      />
      <Tabs.Screen
        name="jobs"
        options={{ title: 'My Jobs', tabBarIcon: ({ color, focused }) => <TabIcon name="briefcase" color={color} focused={focused} /> }}
      />
      <Tabs.Screen
        name="workhub"
        options={{
          title: 'Work Hub',
          tabBarLabel: 'Work',
          // Hidden unless their employer made them a supervisor - the
          // screen itself says as much if it's reached directly.
          href: isSupervisor ? undefined : null,
          tabBarIcon: ({ color, focused }) => <TabIcon name="grid" color={color} focused={focused} />,
        }}
      />
      <Tabs.Screen
        name="earnings"
        options={{ title: 'Earnings', tabBarIcon: ({ color, focused }) => <TabIcon name="wallet" color={color} focused={focused} /> }}
      />
      <Tabs.Screen name="profile" options={{ href: null, title: 'Profile' }} />
      <Tabs.Screen name="rewards" options={{ href: null, title: 'Rewards' }} />
      <Tabs.Screen name="statement" options={{ href: null, title: 'Statement' }} />
      <Tabs.Screen name="job/[id]" options={{ href: null, title: 'Job Card' }} />
      <Tabs.Screen name="employment" options={{ href: null, title: 'Employment' }} />
      {/* "available" self-assign screen removed: resellers now assign
          technicians directly (see app/(reseller)/request/[id].tsx). Delete
          app/(technician)/available.tsx if you copied it in earlier. */}
    </Tabs>
  );

  return (
    <RoleGuard allow={['technician']}>
      {/* The job-request overlay sits outside the tabs so it rings over
          whichever tab (or the sidebar) is open when an offer comes in. */}
      <View style={{ flex: 1 }}>
        {isWideWeb ? (
          <WebSidebarShell items={isSupervisor ? SUPERVISOR_NAV : NAV_ITEMS} roleLabel="Technician">
            {tabs}
          </WebSidebarShell>
        ) : (
          tabs
        )}
        <TechnicianHoldNotice technicianId={userId} />
        <TechnicianLeaveNotice technicianId={userId} />
        <IncomingJobOffer technicianId={userId} />
      </View>
    </RoleGuard>
  );
}
