const { createApp } = Vue;

createApp({
  data() {
    return {
      // Current user
      currentUser: {
        id: null,
        username: '',
        displayName: '',
        avatar: 'default',
        status: 'online',
        statusMessage: ''
      },

      // UI state
      sidebarTab: 'contacts',
      showAddContact: false,
      showProfileModal: false,
      showEmojiPicker: false,

      // Contacts
      contacts: [],
      collapsedGroups: { online: false, offline: true },

      // Search
      searchQuery: '',
      searchResults: [],
      searchTimer: null,

      // Active chat
      activeChat: null,
      activeMessages: [],
      messageText: '',
      canLoadMore: false,
      unreadCounts: {},

      // Rooms
      rooms: [],
      activeRoom: null,
      roomMessages: [],
      roomMessageText: '',

      // Typing
      typingUsers: {},
      typingTimer: null,

      // Profile edit
      editProfile: { displayName: '', statusMessage: '', avatar: 'default' },

      // Context menu
      contextMenu: { visible: false, x: 0, y: 0, contact: null },

      // Toast
      toast: { visible: false, message: '', type: 'success' },

      // Socket
      socket: null,

      // Emojis
      emojis: ['😊','😂','😍','🥰','😎','😢','😭','😡','🤔','😴',
               '👍','👎','❤️','🔥','⭐','🎉','🎊','🙏','💯','✅',
               ':-)',':-D',':-P',':-|',':-(',';-)',':-O','8-)','>:-(',':-*',
               '🐱','🐶','🦊','🐼','🎮','🏆','🎵','💻','📱','🌟'],

      avatarOptions: [
        { key: 'default', emoji: '😊' },
        { key: 'cool',    emoji: '😎' },
        { key: 'cat',     emoji: '🐱' },
        { key: 'dog',     emoji: '🐶' },
        { key: 'fox',     emoji: '🦊' },
        { key: 'panda',   emoji: '🐼' },
        { key: 'robot',   emoji: '🤖' },
        { key: 'alien',   emoji: '👽' },
        { key: 'wizard',  emoji: '🧙' },
        { key: 'ninja',   emoji: '🥷' },
        { key: 'vampire', emoji: '🧛' },
        { key: 'clown',   emoji: '🤡' },
      ]
    };
  },

  computed: {
    onlineContacts() {
      return this.contacts.filter(c => c.status !== 'offline');
    },
    offlineContacts() {
      return this.contacts.filter(c => c.status === 'offline');
    }
  },

  methods: {
    // ──────── AVATAR ────────
    getAvatarEmoji(avatarKey) {
      const map = {
        default: '😊', cool: '😎', cat: '🐱', dog: '🐶', fox: '🦊',
        panda: '🐼', robot: '🤖', alien: '👽', wizard: '🧙', ninja: '🥷',
        vampire: '🧛', clown: '🤡'
      };
      return map[avatarKey] || '😊';
    },

    // ──────── AUTH ────────
    async checkAuth() {
      try {
        const res = await $.get('/api/auth/me');
        this.currentUser = res.user;
        this.editProfile = {
          displayName: res.user.displayName,
          statusMessage: res.user.statusMessage,
          avatar: res.user.avatar
        };
        this.connectSocket();
        this.loadContacts();
      } catch (e) {
        window.location.href = '/';
      }
    },

    async doLogout() {
      if (this.socket) this.socket.disconnect();
      await $.post('/api/auth/logout');
      window.location.href = '/';
    },

    // ──────── SOCKET ────────
    connectSocket() {
      // Get token from cookie
      const token = document.cookie.match(/token=([^;]+)/)?.[1];
      this.socket = io({ auth: { token } });

      this.socket.on('connect', () => {
        console.log('✅ Socket conectat');
      });

      this.socket.on('private_message', (msg) => {
        if (this.activeChat && (msg.sender_id === this.activeChat.id || msg.receiver_id === this.activeChat.id)) {
          this.activeMessages.push(msg);
          this.$nextTick(() => this.scrollToBottom());
        } else {
          // Update unread count
          const senderId = msg.sender_id;
          this.unreadCounts[senderId] = (this.unreadCounts[senderId] || 0) + 1;
          this.showToast(`Mesaj nou de la ${msg.sender_name}`, 'success');
          this.playNotificationSound();
        }
      });

      this.socket.on('message_sent', (msg) => {
        // Replace optimistic message or add
        const idx = this.activeMessages.findIndex(m => m._temp && m.content === msg.content);
        if (idx >= 0) {
          this.activeMessages.splice(idx, 1, msg);
        } else {
          this.activeMessages.push(msg);
          this.$nextTick(() => this.scrollToBottom());
        }
      });

      this.socket.on('contact_status', ({ userId, status, statusMessage }) => {
        const contact = this.contacts.find(c => c.id === userId);
        if (contact) {
          contact.status = status;
          if (statusMessage !== undefined) contact.status_message = statusMessage;
        }
        if (this.activeChat && this.activeChat.id === userId) {
          this.activeChat.status = status;
        }
      });

      this.socket.on('typing_start', ({ fromUserId }) => {
        this.typingUsers[fromUserId] = true;
      });

      this.socket.on('typing_stop', ({ fromUserId }) => {
        delete this.typingUsers[fromUserId];
      });

      this.socket.on('room_message', (msg) => {
        if (this.activeRoom && msg.room_id === this.activeRoom.id) {
          this.roomMessages.push(msg);
          this.$nextTick(() => this.scrollRoomToBottom());
        }
      });

      this.socket.on('room_user_joined', ({ displayName, memberCount, roomId }) => {
        if (this.activeRoom && this.activeRoom.id === roomId) {
          this.activeRoom.member_count = memberCount;
          this.roomMessages.push({
            id: Date.now(),
            type: 'system',
            content: `${displayName} a intrat în cameră`,
            created_at: new Date().toISOString()
          });
          this.$nextTick(() => this.scrollRoomToBottom());
        }
      });

      this.socket.on('room_user_left', ({ displayName, roomId }) => {
        if (this.activeRoom && this.activeRoom.id === roomId) {
          this.roomMessages.push({
            id: Date.now(),
            type: 'system',
            content: `${displayName} a plecat din cameră`,
            created_at: new Date().toISOString()
          });
          this.$nextTick(() => this.scrollRoomToBottom());
        }
      });
    },

    // ──────── CONTACTS ────────
    async loadContacts() {
      const res = await $.get('/api/chat/contacts');
      this.contacts = res.contacts;
      const unreadRes = await $.get('/api/chat/unread');
      unreadRes.counts.forEach(({ sender_id, count }) => {
        this.unreadCounts[sender_id] = count;
      });
    },

    toggleGroup(group) {
      this.collapsedGroups[group] = !this.collapsedGroups[group];
    },

    async searchUsers() {
      clearTimeout(this.searchTimer);
      if (this.searchQuery.length < 2) {
        this.searchResults = [];
        return;
      }
      this.searchTimer = setTimeout(async () => {
        const res = await $.get(`/api/chat/search?q=${encodeURIComponent(this.searchQuery)}`);
        this.searchResults = res.users;
      }, 300);
    },

    async addContact(user) {
      try {
        await $.post('/api/chat/contacts/add', JSON.stringify({ username: user.username }), 'json');
        this.showToast(`${user.display_name} adăugat la contacte!`, 'success');
        this.loadContacts();
        this.showAddContact = false;
        this.searchQuery = '';
        this.searchResults = [];
      } catch (err) {
        this.showToast(err.responseJSON?.error || 'Eroare la adăugare', 'error');
      }
    },

    async removeContact(contact) {
      await $.ajax({
        url: `/api/chat/contacts/${contact.id}`,
        method: 'DELETE'
      });
      this.contacts = this.contacts.filter(c => c.id !== contact.id);
      if (this.activeChat && this.activeChat.id === contact.id) {
        this.activeChat = null;
      }
      this.contextMenu.visible = false;
      this.showToast('Contact șters', 'success');
    },

    showContactMenu(event, contact) {
      this.contextMenu = {
        visible: true,
        x: event.clientX,
        y: event.clientY,
        contact
      };
    },

    // ──────── CHAT ────────
    async openChat(contact) {
      this.activeRoom = null;
      this.activeChat = contact;
      this.activeMessages = [];
      this.canLoadMore = false;
      this.showEmojiPicker = false;

      // Clear unread
      delete this.unreadCounts[contact.id];

      const res = await $.get(`/api/chat/messages/${contact.id}`);
      this.activeMessages = res.messages;
      this.canLoadMore = res.messages.length >= 50;

      this.$nextTick(() => {
        this.scrollToBottom();
        this.$refs.messageInput?.focus();
      });
    },

    async loadMoreMessages() {
      if (!this.activeChat || this.activeMessages.length === 0) return;
      const oldest = this.activeMessages[0].id;
      const res = await $.get(`/api/chat/messages/${this.activeChat.id}?before=${oldest}`);
      this.activeMessages = [...res.messages, ...this.activeMessages];
      this.canLoadMore = res.messages.length >= 50;
    },

    sendMessage() {
      const content = this.messageText.trim();
      if (!content || !this.activeChat) return;

      this.socket.emit('private_message', {
        toUserId: this.activeChat.id,
        content
      });

      this.messageText = '';
      this.stopTyping();

      this.$nextTick(() => {
        this.$refs.messageInput?.focus();
      });
    },

    onTyping() {
      if (!this.activeChat) return;

      if (!this.isTyping) {
        this.isTyping = true;
        this.socket.emit('typing_start', { toUserId: this.activeChat.id });
      }

      clearTimeout(this.typingTimer);
      this.typingTimer = setTimeout(() => this.stopTyping(), 2000);
    },

    stopTyping() {
      if (this.isTyping && this.activeChat) {
        this.isTyping = false;
        this.socket.emit('typing_stop', { toUserId: this.activeChat.id });
      }
    },

    scrollToBottom() {
      const el = this.$refs.messagesContainer;
      if (el) el.scrollTop = el.scrollHeight;
    },

    // ──────── ROOMS ────────
    async loadRooms() {
      const res = await $.get('/api/chat/rooms');
      this.rooms = res.rooms;
    },

    async openRoom(room) {
      if (this.activeRoom) {
        this.socket.emit('leave_room', { roomId: this.activeRoom.id });
      }
      this.activeChat = null;
      this.activeRoom = room;
      this.roomMessages = [];
      this.showEmojiPicker = false;

      const res = await $.get(`/api/chat/rooms/${room.id}/messages`);
      this.roomMessages = res.messages;

      this.socket.emit('join_room', { roomId: room.id });

      this.$nextTick(() => {
        this.scrollRoomToBottom();
        this.$refs.roomMessageInput?.focus();
      });
    },

    leaveRoom(room) {
      this.socket.emit('leave_room', { roomId: room.id });
      this.activeRoom = null;
      this.roomMessages = [];
    },

    sendRoomMessage() {
      const content = this.roomMessageText.trim();
      if (!content || !this.activeRoom) return;

      this.socket.emit('room_message', {
        roomId: this.activeRoom.id,
        content
      });

      this.roomMessageText = '';
      this.$nextTick(() => this.$refs.roomMessageInput?.focus());
    },

    scrollRoomToBottom() {
      const el = this.$refs.roomMessagesContainer;
      if (el) el.scrollTop = el.scrollHeight;
    },

    // ──────── STATUS ────────
    changeStatus() {
      this.socket.emit('change_status', {
        status: this.currentUser.status,
        statusMessage: this.currentUser.statusMessage
      });
    },

    statusLabel(status) {
      const map = { online: 'Online', away: 'Plecat', busy: 'Ocupat', offline: 'Offline' };
      return map[status] || status;
    },

    // ──────── PROFILE ────────
    async saveProfile() {
      try {
        const res = await $.ajax({
          url: '/api/chat/profile',
          method: 'PUT',
          contentType: 'application/json',
          data: JSON.stringify(this.editProfile)
        });

        this.currentUser.displayName = res.user.display_name;
        this.currentUser.statusMessage = res.user.status_message;
        this.currentUser.avatar = res.user.avatar;

        // Update socket status message too
        this.socket.emit('change_status', {
          status: this.currentUser.status,
          statusMessage: this.editProfile.statusMessage
        });

        this.showProfileModal = false;
        this.showToast('Profil actualizat!', 'success');
      } catch (e) {
        this.showToast('Eroare la salvare', 'error');
      }
    },

    // ──────── EMOJI ────────
    toggleEmojiPicker() {
      this.showEmojiPicker = !this.showEmojiPicker;
    },

    insertEmoji(emoji) {
      this.messageText += emoji;
      this.showEmojiPicker = false;
      this.$nextTick(() => this.$refs.messageInput?.focus());
    },

    insertEmojiRoom(emoji) {
      this.roomMessageText += emoji;
      this.showEmojiPicker = false;
      this.$nextTick(() => this.$refs.roomMessageInput?.focus());
    },

    insertText(type) {
      if (type === 'bold') this.messageText += '**text**';
      if (type === 'italic') this.messageText += '_text_';
      this.$refs.messageInput?.focus();
    },

    // ──────── FORMAT ────────
    formatMessage(text) {
      if (!text) return '';

      // Escape HTML
      let safe = text
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;');

      // Bold
      safe = safe.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
      // Italic
      safe = safe.replace(/_(.+?)_/g, '<em>$1</em>');
      // Links
      safe = safe.replace(/(https?:\/\/[^\s]+)/g, '<a href="$1" target="_blank" style="color:#720e9e">$1</a>');
      // Newlines
      safe = safe.replace(/\n/g, '<br>');

      // Convert text emoticons to emoji
      const emoticons = {
        ':-)': '😊', ':)': '😊', ':-D': '😄', ':D': '😄',
        ':-(': '😢', ':(': '😢', ';-)': '😉', ';)': '😉',
        ':-P': '😛', ':P': '😛', ':-O': '😮', ':O': '😮',
        '8-)': '😎', '>:-(': '😡', ':-*': '😘'
      };
      Object.entries(emoticons).forEach(([text, emoji]) => {
        safe = safe.replaceAll(text, emoji);
      });

      return safe;
    },

    formatTime(dateStr) {
      const date = new Date(dateStr);
      const now = new Date();
      const isToday = date.toDateString() === now.toDateString();

      if (isToday) {
        return date.toLocaleTimeString('ro-RO', { hour: '2-digit', minute: '2-digit' });
      }
      return date.toLocaleDateString('ro-RO', { day: '2-digit', month: '2-digit' }) + ' ' +
        date.toLocaleTimeString('ro-RO', { hour: '2-digit', minute: '2-digit' });
    },

    // ──────── NOTIFICATIONS ────────
    playNotificationSound() {
      // Simple notification beep using Web Audio API
      try {
        const ctx = new (window.AudioContext || window.webkitAudioContext)();
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.connect(gain);
        gain.connect(ctx.destination);
        osc.type = 'sine';
        osc.frequency.setValueAtTime(880, ctx.currentTime);
        osc.frequency.exponentialRampToValueAtTime(440, ctx.currentTime + 0.2);
        gain.gain.setValueAtTime(0.3, ctx.currentTime);
        gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.3);
        osc.start(ctx.currentTime);
        osc.stop(ctx.currentTime + 0.3);
      } catch (e) {}
    },

    showToast(message, type = 'success') {
      this.toast = { visible: true, message, type };
      setTimeout(() => { this.toast.visible = false; }, 3000);
    },

    // Close context menu on click outside
    handleDocumentClick(e) {
      if (!e.target.closest('.context-menu')) {
        this.contextMenu.visible = false;
      }
      if (!e.target.closest('.emoji-picker') && !e.target.closest('.emoji-btn')) {
        this.showEmojiPicker = false;
      }
    }
  },

  mounted() {
    this.checkAuth();
    document.addEventListener('click', this.handleDocumentClick);
  },

  beforeUnmount() {
    document.removeEventListener('click', this.handleDocumentClick);
    if (this.socket) this.socket.disconnect();
  }
}).mount('#app');
