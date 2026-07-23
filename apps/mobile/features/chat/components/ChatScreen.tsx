import { useState, useEffect, useRef, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TextInput,
  TouchableOpacity,
  FlatList,
  KeyboardAvoidingView,
  Platform,
  ActivityIndicator,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { ArrowLeft } from 'lucide-react-native';
import { supabase } from '@/lib/supabase';
import { colors, typography, spacing, radii } from '@/theme';

interface Message {
  id: string;
  sender_id: string;
  message: string;
  created_at: string;
  is_read: boolean;
}

interface ChatScreenProps {
  requestId: string;
  currentUserId: string;
  otherUserName: string | null;
  onClose: () => void;
}

export function ChatScreen({
  requestId,
  currentUserId,
  otherUserName,
  onClose,
}: ChatScreenProps) {
  const insets = useSafeAreaInsets();
  const [messages, setMessages] = useState<Message[]>([]);
  const [newMessage, setNewMessage] = useState('');
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);
  const [hasError, setHasError] = useState(false);

  const flatListRef = useRef<FlatList>(null);

  // Log props only on mount or when they change
  useEffect(() => {
    console.log('=== ChatScreen MOUNTED ===');
    console.log('requestId:', requestId);
    console.log('currentUserId:', currentUserId);
    console.log('otherUserName:', otherUserName);
  }, [requestId, currentUserId, otherUserName]);

  // Fetch initial messages
  const fetchMessages = useCallback(async () => {
    try {
      console.log('Fetching messages for request:', requestId);

      if (!requestId) {
        console.error('No requestId provided!');
        setLoading(false);
        return;
      }

      const { data, error } = await supabase
        .from('request_messages')
        .select('*')
        .eq('request_id', requestId)
        .order('created_at', { ascending: true });

      if (error) {
        console.error('Error fetching messages:', error);
        setHasError(true);
      } else {
        console.log('Messages fetched:', data?.length || 0);
        setMessages(data || []);
      }
    } catch (err) {
      console.error('Exception fetching messages:', err);
      setHasError(true);
    } finally {
      setLoading(false);
    }
  }, [requestId]);

  // Subscribe to new messages
  useEffect(() => {
    if (!requestId) {
      console.log('No requestId, skipping initialization');
      setLoading(false);
      return;
    }

    let isMounted = true;
    let channel: ReturnType<typeof supabase.channel> | null = null;

    const init = async () => {
      await fetchMessages();

      if (!isMounted) return;

      try {
        console.log('Setting up realtime subscription for:', requestId);

        channel = supabase
          .channel(`chat:${requestId}`)
          .on(
            'postgres_changes',
            {
              event: 'INSERT',
              schema: 'public',
              table: 'request_messages',
              filter: `request_id=eq.${requestId}`,
            },
            (payload) => {
              console.log('New message received:', payload);
              if (isMounted) {
                const newMsg = payload.new as Message;
                setMessages((prev) => [...prev, newMsg]);
              }
            }
          )
          .subscribe((status) => {
            console.log('Realtime subscription status:', status);
          });
      } catch (err) {
        console.error('Error setting up realtime:', err);
      }
    };

    init();

    return () => {
      console.log('Cleaning up ChatScreen');
      isMounted = false;
      if (channel) {
        supabase.removeChannel(channel);
      }
    };
  }, [requestId, fetchMessages]);

  // Scroll to bottom when new messages arrive
  useEffect(() => {
    if (messages.length > 0) {
      setTimeout(() => {
        flatListRef.current?.scrollToEnd({ animated: true });
      }, 100);
    }
  }, [messages.length]);

  const sendMessage = async () => {
    const trimmedMessage = newMessage.trim();
    if (!trimmedMessage || sending) return;

    setSending(true);
    setNewMessage('');

    try {
      console.log('Sending message:', trimmedMessage);
      const { error } = await supabase.rpc('send_message', {
        p_request_id: requestId,
        p_message: trimmedMessage,
      });

      if (error) {
        console.error('Error sending message:', error);
        setNewMessage(trimmedMessage); // Restore message on error
      } else {
        console.log('Message sent successfully');
      }
    } catch (err) {
      console.error('Send message exception:', err);
      setNewMessage(trimmedMessage);
    } finally {
      setSending(false);
    }
  };

  const formatTime = (dateString: string) => {
    const date = new Date(dateString);
    return date.toLocaleTimeString('es-ES', {
      hour: '2-digit',
      minute: '2-digit',
    });
  };

  const renderMessage = ({ item }: { item: Message }) => {
    const isOwnMessage = item.sender_id === currentUserId;

    return (
      <View
        style={[
          styles.messageContainer,
          isOwnMessage ? styles.ownMessage : styles.otherMessage,
        ]}
      >
        <View
          style={[
            styles.messageBubble,
            isOwnMessage ? styles.ownBubble : styles.otherBubble,
          ]}
        >
          <Text
            style={[
              styles.messageText,
              isOwnMessage ? styles.ownText : styles.otherText,
            ]}
          >
            {item.message}
          </Text>
          <Text
            style={[
              styles.messageTime,
              isOwnMessage ? styles.ownTime : styles.otherTime,
            ]}
          >
            {formatTime(item.created_at)}
          </Text>
        </View>
      </View>
    );
  };

  // Error state
  if (hasError) {
    return (
      <View style={styles.errorContainer}>
        <Text style={styles.errorText}>
          No se pudo cargar el chat. Intenta de nuevo.
        </Text>
        <TouchableOpacity onPress={onClose} style={styles.errorButton}>
          <Text style={styles.errorButtonText}>Cerrar</Text>
        </TouchableOpacity>
      </View>
    );
  }

  // Loading state
  if (loading) {
    return (
      <View style={styles.loadingContainer}>
        <ActivityIndicator size="large" color="#2563eb" />
        <Text style={styles.loadingText}>Cargando chat...</Text>
      </View>
    );
  }

  return (
    <KeyboardAvoidingView
      style={styles.container}
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      keyboardVerticalOffset={Platform.OS === 'ios' ? 90 : 0}
    >
      {/* Header */}
      <View style={[styles.header, { paddingTop: insets.top + spacing.xs }]}>
        <TouchableOpacity onPress={onClose} style={styles.backButton}>
          <ArrowLeft size={20} color={colors.primary[500]} strokeWidth={2} />
          <Text style={styles.backButtonText}>Volver</Text>
        </TouchableOpacity>
        <View style={styles.headerInfo}>
          <Text style={styles.headerTitle}>Chat</Text>
          {otherUserName && (
            <Text style={styles.headerSubtitle}>con {otherUserName}</Text>
          )}
        </View>
        <View style={styles.headerSpacer} />
      </View>

      {/* Messages List */}
      <FlatList
        ref={flatListRef}
        data={messages}
        keyExtractor={(item) => item.id}
        renderItem={renderMessage}
        contentContainerStyle={styles.messagesList}
        ListEmptyComponent={
          <View style={styles.emptyContainer}>
            <Text style={styles.emptyText}>No hay mensajes aún</Text>
            <Text style={styles.emptySubtext}>
              Envía un mensaje para comenzar la conversación
            </Text>
          </View>
        }
      />

      {/* Input Area */}
      <View style={[styles.inputContainer, { paddingBottom: Math.max(insets.bottom, spacing.s) }]}>
        <TextInput
          style={styles.textInput}
          placeholder="Escribe un mensaje..."
          placeholderTextColor={colors.text.tertiary}
          value={newMessage}
          onChangeText={setNewMessage}
          multiline
          maxLength={500}
          editable={!sending}
        />
        <TouchableOpacity
          style={[
            styles.sendButton,
            (!newMessage.trim() || sending) && styles.sendButtonDisabled,
          ]}
          onPress={sendMessage}
          disabled={!newMessage.trim() || sending}
        >
          {sending ? (
            <ActivityIndicator size="small" color={colors.text.inverse} />
          ) : (
            <Text style={styles.sendButtonText}>Enviar</Text>
          )}
        </TouchableOpacity>
      </View>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.background.secondary,
  },
  loadingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: colors.background.secondary,
    gap: spacing.s,
  },
  loadingText: {
    fontFamily: typography.fonts.body,
    fontSize: typography.sizes.body,
    color: colors.text.secondary,
  },
  errorContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: colors.background.secondary,
    padding: spacing.l,
  },
  errorText: {
    fontFamily: typography.fonts.body,
    fontSize: typography.sizes.body,
    color: colors.text.secondary,
    textAlign: 'center',
    marginBottom: spacing.l,
  },
  errorButton: {
    paddingVertical: spacing.s,
    paddingHorizontal: spacing.l,
    backgroundColor: colors.primary[500],
    borderRadius: radii.m,
  },
  errorButtonText: {
    fontFamily: typography.fonts.bodySemiBold,
    color: colors.text.inverse,
    fontSize: typography.sizes.body,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: spacing.m,
    paddingBottom: spacing.s,
    backgroundColor: colors.background.primary,
    borderBottomWidth: 1,
    borderBottomColor: colors.border.light,
  },
  backButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.micro,
    minHeight: 44,
    paddingRight: spacing.xs,
  },
  backButtonText: {
    fontFamily: typography.fonts.bodyMedium,
    fontSize: typography.sizes.body,
    color: colors.primary[500],
  },
  headerInfo: {
    flex: 1,
    alignItems: 'center',
  },
  headerTitle: {
    fontFamily: typography.fonts.heading,
    fontSize: typography.sizes.h4,
    color: colors.text.primary,
  },
  headerSubtitle: {
    fontFamily: typography.fonts.body,
    fontSize: typography.sizes.caption,
    color: colors.text.secondary,
    marginTop: 2,
  },
  headerSpacer: {
    width: 70,
  },
  messagesList: {
    padding: spacing.m,
    flexGrow: 1,
  },
  messageContainer: {
    marginBottom: spacing.s,
  },
  ownMessage: {
    alignItems: 'flex-end',
  },
  otherMessage: {
    alignItems: 'flex-start',
  },
  messageBubble: {
    maxWidth: '80%',
    paddingVertical: spacing.s,
    paddingHorizontal: spacing.m,
    borderRadius: radii.l,
  },
  ownBubble: {
    backgroundColor: colors.primary[500],
    borderBottomRightRadius: spacing.micro,
  },
  otherBubble: {
    backgroundColor: colors.background.primary,
    borderBottomLeftRadius: spacing.micro,
    borderWidth: 1,
    borderColor: colors.border.light,
  },
  messageText: {
    fontFamily: typography.fonts.body,
    fontSize: typography.sizes.bodySmall,
    lineHeight: typography.lineHeights.bodySmall,
  },
  ownText: {
    color: colors.text.inverse,
  },
  otherText: {
    color: colors.text.primary,
  },
  messageTime: {
    fontFamily: typography.fonts.body,
    fontSize: typography.sizes.micro,
    marginTop: spacing.micro,
  },
  ownTime: {
    color: 'rgba(255, 255, 255, 0.7)',
  },
  otherTime: {
    color: colors.text.tertiary,
  },
  emptyContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingVertical: spacing.xxxxl,
  },
  emptyText: {
    fontFamily: typography.fonts.bodyMedium,
    fontSize: typography.sizes.body,
    color: colors.text.secondary,
    marginBottom: spacing.micro,
  },
  emptySubtext: {
    fontFamily: typography.fonts.body,
    fontSize: typography.sizes.bodySmall,
    color: colors.text.tertiary,
    textAlign: 'center',
  },
  inputContainer: {
    flexDirection: 'row',
    paddingHorizontal: spacing.s,
    paddingTop: spacing.s,
    backgroundColor: colors.background.primary,
    borderTopWidth: 1,
    borderTopColor: colors.border.light,
    gap: spacing.xs,
  },
  textInput: {
    flex: 1,
    fontFamily: typography.fonts.body,
    backgroundColor: colors.background.tertiary,
    borderRadius: radii.full,
    paddingHorizontal: spacing.m,
    paddingVertical: spacing.s,
    fontSize: typography.sizes.bodySmall,
    maxHeight: 100,
    color: colors.text.primary,
  },
  sendButton: {
    backgroundColor: colors.primary[500],
    borderRadius: radii.full,
    paddingHorizontal: spacing.l,
    paddingVertical: spacing.s,
    justifyContent: 'center',
    alignItems: 'center',
    minWidth: 70,
  },
  sendButtonDisabled: {
    backgroundColor: colors.primary[200],
  },
  sendButtonText: {
    fontFamily: typography.fonts.bodySemiBold,
    color: colors.text.inverse,
    fontSize: typography.sizes.bodySmall,
  },
});
