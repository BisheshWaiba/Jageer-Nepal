// app/(reseller)/employee/[id].tsx
import { useCallback, useEffect, useMemo, useRef, useState, type ComponentProps, type ReactNode } from 'react';
import { View, Text, TextInput, Pressable, ScrollView, Linking } from 'react-native';
import { router, useFocusEffect, useLocalSearchParams } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useAuthStore } from '../../../lib/hooks/useAuth';
import { useSupabaseRow, useSupabaseUpdate, useSupabaseDelete } from '../../../lib/hooks/useSupabase';
import {
  useMyEmployees,
  useEmployeeEmails,
  useEndEmployment,
  useUpdateEmployment,
} from '../../../lib/hooks/useTechnicianEmployment';
import { useFormDraft, formatDraftTime } from '../../../lib/hooks/useFormDraft';
import { PersonAvatar } from '../../../lib/components/PersonAvatar';
import { TimeField } from '../../../lib/components/DateTimeFields';
import { AssignJobList } from '../../../lib/components/AssignJobToEmployee';
import { useWideDetail } from '../../../lib/components/detail/DetailLayout';
import { showAlert, getErrorMessage } from '../../../lib/utils/alert';
import { isValidPhone10 } from '../../../lib/utils/phone';
import { workHoursIssue } from '../../../lib/utils/workHours';

const BLUE = '#2563EB';
const MAX_WIDTH = 620;

function Field({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  return (
    <View className="mb-3.5">
      <Text className="mb-1.5 text-sm font-medium text-gray-700">{label}</Text>
      {children}
      {!!hint && <Text className="mt-1 text-[11px] text-gray-400">{hint}</Text>}
    </View>
  );
}

function Input(props: ComponentProps<typeof TextInput>) {
  return <TextInput {...props} className="rounded-lg border border-gray-300 bg-white px-4 py-3 text-base text-gray-900" />;
}

/** A detail that lives on the person's own account - shown in the same slot
 * as an editable field so both employee pages read alike, but not typed
 * into, since only they can change it. */
function ReadOnlyValue({ value, empty }: { value: string | null; empty: string }) {
  return (
    <View className="rounded-lg border border-gray-200 bg-gray-50 px-4 py-3">
      <Text className={`text-base ${value ? 'text-gray-700' : 'text-gray-400'}`}>{value || empty}</Text>
    </View>
  );
}

function HoursRow({ start, end, setStart, setEnd }: { start: string; end: string; setStart: (v: string) => void; setEnd: (v: string) => void }) {
  return (
    <View className="flex-row items-center gap-2">
      <View className="flex-1">
        <TimeField value={start} onChange={setStart} />
      </View>
      <Text className="text-xs text-gray-400">to</Text>
      <View className="flex-1">
        <TimeField value={end} onChange={setEnd} />
      </View>
    </View>
  );
}

function Header({ name, subtitle, photoUrl, phone }: { name: string; subtitle: string; photoUrl?: string | null; phone: string | null }) {
  return (
    <View className="flex-row items-center gap-3 rounded-2xl border border-gray-200 bg-white p-4">
      <PersonAvatar name={name} photoUrl={photoUrl} size={54} bg={photoUrl ? 'bg-blue-600' : 'bg-gray-500'} />
      <View className="flex-1">
        <Text className="text-lg font-bold text-gray-900" numberOfLines={1}>
          {name || 'Employee'}
        </Text>
        <Text className="text-xs text-gray-500">{subtitle}</Text>
      </View>
      {!!phone && (
        <Pressable
          onPress={() => Linking.openURL(`tel:${phone}`)}
          className="h-11 w-11 items-center justify-center rounded-full bg-blue-50"
          accessibilityLabel="Call"
        >
          <Ionicons name="call-outline" size={19} color={BLUE} />
        </Pressable>
      )}
    </View>
  );
}

function Card({ icon, title, children }: { icon: ComponentProps<typeof Ionicons>['name']; title: string; children: ReactNode }) {
  return (
    <View className="rounded-2xl border border-gray-200 bg-white p-4">
      <View className="mb-3 flex-row items-center gap-2">
        <Ionicons name={icon} size={17} color={BLUE} />
        <Text className="text-[15px] font-bold text-gray-900">{title}</Text>
      </View>
      {children}
    </View>
  );
}

function RemoveButton({ label, onPress, disabled }: { label: string; onPress: () => void; disabled?: boolean }) {
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      className="flex-row items-center justify-center gap-2 rounded-xl border border-red-200 bg-white py-3 disabled:opacity-50"
    >
      <Ionicons name="person-remove-outline" size={17} color="#DC2626" />
      <Text className="text-sm font-semibold text-red-600">{label}</Text>
    </Pressable>
  );
}

const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

/** The edit form's state plus its draft: starts from the saved record (or a
 * draft left on this device, if one differs from it), knows whether there
 * are unsaved edits, and quietly keeps them as a draft whenever the reseller
 * leaves the page - back button, hardware back, another tab - so nothing
 * typed is ever lost to a mis-tap. */
function useEmployeeEditor<T>(draftKey: string, saved: T | null, name: string) {
  const draft = useFormDraft<T>(draftKey);
  const [form, setForm] = useState<T | null>(null);
  const [baseline, setBaseline] = useState<T | null>(null);
  const [restoredAt, setRestoredAt] = useState<string | null>(null);

  useEffect(() => {
    if (form || !saved || !draft.loaded) return;
    setBaseline(saved);
    if (draft.draft && !same(draft.draft.values, saved)) {
      setForm(draft.draft.values);
      setRestoredAt(draft.draft.savedAt);
    } else {
      setForm(saved);
      if (draft.draft) draft.clearDraft();
    }
  }, [form, saved, draft.loaded, draft.draft, draft.clearDraft]);

  const dirty = !!form && !!baseline && !same(form, baseline);
  const drafted = dirty && !!draft.draft && same(draft.draft.values, form);

  // Refs so the blur handler below sees the latest values, not the ones
  // from when the screen first got focus.
  const latest = useRef({ form, dirty, drafted, name, removed: false, saveDraft: draft.saveDraft });
  latest.current = { ...latest.current, form, dirty, drafted, name, saveDraft: draft.saveDraft };

  useFocusEffect(
    useCallback(
      () => () => {
        const { form: f, dirty: d, drafted: kept, removed, saveDraft, name: n } = latest.current;
        if (!f || !d || kept || removed) return;
        saveDraft(f);
        showAlert('Draft saved', `Your unsaved changes to ${n || 'this employee'} are kept - open them again to finish.`);
      },
      []
    )
  );

  return {
    form,
    setForm: (update: (f: T) => T) => setForm((f) => (f ? update(f) : f)),
    dirty,
    drafted,
    draftSavedAt: drafted ? draft.draft!.savedAt : null,
    restoredAt: dirty ? restoredAt : null,
    saveDraft: () => form && draft.saveDraft(form),
    discardDraft: () => {
      draft.clearDraft();
      setForm(baseline);
      setRestoredAt(null);
    },
    markSaved: () => {
      draft.clearDraft();
      setBaseline(form);
      setRestoredAt(null);
    },
    markRemoved: () => {
      latest.current.removed = true;
      draft.clearDraft();
    },
  };
}

type Editor = ReturnType<typeof useEmployeeEditor<unknown>>;

function RestoredDraftBanner({ at, onDiscard }: { at: string; onDiscard: () => void }) {
  return (
    <View className="flex-row items-center gap-2.5 rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3">
      <Ionicons name="bookmark" size={17} color="#B45309" />
      <Text className="flex-1 text-[13px] leading-[18px] text-amber-900">
        Picked up your draft from {formatDraftTime(at)} - it isn't saved to the team yet.
      </Text>
      <Pressable onPress={onDiscard} hitSlop={6} className="rounded-lg px-2 py-1.5 active:bg-amber-100">
        <Text className="text-[13px] font-bold text-amber-800">Discard</Text>
      </Pressable>
    </View>
  );
}

/** Pinned under the form: where the edits stand, and the two ways to keep
 * them - a draft on this device, or saved for real. */
function SaveBar({ editor, saving, onSave }: { editor: Pick<Editor, 'dirty' | 'drafted' | 'draftSavedAt' | 'saveDraft'>; saving: boolean; onSave: () => void }) {
  const insets = useSafeAreaInsets();
  const status = !editor.dirty
    ? { icon: 'checkmark-circle' as const, color: '#15803D', text: 'All changes saved' }
    : editor.drafted
      ? { icon: 'bookmark' as const, color: '#B45309', text: `Draft saved ${formatDraftTime(editor.draftSavedAt!)} · not on the team yet` }
      : { icon: 'ellipse' as const, color: '#D97706', text: 'Unsaved changes' };

  return (
    <View
      className="border-t border-gray-200 bg-white px-4 pt-2.5"
      style={{
        paddingBottom: Math.max(insets.bottom, 12),
        shadowColor: '#000',
        shadowOpacity: 0.06,
        shadowRadius: 8,
        shadowOffset: { width: 0, height: -2 },
        elevation: 8,
      }}
    >
      <View style={{ maxWidth: MAX_WIDTH, width: '100%', alignSelf: 'center' }}>
        <View className="mb-2 flex-row items-center gap-1.5">
          <Ionicons name={status.icon} size={status.icon === 'ellipse' ? 8 : 13} color={status.color} />
          <Text className="text-xs font-medium" style={{ color: status.color }} numberOfLines={1}>
            {status.text}
          </Text>
        </View>
        <View className="flex-row" style={{ gap: 10 }}>
          <Pressable
            onPress={editor.saveDraft}
            disabled={!editor.dirty || editor.drafted || saving}
            className="h-12 flex-1 flex-row items-center justify-center gap-1.5 rounded-xl border border-gray-300 bg-white disabled:opacity-40"
          >
            <Ionicons name="bookmark-outline" size={17} color="#374151" />
            <Text className="text-[15px] font-semibold text-gray-700">Save draft</Text>
          </Pressable>
          <Pressable
            onPress={onSave}
            disabled={!editor.dirty || saving}
            className="h-12 flex-[1.4] flex-row items-center justify-center gap-2 rounded-xl disabled:opacity-40"
            style={{ backgroundColor: BLUE }}
          >
            <Ionicons name="checkmark" size={18} color="#fff" />
            <Text className="text-[15px] font-bold text-white">{saving ? 'Saving…' : 'Save changes'}</Text>
          </Pressable>
        </View>
      </View>
    </View>
  );
}

function Page({ children, footer }: { children: ReactNode; footer?: ReactNode }) {
  const wide = useWideDetail();
  return (
    <View className="flex-1 bg-gray-50">
      <ScrollView
        className="flex-1"
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={{ padding: wide ? 32 : 16, paddingBottom: 32, maxWidth: MAX_WIDTH, width: '100%', alignSelf: 'center', gap: 16 }}
      >
        {children}
      </ScrollView>
      {footer}
    </View>
  );
}

function Loading({ text }: { text: string }) {
  return (
    <Page>
      <Text className="px-1 text-sm text-gray-500">{text}</Text>
    </Page>
  );
}

function leave() {
  if (router.canGoBack()) router.back();
  else router.replace('/(reseller)/employees' as any);
}

/** An employee with their own Jageer account. Same fields as a hand-added
 * person, except name, email and phone belong to their account - the
 * employer owns the job title, work hours and note (enforced by the
 * technician_employment_hours_guard trigger). They can also be sent a job
 * straight from here. */
function TechnicianEmployee({ employmentId }: { employmentId: string }) {
  const userId = useAuthStore((state) => state.session?.user.id);
  const { data: employees } = useMyEmployees(userId);
  const emailOf = useEmployeeEmails(userId);
  const match = employees.find((e) => e.employment.id === employmentId);
  const update = useUpdateEmployment();
  const endEmployment = useEndEmployment();

  const saved = useMemo(
    () =>
      match
        ? {
            jobTitle: match.employment.job_title ?? '',
            note: match.employment.employer_note ?? '',
            start: match.employment.work_start_time?.slice(0, 5) ?? '09:00',
            end: match.employment.work_end_time?.slice(0, 5) ?? '17:00',
            staffRole: (match.employment.staff_role ?? 'technician') as 'technician' | 'supervisor',
          }
        : null,
    [match?.employment]
  );
  const name = match?.profile.full_name ?? 'Technician';
  const editor = useEmployeeEditor(`employee:${employmentId}`, saved, name);
  const { form, setForm } = editor;

  if (!match || !form) return <Loading text="Loading…" />;
  const { profile } = match;
  const email = emailOf.get(profile.id) ?? null;

  async function handleSave() {
    if (!form) return;
    const hoursIssue = workHoursIssue(form.start, form.end);
    if (hoursIssue) {
      showAlert('Check the work hours', hoursIssue);
      return;
    }
    try {
      await update.save(employmentId, {
        job_title: form.jobTitle.trim() || null,
        employer_note: form.note.trim() || null,
        work_start_time: form.start,
        work_end_time: form.end,
        staff_role: form.staffRole,
      });
      editor.markSaved();
      showAlert('Saved', `${name}'s details are updated.`);
    } catch (err) {
      showAlert('Could not save', getErrorMessage(err));
    }
  }

  function handleRemove() {
    showAlert('Remove from your team?', `${name} will go back to being an outsource technician.`, [
      { text: 'Keep', style: 'cancel' },
      {
        text: 'Remove',
        style: 'destructive',
        onPress: async () => {
          try {
            await endEmployment.end(employmentId);
            editor.markRemoved();
            leave();
          } catch (err) {
            showAlert('Could not remove', getErrorMessage(err));
          }
        },
      },
    ]);
  }

  return (
    <Page footer={<SaveBar editor={editor} saving={update.isPending} onSave={handleSave} />}>
      <Header
        name={name}
        subtitle={`Has a Jageer account${form.jobTitle ? ` · ${form.jobTitle}` : ''}`}
        photoUrl={profile.avatar_url}
        phone={profile.phone}
      />

      <Card icon="paper-plane-outline" title="Assign a job">
        <AssignJobList technicianId={profile.id} technicianName={name} />
      </Card>

      {!!editor.restoredAt && <RestoredDraftBanner at={editor.restoredAt} onDiscard={editor.discardDraft} />}

      <Card icon="create-outline" title="Details">
        <Field label="Name" hint="From their own account - only they can change it.">
          <ReadOnlyValue value={profile.full_name} empty="No name yet" />
        </Field>
        <Field label="Email" hint="The address they signed in with.">
          <ReadOnlyValue value={email} empty="No email on their account" />
        </Field>
        <Field label="Phone number">
          <ReadOnlyValue value={profile.phone} empty="No phone on their account" />
        </Field>
        <Field
          label="Role on your team"
          hint="A supervisor gets their own Work Hub and can hand your jobs to the rest of the team. Only you can change this."
        >
          <View className="flex-row" style={{ gap: 10 }}>
            {(
              [
                { key: 'technician', label: 'Technician', body: 'Carries their own jobs', icon: 'construct-outline' },
                { key: 'supervisor', label: 'Supervisor', body: 'Can assign work to others', icon: 'people-outline' },
              ] as const
            ).map((option) => {
              const active = form.staffRole === option.key;
              return (
                <Pressable
                  key={option.key}
                  onPress={() => setForm((f) => ({ ...f, staffRole: option.key }))}
                  className="flex-1 rounded-xl p-3"
                  style={{
                    borderWidth: active ? 2 : 1,
                    borderColor: active ? BLUE : '#D1D5DB',
                    backgroundColor: active ? '#EFF6FF' : '#FFFFFF',
                  }}
                >
                  <View className="flex-row items-center gap-1.5">
                    <Ionicons name={option.icon} size={15} color={active ? BLUE : '#6B7280'} />
                    <Text className={`text-[13.5px] font-bold ${active ? 'text-blue-700' : 'text-gray-700'}`}>
                      {option.label}
                    </Text>
                  </View>
                  <Text className="mt-0.5 text-[11px] text-gray-500">{option.body}</Text>
                </Pressable>
              );
            })}
          </View>
        </Field>

        <Field label="Job title" hint="Your label for what they do - they can't change it.">
          <Input value={form.jobTitle} onChangeText={(v) => setForm((f) => ({ ...f, jobTitle: v }))} placeholder="CCTV technician, helper, driver…" />
        </Field>
        <Field label="Work hours" hint="You set these - the technician can see them but can't change them. While on duty they work only for you.">
          <HoursRow
            start={form.start}
            end={form.end}
            setStart={(v) => setForm((f) => ({ ...f, start: v }))}
            setEnd={(v) => setForm((f) => ({ ...f, end: v }))}
          />
        </Field>
        <Field label="Notes" hint="Private to you.">
          <Input
            value={form.note}
            onChangeText={(v) => setForm((f) => ({ ...f, note: v }))}
            placeholder="Anything you want to remember"
            multiline
            style={{ minHeight: 76, textAlignVertical: 'top' }}
          />
        </Field>
      </Card>

      <RemoveButton label="Remove from my team" onPress={handleRemove} disabled={endEmployment.isPending} />
    </Page>
  );
}

/** Someone added by hand - every detail is the reseller's to edit. */
function ManualEmployee({ id }: { id: string }) {
  const { data: employee, isLoading } = useSupabaseRow('manual_employees', id);
  const update = useSupabaseUpdate('manual_employees');
  const remove = useSupabaseDelete('manual_employees');

  const saved = useMemo(
    () =>
      employee
        ? {
            name: employee.name ?? '',
            email: employee.email ?? '',
            phone: employee.phone ?? '',
            jobTitle: employee.job_title ?? '',
            note: employee.note ?? '',
            start: employee.work_start_time?.slice(0, 5) ?? '09:00',
            end: employee.work_end_time?.slice(0, 5) ?? '17:00',
            active: employee.is_active,
          }
        : null,
    [employee]
  );
  const editor = useEmployeeEditor(`manual-employee:${id}`, saved, employee?.name ?? '');
  const { form, setForm } = editor;

  if (isLoading && !employee) return <Loading text="Loading…" />;
  if (!employee) return <Loading text="This employee is no longer on your team." />;
  if (!form) return <Loading text="Loading…" />;

  async function handleSave() {
    if (!form) return;
    const hoursIssue = workHoursIssue(form.start, form.end);
    if (hoursIssue) {
      showAlert('Check the work hours', hoursIssue);
      return;
    }
    if (!form.name.trim()) {
      showAlert('Add a name', 'Type the name of the person you are keeping on your team.');
      return;
    }
    if (form.phone.trim() && !isValidPhone10(form.phone.trim())) {
      showAlert('Check the phone number', 'Enter a 10-digit number, or leave it blank.');
      return;
    }
    try {
      await update.mutateAsync({
        id,
        values: {
          name: form.name.trim(),
          email: form.email.trim() || null,
          phone: form.phone.trim() || null,
          job_title: form.jobTitle.trim() || null,
          note: form.note.trim() || null,
          work_start_time: form.start,
          work_end_time: form.end,
          is_active: form.active,
        },
      });
      editor.markSaved();
      showAlert('Saved', `${form.name.trim()}'s details are updated.`);
    } catch (err) {
      showAlert('Could not save', getErrorMessage(err));
    }
  }

  function handleRemove() {
    showAlert('Remove from your team?', `${form?.name || 'This person'} will be deleted from your team list.`, [
      { text: 'Keep', style: 'cancel' },
      {
        text: 'Remove',
        style: 'destructive',
        onPress: async () => {
          try {
            await remove.mutateAsync(id);
            editor.markRemoved();
            leave();
          } catch (err) {
            showAlert('Could not remove', getErrorMessage(err));
          }
        },
      },
    ]);
  }

  return (
    <Page footer={<SaveBar editor={editor} saving={update.isPending} onSave={handleSave} />}>
      <Header name={form.name} subtitle={`Added by you${form.jobTitle ? ` · ${form.jobTitle}` : ''}`} phone={form.phone || null} />

      {!!editor.restoredAt && <RestoredDraftBanner at={editor.restoredAt} onDiscard={editor.discardDraft} />}

      <Card icon="create-outline" title="Details">
        <Field label="Name">
          <Input value={form.name} onChangeText={(v) => setForm((f) => ({ ...f, name: v }))} placeholder="Full name" />
        </Field>
        <Field label="Email" hint="If they sign up with this address, they link to your team automatically - then you can send them jobs.">
          <Input
            value={form.email}
            onChangeText={(v) => setForm((f) => ({ ...f, email: v }))}
            placeholder="name@example.com"
            keyboardType="email-address"
            autoCapitalize="none"
          />
        </Field>
        <Field label="Phone number">
          <Input
            value={form.phone}
            onChangeText={(v) => setForm((f) => ({ ...f, phone: v.replace(/[^0-9]/g, '') }))}
            placeholder="98XXXXXXXX"
            keyboardType="phone-pad"
            maxLength={10}
          />
        </Field>
        <Field label="Job title">
          <Input value={form.jobTitle} onChangeText={(v) => setForm((f) => ({ ...f, jobTitle: v }))} placeholder="CCTV technician, helper, driver…" />
        </Field>
        <Field label="Work hours">
          <HoursRow
            start={form.start}
            end={form.end}
            setStart={(v) => setForm((f) => ({ ...f, start: v }))}
            setEnd={(v) => setForm((f) => ({ ...f, end: v }))}
          />
        </Field>
        <Field label="Notes" hint="Private to you.">
          <Input
            value={form.note}
            onChangeText={(v) => setForm((f) => ({ ...f, note: v }))}
            placeholder="Anything you want to remember"
            multiline
            style={{ minHeight: 76, textAlignVertical: 'top' }}
          />
        </Field>

        <Pressable
          onPress={() => setForm((f) => ({ ...f, active: !f.active }))}
          className="flex-row items-center gap-2.5 rounded-lg border border-gray-200 bg-gray-50 px-3.5 py-3"
        >
          <Ionicons name={form.active ? 'checkmark-circle' : 'ellipse-outline'} size={20} color={form.active ? '#059669' : '#9CA3AF'} />
          <Text className="flex-1 text-sm font-medium text-gray-800">
            {form.active ? 'Currently working for you' : 'No longer working for you'}
          </Text>
        </Pressable>
      </Card>

      <RemoveButton label="Remove from my team" onPress={handleRemove} disabled={remove.isPending} />
    </Page>
  );
}

/** One employee's page. `kind=manual` opens a hand-added person; anything
 * else is an employment row for a technician with their own account. Both
 * show the same fields in the same order. Keyed by id: this tab screen stays
 * mounted between visits, so opening a second employee must start a fresh
 * form rather than keep showing the first one's. */
export default function EmployeeDetail() {
  const { id, kind } = useLocalSearchParams<{ id: string; kind?: string }>();
  return kind === 'manual' ? <ManualEmployee key={`manual:${id}`} id={id} /> : <TechnicianEmployee key={`account:${id}`} employmentId={id} />;
}
