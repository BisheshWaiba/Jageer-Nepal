// app/(reseller)/_layout.tsx
import { Platform, View, useWindowDimensions } from 'react-native';
import { Tabs } from 'expo-router';
import { RoleGuard } from '../../lib/components/RoleGuard';
import { TabIcon } from '../../lib/components/TabIcon';
import { PortalHeaderBar } from '../../lib/components/PortalHeaderBar';
import { ROLE_ACCENT } from '../../lib/constants/roleColors';
import { WebSidebarShell, WEB_SIDEBAR_MIN_WIDTH, type WebNavItem } from '../../lib/components/web/WebSidebarShell';
import { ResellerHoldNotice } from '../../lib/components/HoldNotice';
import { ResellerLeaveRequestNotice } from '../../lib/components/LeaveRequestNotice';
import { useAuthStore } from '../../lib/hooks/useAuth';
import { shortcuts as financeShortcuts, FINANCE_WIDE_ROUTES } from '../../lib/components/finance/FinanceDashboardScreen';

// Same 4 sections as the mobile bottom tabs below, just as a persistent
// left rail on web instead - see WebSidebarShell. Finance's own shortcuts
// (Payment In, Purchase, Report, ...) are nested under it too, reusing the
// exact same list the Finance dashboard's tiles use, so switching between
// them never means going back to that dashboard to pick another tile.
const NAV_ITEMS: WebNavItem[] = [
  { href: '/(reseller)/dashboard', label: 'Home', icon: 'home' },
  { href: '/(reseller)/shop', label: 'Shop', icon: 'bag' },
  { href: '/(reseller)/requests', label: 'Requests', icon: 'clipboard' },
  { href: '/(reseller)/workhub', label: 'Work Hub', icon: 'grid' },
  {
    href: '/(reseller)/finance',
    label: 'Finance',
    icon: 'wallet',
    children: financeShortcuts('/(reseller)').map((s) => ({ href: s.href, label: s.label, icon: s.icon })),
  },
];

// The four main sections, plus Buy From Wholesaler and Quotation, use the
// wider content column too (like Finance's pages), so there is no empty strip
// beside them on a big screen - see WebSidebarShell's `wideRoutes`.
const MAIN_WIDE_ROUTES = ['/dashboard', '/shop', '/requests', '/workhub', '/wholesale', '/quotation'];
const WIDE_ROUTES = [...FINANCE_WIDE_ROUTES, ...MAIN_WIDE_ROUTES];

export default function ResellerLayout() {
  const { width } = useWindowDimensions();
  const userId = useAuthStore((state) => state.session?.user.id);
  const isWideWeb = Platform.OS === 'web' && width >= WEB_SIDEBAR_MIN_WIDTH;
  const tabs = (
    <Tabs
      backBehavior="history"
      screenOptions={{
        header: ({ options }) => (
          <PortalHeaderBar
            title={options.title}
            hideAccount={isWideWeb}
            left={options.headerLeft?.({ canGoBack: false })}
            right={options.headerRight?.({ canGoBack: false })}
          />
        ),
        tabBarActiveTintColor: ROLE_ACCENT.reseller,
        ...(isWideWeb ? { tabBarStyle: { display: 'none' } } : null),
      }}
    >
        <Tabs.Screen
          name="dashboard"
          options={{ title: 'Home', tabBarIcon: ({ color, focused }) => <TabIcon name="home" color={color} focused={focused} /> }}
        />
        <Tabs.Screen
          name="shop"
          options={{ title: 'Shop', tabBarIcon: ({ color, focused }) => <TabIcon name="bag" color={color} focused={focused} /> }}
        />
        <Tabs.Screen
          name="requests"
          options={{
            title: 'My Requests',
            tabBarLabel: 'Requests',
            tabBarIcon: ({ color, focused }) => <TabIcon name="clipboard" color={color} focused={focused} />,
          }}
        />
        <Tabs.Screen
          name="workhub"
          options={{
            title: 'Work Hub',
            tabBarLabel: 'Work',
            tabBarIcon: ({ color, focused }) => <TabIcon name="grid" color={color} focused={focused} />,
          }}
        />
        <Tabs.Screen
          name="finance"
          options={{ title: 'Finance', tabBarIcon: ({ color, focused }) => <TabIcon name="wallet" color={color} focused={focused} /> }}
        />
        <Tabs.Screen name="profile" options={{ href: null, title: 'Profile' }} />
        <Tabs.Screen name="company" options={{ href: null, title: 'Company Details' }} />
        <Tabs.Screen
          name="employees"
          options={{
            href: null,
            title: 'Team',
            header: ({ options }) => <PortalHeaderBar title={options.title} backTo="/(reseller)/profile" />,
          }}
        />
        <Tabs.Screen
          name="team-activity"
          options={{
            href: null,
            title: 'Team Activity',
            header: ({ options }) => <PortalHeaderBar title={options.title} backTo="/(reseller)/employees" />,
          }}
        />
        <Tabs.Screen
          name="employee/[id]"
          options={{
            href: null,
            title: 'Employee',
            header: ({ options }) => <PortalHeaderBar title={options.title} backTo="/(reseller)/employees" />,
          }}
        />
        <Tabs.Screen name="rewards" options={{ href: null, title: 'Rewards' }} />
        <Tabs.Screen name="request/[id]" options={{ href: null, title: 'Service Request' }} />
        <Tabs.Screen name="new-request" options={{ href: null, title: 'Request a technician' }} />
        <Tabs.Screen name="request-details" options={{ href: null, title: 'Service details' }} />
        <Tabs.Screen name="edit-request" options={{ href: null, title: 'Edit request' }} />
        <Tabs.Screen name="quotation/new" options={{ href: null, title: 'Generate Quotation' }} />
        <Tabs.Screen name="wholesale" options={{ href: null, title: 'Buy From Wholesaler' }} />
        <Tabs.Screen name="checkout" options={{ href: null, title: 'Checkout' }} />
        <Tabs.Screen name="order/[id]" options={{ href: null, title: 'Order Detail' }} />
        <Tabs.Screen name="product/[id]" options={{ href: null, title: 'Product' }} />
        <Tabs.Screen name="catalog/[id]" options={{ href: null, title: 'Product Details' }} />
        <Tabs.Screen name="technician/[id]" options={{ href: null, title: 'Work History' }} />
        <Tabs.Screen name="customers" options={{ href: null, title: 'Ledger' }} />
        <Tabs.Screen name="customer/[id]" options={{ href: null, title: 'Customer' }} />
        <Tabs.Screen name="transactions" options={{ href: null, title: 'Statement' }} />
        <Tabs.Screen name="quick-payment" options={{ href: null, title: 'Quick Payment' }} />
        <Tabs.Screen name="received" options={{ href: null, title: 'Total Received' }} />
        <Tabs.Screen name="paid" options={{ href: null, title: 'Total Paid' }} />
        <Tabs.Screen name="to-receive" options={{ href: null, title: 'Receivable' }} />
        <Tabs.Screen name="to-give" options={{ href: null, title: 'Payable' }} />
        <Tabs.Screen name="bank-accounts" options={{ href: null, title: 'Bank Accounts' }} />
        <Tabs.Screen name="bank-balances" options={{ href: null, title: 'Available Balance' }} />
        <Tabs.Screen name="import-statement" options={{ href: null, title: 'Import Statement' }} />
        <Tabs.Screen name="inventory" options={{ href: null, title: 'Inventory' }} />
        <Tabs.Screen name="report" options={{ href: null, title: 'Report' }} />
        <Tabs.Screen name="daybook" options={{ href: null, title: 'Day Book' }} />
      </Tabs>
  );

  return (
    <RoleGuard allow={['reseller']}>
      {/* The hold-request capsule sits outside the tabs so it shows over
          whichever tab (or the sidebar) is open. */}
      <View style={{ flex: 1 }}>
        {isWideWeb ? (
          <WebSidebarShell items={NAV_ITEMS} roleLabel="Reseller" profileHref="/(reseller)/profile" wideRoutes={WIDE_ROUTES}>
            {tabs}
          </WebSidebarShell>
        ) : (
          tabs
        )}
        <ResellerHoldNotice resellerId={userId} />
        <ResellerLeaveRequestNotice resellerId={userId} />
      </View>
    </RoleGuard>
  );
}
