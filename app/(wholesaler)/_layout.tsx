// app/(wholesaler)/_layout.tsx
import { Platform, useWindowDimensions } from 'react-native';
import { Tabs } from 'expo-router';
import { RoleGuard } from '../../lib/components/RoleGuard';
import { TabIcon } from '../../lib/components/TabIcon';
import { PortalHeaderBar } from '../../lib/components/PortalHeaderBar';
import { ROLE_ACCENT } from '../../lib/constants/roleColors';
import { WebSidebarShell, WEB_SIDEBAR_MIN_WIDTH, type WebNavItem } from '../../lib/components/web/WebSidebarShell';
import { FINANCE_WIDE_ROUTES } from '../../lib/components/finance/FinanceDashboardScreen';

const NAV_ITEMS: WebNavItem[] = [
  { href: '/(wholesaler)/market', label: 'Products', icon: 'bag' },
  { href: '/(wholesaler)/marketplace', label: 'Marketplace', icon: 'storefront' },
  { href: '/(wholesaler)/orders', label: 'Orders', icon: 'time' },
  { href: '/(wholesaler)/finance', label: 'Finance', icon: 'wallet' },
];

export default function WholesalerLayout() {
  const { width } = useWindowDimensions();
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
        tabBarActiveTintColor: ROLE_ACCENT.wholesaler,
        ...(isWideWeb ? { tabBarStyle: { display: 'none' } } : null),
      }}
    >
      <Tabs.Screen
        name="market"
        options={{
          title: 'Stock Your Shop',
          tabBarLabel: 'Products',
          tabBarIcon: ({ color, focused }) => <TabIcon name="bag" color={color} focused={focused} />,
        }}
      />
      <Tabs.Screen
        name="marketplace"
        options={{ title: 'Marketplace', tabBarIcon: ({ color, focused }) => <TabIcon name="storefront" color={color} focused={focused} /> }}
      />
      <Tabs.Screen
        name="orders"
        options={{
          title: 'Bulk Orders',
          tabBarLabel: 'Orders',
          tabBarIcon: ({ color, focused }) => <TabIcon name="time" color={color} focused={focused} />,
        }}
      />
      <Tabs.Screen
        name="finance"
        options={{ title: 'Finance', tabBarIcon: ({ color, focused }) => <TabIcon name="wallet" color={color} focused={focused} /> }}
      />
      <Tabs.Screen name="profile" options={{ href: null, title: 'Profile' }} />
      <Tabs.Screen name="rewards" options={{ href: null, title: 'Rewards' }} />
      <Tabs.Screen name="product/[id]" options={{ href: null, title: 'Bulk Pricing' }} />
      <Tabs.Screen name="catalog/[id]" options={{ href: null, title: 'Product Details' }} />
      <Tabs.Screen name="order/[id]" options={{ href: null, title: 'Order Detail' }} />
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
    <RoleGuard allow={['wholesaler']}>
      {isWideWeb ? (
        <WebSidebarShell items={NAV_ITEMS} roleLabel="Wholesaler" profileHref="/(wholesaler)/profile" wideRoutes={FINANCE_WIDE_ROUTES}>
          {tabs}
        </WebSidebarShell>
      ) : (
        tabs
      )}
    </RoleGuard>
  );
}
