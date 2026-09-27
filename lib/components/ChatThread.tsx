// lib/components/ChatThread.tsx
import { useCallback, useEffect, useRef, useState } from 'react';
import { View, Text, TextInput, Pressable, FlatList } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { supabase } from '../supabase';
import { useAuthStore } from '../hooks/useAuth';
import { useSupabaseInsert, subscribeToTable } from '../hooks/useSupabase';
import { showAlert, getErrorMessage } from '../utils/alert';
import type { Message, MessageSubjectType } from '../../types/database.types';

interface ChatThreadProps {
  subjectType: MessageSubjectType;
  subjectId: string;
  /** Bump this to put the cursor in the box - the customer's "Message"
   * button scrolls here and hands over the keyboard. */
  focusToken?: number;
}

export function ChatThread({ subjectType, subjectId, focusToken }: ChatThreadProps) {
  const userId = useAuthStore((state) => state.session?.user.id);
  const [messages, setMessages] = useState<Message[]>([]);
  const [body, setBody] = useState('');
  const insertMessage = useSupabaseInsert('messages');
  const inputRef = useRef<TextInput>(null);

  useEffect(() => {
    if (focusToken) inputRef.current?.focus();
  }, [focusToken]);

  const load = useCallback(async () => {
    const { data } = await supabase
      .from('messages')
      .select('*')
      .eq('subject_type', subjectType)
      .eq('subject_id', subjectId)
      .order('created_at', { ascending: true });
    setMessages((data ?? []) as Message[]);
  }, [subjectType, subjectId]);

  useEffect(() => {
    load();
    const unsubscribe = subscribeToTable('messages', load, `subject_id=eq.${subjectId}`);
    return unsubscribe;
  }, [load, subjectId]);

  async function handleSend() {
    if (!userId || !body.trim()) return;
    const text = body.trim();
    setBody('');
    try {
      await insertMessage.mutateAsync({
        subject_type: subjectType,
        subject_id: subjectId,
        sender_id: userId,
        body: text,
      });
    } catch (err) {
      // Put the message back so a failed send doesn't lose what was typed.
      setBody((current) => current || text);
      showAlert('Message not sent', getErrorMessage(err));
      return;
    }
    // Realtime only tells us about other people's messages once the table is
    // published, and never covers our own optimistically - reload so the
    // message you just sent shows up straight away either way.
    await load();
  }

  // No card of its own - the detail page already wraps this in one.
  return (
    <View>
      {messages.length === 0 && <Text className="mb-3 text-sm text-gray-400">No messages yet.</Text>}

      <FlatList
        data={messages}
        keyExtractor={(item) => item.id}
        scrollEnabled={false}
        renderItem={({ item }) => {
          const mine = item.sender_id === userId;
          return (
            <View
              className={`mb-2.5 max-w-[80%] px-3.5 py-2.5 ${mine ? 'self-end bg-blue-600' : 'self-start bg-gray-100'}`}
              style={{
                borderRadius: 14,
                borderBottomRightRadius: mine ? 4 : 14,
                borderBottomLeftRadius: mine ? 14 : 4,
              }}
            >
              <Text className={`text-[13px] ${mine ? 'text-white' : 'text-gray-900'}`}>{item.body}</Text>
            </View>
          );
        }}
      />

      <View className="mt-2 flex-row items-center gap-2">
        <TextInput
          ref={inputRef}
          value={body}
          onChangeText={setBody}
          placeholder="Type a message…"
          className="flex-1 rounded-[10px] border border-gray-300 px-3.5 text-sm"
          style={{ height: 42 }}
        />
        <Pressable
          onPress={handleSend}
          className="items-center justify-center rounded-[10px] bg-blue-500"
          style={{ width: 42, height: 42 }}
        >
          <Ionicons name="send" size={17} color="#fff" />
        </Pressable>
      </View>
    </View>
  );
}
