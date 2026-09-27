// lib/components/ProfileScreen.tsx
//
// DIRECTION CONTRACT (impeccable, seed 78886136)
// THESIS: identity is a fixed anchor, not a hero that scrolls away; settings
//   are a native grouped list, never another stack of identical cards.
// OWN-WORLD: existing NativeWind blue/white system, ROLE_ACCENT, no new
//   palette or component language.
// STORY: the visitor confirms who they are once, then scans compact grouped
//   rows for the task they came to do, without re-orienting on every scroll.
// FIRST VIEWPORT: a compact colored identity band (avatar left, name/role/
//   stats right) pinned above an independently scrolling panel; "Your
//   details" as its own card, then one "Account" and (technician/reseller)
//   one "Work" grouped list replacing the old repeated-card stack.
// FORM: dealt lead ("pinned identity, settings scroll beneath"), surface
//   scope, seed 78886136 - donated a tactile count-up from a declined
//   instrument-panel challenger's interaction grammar only, no material.
// FINISH: unreviewed and undocumented is unfinished; this build ends with
//   the finish review, the verdict, DESIGN.md, and every shipping raster
//   carrying its provenance.
import { useEffect, useMemo, useRef, useState } from 'react';
import { useMyEmployees } from '../hooks/useTechnicianEmployment';
import { Animated, View, Text, Pressable, ScrollView, TextInput, Image, Switch } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import * as Location from 'expo-location';
import * as ImagePicker from 'expo-image-picker';
import { useAuthStore } from '../hooks/useAuth';
import { useBiometricLockStore, toggleBiometricLock } from '../hooks/useBiometricLock';
import { useSupabaseQuery, useSupabaseInsert, useSupabaseUpdate } from '../hooks/useSupabase';
import { supabase } from '../supabase';
import { ROLE_ACCENT } from '../constants/roleColors';
import { showAlert, getErrorMessage } from '../utils/alert';
import { resizeImageForUpload } from '../utils/resizeImage';
import { isValidPhone10 } from '../utils/phone';
import { digitsInput } from '../utils/number';
import { isBiometricHardwareReady, authenticateWithBiometrics } from '../utils/biometric';
import type { Profile, UserRole } from '../../types/database.types';

const ROLE_BASE_PATH: Record<UserRole, string> = {
  client: '/(client)',
  technician: '/(technician)',
  reseller: '/(reseller)',
  wholesaler: '/(wholesaler)',
  admin: '/(admin)',
};

const ROLE_LABEL: Record<UserRole, string> = {
  client: 'Client',
  technician: 'Technician',
  reseller: 'Reseller',
  wholesaler: 'Wholesaler',
  admin: 'Admin',
};

function initialsOf(name: string | null | undefined) {
  if (!name) return '?';
  return name
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase())
    .join('');
}

/** A number that counts up into place on first mount/change instead of
 * appearing flat - the one authored motion moment on this screen (an
 * instrument panel's tactile digit-change, borrowed as pure interaction,
 * never its neon/glass material) rather than scattered per-element effects. */
function AnimatedNumber({ value, decimals = 0, style }: { value: number; decimals?: number; style?: any }) {
  const [display, setDisplay] = useState(0);
  const anim = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    anim.setValue(0);
    const listener = anim.addListener(({ value: v }) => setDisplay(v));
    Animated.timing(anim, {
      toValue: value,
      duration: 700,
      useNativeDriver: false,
    }).start();
    return () => anim.removeListener(listener);
  }, [value]);

  return <Text style={style}>{display.toFixed(decimals)}</Text>;
}

function AvatarEditor({ profile }: { profile: Profile }) {
  const setProfile = useAuthStore((state) => state.setProfile);
  const updateProfile = useSupabaseUpdate('profiles');
  const [uploading, setUploading] = useState(false);

  async function handlePick() {
    const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!permission.granted) {
      showAlert('Photo access needed', 'Allow photo library access to set a profile photo.');
      return;
    }
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['images'],
      quality: 0.6,
      allowsEditing: true,
      aspect: [1, 1],
    });
    if (result.canceled || !result.assets[0]) return;

    setUploading(true);
    try {
      const asset = result.assets[0];
      const resizedUri = await resizeImageForUpload(asset.uri, asset.width, 512);
      const arraybuffer = await fetch(resizedUri).then((res) => res.arrayBuffer());
      const path = `${profile.id}/avatar.jpg`;
      const { error: uploadError } = await supabase.storage
        .from('avatars')
        .upload(path, arraybuffer, { contentType: 'image/jpeg', upsert: true });
      if (uploadError) throw uploadError;

      const { data } = supabase.storage.from('avatars').getPublicUrl(path);
      const avatar_url = `${data.publicUrl}?t=${Date.now()}`;
      await updateProfile.mutateAsync({ id: profile.id, values: { avatar_url } });
      setProfile({ ...profile, avatar_url });
    } catch (err) {
      showAlert('Could not update photo', getErrorMessage(err));
    } finally {
      setUploading(false);
    }
  }

  return (
    <Pressable onPress={handlePick} disabled={uploading} className="relative" hitSlop={4}>
      <View className="h-[68px] w-[68px] items-center justify-center overflow-hidden rounded-2xl border-2 border-white/40 bg-white/20">
        {profile.avatar_url ? (
          <Image source={{ uri: profile.avatar_url }} className="h-full w-full" resizeMode="cover" />
        ) : (
          <Text className="text-2xl font-extrabold text-white">{initialsOf(profile.full_name)}</Text>
        )}
      </View>
      <View className="absolute -bottom-1 -right-1 h-6 w-6 items-center justify-center rounded-full border-2 border-white bg-gray-900">
        <Ionicons name={uploading ? 'hourglass-outline' : 'camera'} size={11} color="white" />
      </View>
    </Pressable>
  );
}

/** The pinned identity band - fixed above the scrolling settings panel, so
 * the visitor is never scrolled away from confirmation of who they are.
 * Compact by design: an anchor, not the old full hero. */
function IdentityBand({ profile }: { profile: Profile | null }) {
  const accent = (profile && ROLE_ACCENT[profile.role]) || ROLE_ACCENT.client;
  const { data: reviews } = useSupabaseQuery('reviews', {
    filters: profile?.role === 'technician' ? { technician_id: profile.id } : {},
    enabled: profile?.role === 'technician',
  });
  const ratingAverage = useMemo(() => {
    if (!reviews || reviews.length === 0) return null;
    return reviews.reduce((sum, r) => sum + r.rating, 0) / reviews.length;
  }, [reviews]);

  return (
    <View style={{ backgroundColor: accent }} className="flex-row items-center gap-3.5 px-6 pb-5 pt-16">
      {profile ? (
        <AvatarEditor profile={profile} />
      ) : (
        <View className="h-[68px] w-[68px] items-center justify-center rounded-2xl border-2 border-white/40 bg-white/20">
          <Text className="text-2xl font-extrabold text-white">?</Text>
        </View>
      )}

      <View className="flex-1">
        <Text className="text-[17px] font-extrabold text-white" numberOfLines={1}>
          {profile?.full_name ?? 'Your profile'}
        </Text>
        <View className="mt-1 flex-row items-center gap-2">
          <View className="rounded-full bg-white/20 px-2.5 py-0.5">
            <Text className="text-[10px] font-bold uppercase tracking-wide text-white">
              {profile ? ROLE_LABEL[profile.role] : ''}
            </Text>
          </View>

          {profile?.role === 'technician' && (
            <View className="flex-row items-center gap-1">
              <Ionicons name="star" size={11} color="#fff" />
              <Text className="text-xs font-semibold text-white/90">
                {ratingAverage == null ? (
                  '— rated'
                ) : (
                  <>
                    <AnimatedNumber
                      value={ratingAverage}
                      decimals={1}
                      style={{ fontSize: 12, fontWeight: '600', color: 'rgba(255,255,255,0.9)' }}
                    />
                    {` (${reviews?.length ?? 0})`}
                  </>
                )}
              </Text>
            </View>
          )}
        </View>

        {profile?.role === 'technician' && !!profile.city && (
          <View className="mt-1 flex-row items-center gap-1">
            <Ionicons name="location" size={11} color="rgba(255,255,255,0.75)" />
            <Text className="text-[11px] text-white/75">{profile.city}</Text>
          </View>
        )}
      </View>
    </View>
  );
}

function ProfileDetails({ profile }: { profile: Profile }) {
  const setProfile = useAuthStore((state) => state.setProfile);
  const updateProfile = useSupabaseUpdate('profiles');
  const [editing, setEditing] = useState(false);
  const [fullName, setFullName] = useState(profile.full_name ?? '');
  const [address, setAddress] = useState(profile.city ?? '');
  const [phone, setPhone] = useState(profile.phone ?? '');
  const [saving, setSaving] = useState(false);

  function startEditing() {
    setFullName(profile.full_name ?? '');
    setAddress(profile.city ?? '');
    setPhone(profile.phone ?? '');
    setEditing(true);
  }

  async function handleSave() {
    if (!fullName.trim()) {
      showAlert('Add your name', "Your name can't be left blank - it's how customers and resellers see you.");
      return;
    }
    if (phone.trim() && !isValidPhone10(phone)) {
      showAlert('Check the phone number', 'Enter a 10-digit phone number, or leave it blank.');
      return;
    }
    setSaving(true);
    try {
      const values = {
        full_name: fullName.trim(),
        city: address.trim() || null,
        phone: phone.trim() || null,
      };
      await updateProfile.mutateAsync({ id: profile.id, values });
      setProfile({ ...profile, ...values });
      setEditing(false);
    } catch (err) {
      showAlert('Could not save', getErrorMessage(err));
    } finally {
      setSaving(false);
    }
  }

  if (!editing) {
    return (
      <View className="rounded-2xl border border-gray-200 bg-white p-5">
        <View className="mb-3.5 flex-row items-center justify-between">
          <Text className="text-sm font-semibold text-gray-900">Your details</Text>
          <Pressable onPress={startEditing} className="flex-row items-center gap-1" hitSlop={6}>
            <Ionicons name="pencil" size={13} color="#2563eb" />
            <Text className="text-xs font-bold text-blue-600">Edit</Text>
          </Pressable>
        </View>
        <View className="flex-row">
          <View className="flex-1">
            <Text className="text-xs text-gray-400">Name</Text>
            <Text className="mt-0.5 text-sm text-gray-900">{profile.full_name ?? 'Not set'}</Text>
          </View>
          <View className="flex-1">
            <Text className="text-xs text-gray-400">Address</Text>
            <Text className="mt-0.5 text-sm text-gray-900">{profile.city ?? 'Not set'}</Text>
          </View>
        </View>
        <View className="mt-3.5 border-t border-gray-100 pt-3.5">
          <Text className="text-xs text-gray-400">Contact</Text>
          <Text className="mt-0.5 text-sm text-gray-900">{profile.phone ?? 'Not set'}</Text>
        </View>
      </View>
    );
  }

  return (
    <View className="rounded-2xl border border-gray-200 bg-white p-5">
      <Text className="mb-3 text-sm font-semibold text-gray-900">Edit your details</Text>

      <Text className="mb-1 text-xs font-medium text-gray-500">Name</Text>
      <TextInput
        value={fullName}
        onChangeText={setFullName}
        placeholder="Your full name"
        className="mb-3 rounded-lg border border-gray-300 px-3 py-2 text-sm text-gray-900"
      />

      <Text className="mb-1 text-xs font-medium text-gray-500">Address</Text>
      <TextInput
        value={address}
        onChangeText={setAddress}
        placeholder="Your address"
        className="mb-3 rounded-lg border border-gray-300 px-3 py-2 text-sm text-gray-900"
      />

      <Text className="mb-1 text-xs font-medium text-gray-500">Contact</Text>
      <TextInput
        value={phone}
        onChangeText={(v) => setPhone(digitsInput(v))}
        placeholder="98XXXXXXXX"
        keyboardType="phone-pad"
        maxLength={10}
        className="mb-4 rounded-lg border border-gray-300 px-3 py-2 text-sm text-gray-900"
      />

      <View className="flex-row gap-2">
        <Pressable
          onPress={() => setEditing(false)}
          className="flex-1 items-center rounded-lg border border-gray-300 py-2.5"
        >
          <Text className="text-sm font-semibold text-gray-600">Cancel</Text>
        </Pressable>
        <Pressable
          onPress={handleSave}
          disabled={saving}
          className="flex-1 items-center rounded-lg bg-blue-600 py-2.5 disabled:opacity-50"
        >
          <Text className="text-sm font-semibold text-white">{saving ? 'Saving…' : 'Save'}</Text>
        </Pressable>
      </View>
    </View>
  );
}

/** A single row inside a GroupedList - the settings-list unit that replaces
 * the old "one bordered card per setting" stack (a banned same-size-card
 * scaffold). Every group row shares this exact anatomy: icon chip, label +
 * caption, trailing accessory. */
function GroupRow({
  icon,
  iconColor = '#2563eb',
  iconBg = 'bg-blue-50',
  label,
  caption,
  onPress,
  trailing,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  iconColor?: string;
  iconBg?: string;
  label: string;
  caption?: string;
  onPress?: () => void;
  trailing?: React.ReactNode;
}) {
  const content = (
    <View className="flex-row items-center gap-3 px-4 py-3.5">
      <View className={`h-9 w-9 items-center justify-center rounded-full ${iconBg}`}>
        <Ionicons name={icon} size={17} color={iconColor} />
      </View>
      <View className="flex-1">
        <Text className="font-semibold text-gray-900">{label}</Text>
        {!!caption && <Text className="mt-0.5 text-xs text-gray-400">{caption}</Text>}
      </View>
      {trailing ?? (onPress ? <Ionicons name="chevron-forward" size={18} color="#D1D5DB" /> : null)}
    </View>
  );

  if (!onPress) return content;
  return <Pressable onPress={onPress}>{content}</Pressable>;
}

/** Groups an array of rows into one bordered container with hairline
 * dividers between rows (never after the last) - the native grouped/inset
 * list this whole redesign exists to use instead of a stack of cards. */
function GroupedList({ rows }: { rows: React.ReactNode[] }) {
  return (
    <View className="overflow-hidden rounded-2xl border border-gray-200 bg-white">
      {rows.map((row, i) => (
        <View key={i} className={i < rows.length - 1 ? 'border-b border-gray-100' : ''}>
          {row}
        </View>
      ))}
    </View>
  );
}

function BiometricLockRow({ profile }: { profile: Profile }) {
  const enabled = useBiometricLockStore((state) => state.enabled);
  const [hardwareReady, setHardwareReady] = useState<boolean | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    isBiometricHardwareReady().then(setHardwareReady);
  }, []);

  async function handleToggle(next: boolean) {
    if (next) {
      const verified = await authenticateWithBiometrics();
      if (!verified) return;
    }
    setBusy(true);
    try {
      await toggleBiometricLock(profile.id, next);
    } finally {
      setBusy(false);
    }
  }

  if (hardwareReady === false) {
    return (
      <GroupRow
        icon="finger-print-outline"
        label="Biometric Unlock"
        caption="Set up a fingerprint or face unlock in your phone's settings to use this."
      />
    );
  }

  return (
    <GroupRow
      icon="finger-print-outline"
      label="Biometric Unlock"
      caption={enabled ? "You'll unlock the app with your fingerprint or face." : 'Use your fingerprint or face to unlock the app.'}
      trailing={
        <Switch
          value={enabled}
          onValueChange={handleToggle}
          disabled={busy || hardwareReady === null}
          trackColor={{ false: '#D1D5DB', true: '#93c5fd' }}
          thumbColor={enabled ? '#3b82f6' : '#F3F4F6'}
        />
      }
    />
  );
}

// "My Status" (available/unavailable) used to live here as its own toggle
// row - it now lives in the technician dashboard's header (PortalHeaderBar)
// instead, so resellers-facing availability is right where a technician
// already looks first. This row keeps the still-needed, unrelated location
// sharing action.
function LocationRow({ profile }: { profile: Profile }) {
  const setProfile = useAuthStore((state) => state.setProfile);
  const updateProfile = useSupabaseUpdate('profiles');
  const [locating, setLocating] = useState(false);

  async function updateLocation() {
    setLocating(true);
    try {
      const { status } = await Location.requestForegroundPermissionsAsync();
      if (status !== 'granted') {
        showAlert('Location permission needed', 'Allow location access so resellers can find nearby jobs.');
        return;
      }
      const position = await Location.getCurrentPositionAsync({});
      const { latitude, longitude } = position.coords;
      await updateProfile.mutateAsync({ id: profile.id, values: { latitude, longitude } });
      setProfile({ ...profile, latitude, longitude });
      showAlert('Location updated', 'Resellers can now see how far you are from a job.');
    } catch (err) {
      showAlert('Could not get location', getErrorMessage(err));
    } finally {
      setLocating(false);
    }
  }

  return (
    <GroupRow
      icon="navigate-outline"
      label="My location"
      caption={locating ? 'Locating…' : profile.latitude != null ? 'Location set — tap to update' : 'Share my location'}
      onPress={locating ? undefined : updateLocation}
    />
  );
}

function SkillsPickerRow({ profile }: { profile: Profile }) {
  const setProfile = useAuthStore((state) => state.setProfile);
  const updateProfile = useSupabaseUpdate('profiles');
  const { data: categories } = useSupabaseQuery('service_categories', {
    filters: { is_active: true },
    orderBy: { column: 'sort_order' },
  });
  const [open, setOpen] = useState(false);
  const [selected, setSelected] = useState<string[]>(profile.skill_ids ?? []);
  const [search, setSearch] = useState('');
  const [showSuggestions, setShowSuggestions] = useState(false);
  const [saving, setSaving] = useState(false);

  const categoryById = useMemo(() => {
    const map = new Map<string, string>();
    (categories ?? []).forEach((c) => map.set(c.id, c.label));
    return map;
  }, [categories]);

  const suggestions = useMemo(() => {
    const q = search.trim().toLowerCase();
    return (categories ?? [])
      .filter((c) => !selected.includes(c.id))
      .filter((c) => !q || c.label.toLowerCase().includes(q))
      .slice(0, 8);
  }, [categories, selected, search]);

  function addSkill(id: string) {
    setSelected((prev) => (prev.includes(id) ? prev : [...prev, id]));
    setSearch('');
    setShowSuggestions(false);
  }

  function removeSkill(id: string) {
    setSelected((prev) => prev.filter((s) => s !== id));
  }

  async function handleSave() {
    setSaving(true);
    try {
      await updateProfile.mutateAsync({ id: profile.id, values: { skill_ids: selected } });
      setProfile({ ...profile, skill_ids: selected });
      setOpen(false);
      showAlert('Skills updated', "You'll get matched to more requests and jobs in these categories.");
    } catch (err) {
      showAlert('Could not update skills', getErrorMessage(err));
    } finally {
      setSaving(false);
    }
  }

  const selectedCount = profile.skill_ids?.length ?? 0;

  if (!open) {
    return (
      <GroupRow
        icon="construct-outline"
        label="My Skills"
        caption={selectedCount > 0 ? `${selectedCount} selected — get matched to more jobs` : 'Select skills to get more related requests'}
        onPress={() => {
          setSelected(profile.skill_ids ?? []);
          setOpen(true);
        }}
      />
    );
  }

  return (
    <View className="p-4">
      <Text className="mb-1 text-sm font-semibold text-gray-900">Select your skills</Text>
      <Text className="mb-3 text-xs text-gray-400">
        Search and add every category you can handle — you'll show up for more matching requests and jobs.
      </Text>

      {selected.length > 0 && (
        <View className="mb-3 flex-row flex-wrap gap-2">
          {selected.map((id) => (
            <View key={id} className="flex-row items-center gap-1.5 rounded-full bg-blue-600 py-1.5 pl-3 pr-2">
              <Text className="text-xs font-semibold text-white">{categoryById.get(id) ?? '…'}</Text>
              <Pressable onPress={() => removeSkill(id)} hitSlop={6}>
                <Ionicons name="close" size={13} color="white" />
              </Pressable>
            </View>
          ))}
        </View>
      )}

      <View className="mb-1 flex-row items-center rounded-lg border border-gray-300 bg-white px-3">
        <Ionicons name="search" size={16} color="#9CA3AF" />
        <TextInput
          value={search}
          onChangeText={(v) => {
            setSearch(v);
            setShowSuggestions(true);
          }}
          onFocus={() => setShowSuggestions(true)}
          placeholder="Search skills…"
          autoComplete="off"
          className="ml-2 flex-1 py-2.5 text-sm text-gray-900"
        />
      </View>
      {showSuggestions && suggestions.length > 0 && (
        <View className="mb-1 mt-1 overflow-hidden rounded-lg border border-gray-200 bg-white">
          {suggestions.map((c, idx) => (
            <Pressable
              key={c.id}
              onPress={() => addSkill(c.id)}
              className={`px-3 py-2.5 ${idx !== suggestions.length - 1 ? 'border-b border-gray-100' : ''}`}
            >
              <Text className="text-sm text-gray-900">{c.label}</Text>
            </Pressable>
          ))}
        </View>
      )}
      {showSuggestions && search.trim().length > 0 && suggestions.length === 0 && (
        <Text className="mb-1 mt-1 text-xs text-gray-400">No matching skills.</Text>
      )}

      <View className="mt-3 flex-row gap-2">
        <Pressable
          onPress={() => setOpen(false)}
          className="flex-1 items-center rounded-lg border border-gray-300 py-2.5"
        >
          <Text className="text-sm font-semibold text-gray-600">Cancel</Text>
        </Pressable>
        <Pressable
          onPress={handleSave}
          disabled={saving}
          className="flex-1 items-center rounded-lg bg-blue-600 py-2.5 disabled:opacity-50"
        >
          <Text className="text-sm font-semibold text-white">{saving ? 'Saving…' : 'Save skills'}</Text>
        </Pressable>
      </View>
    </View>
  );
}

function RewardsRow({ profile }: { profile: Profile }) {
  const points = profile.reward_points ?? 0;
  return (
    <GroupRow
      icon="gift"
      iconColor="#2563eb"
      iconBg="bg-blue-50"
      label="Rewards"
      caption="My Rewards, Refer & Earn, Redeem"
      onPress={() => router.push(`${ROLE_BASE_PATH[profile.role]}/rewards` as any)}
      trailing={
        <View className="flex-row items-center gap-1.5">
          <AnimatedNumber value={points} style={{ fontSize: 13, fontWeight: '700', color: '#2563eb' }} />
          <Ionicons name="chevron-forward" size={16} color="#D1D5DB" />
        </View>
      }
    />
  );
}

function ReportIssueRow({ userId }: { userId: string }) {
  const [open, setOpen] = useState(false);
  const [subject, setSubject] = useState('');
  const insertTicket = useSupabaseInsert('support_tickets');

  async function handleSubmit() {
    if (!subject.trim()) {
      showAlert('Describe the issue', "Tell us what's going wrong so we can look into it.");
      return;
    }
    try {
      await insertTicket.mutateAsync({ user_id: userId, subject: subject.trim() });
      setSubject('');
      setOpen(false);
      showAlert('Reported', "We've received your issue and will look into it.");
    } catch (err) {
      showAlert('Could not submit', getErrorMessage(err));
    }
  }

  if (!open) {
    return (
      <GroupRow
        icon="help-buoy-outline"
        label="Report an Issue / Support"
        caption="Tell us what's going wrong"
        onPress={() => setOpen(true)}
      />
    );
  }

  return (
    <View className="p-4">
      <Text className="mb-2 text-sm font-semibold text-gray-900">What's going wrong?</Text>
      <TextInput
        value={subject}
        onChangeText={setSubject}
        placeholder="Describe the issue"
        multiline
        className="mb-3 rounded-lg border border-gray-300 px-3 py-2 text-sm"
      />
      <View className="flex-row gap-2">
        <Pressable
          onPress={() => setOpen(false)}
          className="flex-1 items-center rounded-lg border border-gray-300 py-2.5"
        >
          <Text className="text-sm font-semibold text-gray-600">Cancel</Text>
        </Pressable>
        <Pressable
          onPress={handleSubmit}
          disabled={insertTicket.isPending}
          className="flex-1 items-center rounded-lg bg-blue-600 py-2.5 disabled:opacity-50"
        >
          <Text className="text-sm font-semibold text-white">{insertTicket.isPending ? 'Sending…' : 'Submit'}</Text>
        </Pressable>
      </View>
    </View>
  );
}

function CompanyRow({ profile }: { profile: Profile }) {
  return (
    <GroupRow
      icon="business"
      label="Company details"
      caption={profile.business_name ? profile.business_name : 'Add your company name, VAT no., address and logo'}
      onPress={() => router.push('/(reseller)/company' as any)}
    />
  );
}

function EmployeesRow({ profile }: { profile: Profile }) {
  const { data: employees } = useMyEmployees(profile.id);
  const count = employees.length;
  return (
    <GroupRow
      icon="people"
      label="Technical employees"
      caption={count ? `${count} employee${count === 1 ? '' : 's'} · invite more` : 'Invite technicians to work for you'}
      onPress={() => router.push('/(reseller)/employees' as any)}
    />
  );
}

export function ProfileScreen() {
  const profile = useAuthStore((state) => state.profile);
  const signOut = useAuthStore((state) => state.signOut);

  const accountRows: React.ReactNode[] = [];
  const workRows: React.ReactNode[] = [];

  if (profile) {
    accountRows.push(<BiometricLockRow key="biometric" profile={profile} />);
    if (profile.role !== 'admin') accountRows.push(<RewardsRow key="rewards" profile={profile} />);
    accountRows.push(<ReportIssueRow key="support" userId={profile.id} />);

    if (profile.role === 'technician') workRows.push(<LocationRow key="location" profile={profile} />);
    if (profile.role === 'reseller') {
      workRows.push(<CompanyRow key="company" profile={profile} />);
      workRows.push(<EmployeesRow key="employees" profile={profile} />);
    }
    if (profile.role === 'technician' || profile.role === 'reseller') {
      workRows.push(<SkillsPickerRow key="skills" profile={profile} />);
    }
  }

  return (
    <View className="flex-1 bg-gray-50">
      <IdentityBand profile={profile} />

      <ScrollView
        className="flex-1"
        contentContainerStyle={{ padding: 24, gap: 20 }}
        style={{
          shadowColor: '#000',
          shadowOpacity: 0.06,
          shadowRadius: 8,
          shadowOffset: { width: 0, height: -2 },
          elevation: 3,
        }}
      >
        {profile && <ProfileDetails profile={profile} />}

        {workRows.length > 0 && (
          <View>
            <Text className="mb-2 px-1 text-xs font-bold uppercase tracking-wide text-gray-400">Work</Text>
            <GroupedList rows={workRows} />
          </View>
        )}

        {accountRows.length > 0 && (
          <View>
            <Text className="mb-2 px-1 text-xs font-bold uppercase tracking-wide text-gray-400">Account</Text>
            <GroupedList rows={accountRows} />
          </View>
        )}

        <Pressable onPress={signOut} className="items-center rounded-xl border border-red-200 bg-white py-3.5">
          <Text className="font-semibold text-red-600">Sign Out from Jageer Nepal</Text>
        </Pressable>
      </ScrollView>
    </View>
  );
}
